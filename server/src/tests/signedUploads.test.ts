import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import app from "../app";
import prisma from "../database/prisma";
import { UPLOADS_DIR } from "../middleware/upload.middleware";
import { fileStorage, localDiskStorage } from "../services/storage";
import { authHeader, createTenant } from "./helpers/factories";

// R1.5 — /uploads used to be a bare express.static mount: world-readable
// forever to anyone who learned a URL. These tests pin the replacement, which
// is deliberately shaped like an S3/R2 presigned URL so the v1.0 #4 migration
// swaps the backend without touching a caller.

const FILE_NAME = "signed-uploads-test-fixture.txt";
const PUBLIC_PATH = `/uploads/projects/${FILE_NAME}`;
const FILE_BODY = "attachment contents";

beforeAll(() => {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOADS_DIR, FILE_NAME), FILE_BODY);
});

afterAll(() => {
  fs.rmSync(path.join(UPLOADS_DIR, FILE_NAME), { force: true });
});

describe("serving /uploads", () => {
  it("refuses an unsigned request for a file that really exists", async () => {
    const res = await request(app).get(PUBLIC_PATH);

    expect(res.status).toBe(404);
    expect(res.text).not.toContain(FILE_BODY);
  });

  it("serves the file when the URL carries a valid signature", async () => {
    const res = await request(app).get(fileStorage.signUrl(PUBLIC_PATH));

    expect(res.status).toBe(200);
    expect(res.text).toBe(FILE_BODY);
  });

  it("refuses an expired signature", async () => {
    // Negative TTL → already past its expiry.
    const res = await request(app).get(fileStorage.signUrl(PUBLIC_PATH, -60));

    expect(res.status).toBe(404);
  });

  it("refuses a tampered signature", async () => {
    const signed = fileStorage.signUrl(PUBLIC_PATH);
    const tampered = signed.replace(/sig=(.)/, (_m, first) => `sig=${first === "A" ? "B" : "A"}`);

    const res = await request(app).get(tampered);

    expect(res.status).toBe(404);
  });

  it("refuses an extended expiry (the expiry is part of what is signed)", async () => {
    const signed = fileStorage.signUrl(PUBLIC_PATH);
    const url = new URL(signed, "http://localhost");
    url.searchParams.set("exp", String(Number(url.searchParams.get("exp")) + 86_400));

    const res = await request(app).get(`${url.pathname}${url.search}`);

    expect(res.status).toBe(404);
  });

  it("refuses a signature minted for a DIFFERENT file", async () => {
    const otherSigned = fileStorage.signUrl("/uploads/projects/some-other-file.txt");
    const stolen = new URL(otherSigned, "http://localhost");

    const res = await request(app).get(`${PUBLIC_PATH}${stolen.search}`);

    expect(res.status).toBe(404);
  });

  it("answers 404 (not 403) so a bad signature is indistinguishable from a missing file", async () => {
    const missing = await request(app).get(
      fileStorage.signUrl("/uploads/projects/does-not-exist.txt")
    );
    const unsigned = await request(app).get(PUBLIC_PATH);

    expect(missing.status).toBe(404);
    expect(unsigned.status).toBe(404);
  });

  it("does not let a path traversal escape the upload root", async () => {
    const res = await request(app).get("/uploads/../package.json");

    expect(res.status).toBe(404);
  });
});

describe("signing", () => {
  it("is idempotent — re-signing an already-signed path does not nest", async () => {
    const once = fileStorage.signUrl(PUBLIC_PATH);
    const twice = fileStorage.signUrl(once);

    expect(twice.split("?")[0]).toBe(PUBLIC_PATH);
    expect((twice.match(/sig=/g) ?? []).length).toBe(1);

    const res = await request(app).get(twice);
    expect(res.status).toBe(200);
  });

  it("passes a legacy base64 data: logo through untouched", () => {
    const legacy = "data:image/png;base64,iVBORw0KGgo=";

    expect(fileStorage.signUrl(legacy)).toBe(legacy);
    expect(fileStorage.toKey(legacy)).toBeNull();
  });

  it("maps a stored path to a backend-neutral object key (the future R2 key)", () => {
    expect(fileStorage.toKey(PUBLIC_PATH)).toBe(`projects/${FILE_NAME}`);
    expect(fileStorage.toKey("/uploads/logos/abc.webp")).toBe("logos/abc.webp");
  });

  it("returns null for an absent optional URL", () => {
    expect(fileStorage.signUrlOrNull(null)).toBeNull();
    expect(fileStorage.signUrlOrNull(undefined)).toBeNull();
  });

  it("rejects a signature whose key does not match, at the storage layer", () => {
    const signed = new URL(fileStorage.signUrl(PUBLIC_PATH), "http://localhost");
    const exp = signed.searchParams.get("exp");
    const sig = signed.searchParams.get("sig");

    expect(localDiskStorage.verify(`projects/${FILE_NAME}`, exp, sig)).toBe(true);
    expect(localDiskStorage.verify("projects/other.txt", exp, sig)).toBe(false);
  });
});

describe("API responses hand out signed URLs", () => {
  it("GET /projects/:id/attachments returns a signed fileUrl", async () => {
    const t = await createTenant();
    await prisma.projectAttachment.create({
      data: {
        projectId: t.project.id,
        userId: t.owner.id,
        fileName: "invoice.pdf",
        fileType: "application/pdf",
        fileSize: 1234,
        fileUrl: PUBLIC_PATH,
      },
    });

    const res = await request(app)
      .get(`/projects/${t.project.id}/attachments`)
      .set(authHeader(t.token));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].fileUrl).toMatch(/^\/uploads\/projects\/.+\?exp=\d+&sig=.+$/);
    // The raw, unsigned path must never be what the client is handed.
    expect(res.body[0].fileUrl).not.toBe(PUBLIC_PATH);
  });

  it("the signed URL from the API actually works", async () => {
    const t = await createTenant();
    await prisma.projectAttachment.create({
      data: {
        projectId: t.project.id,
        userId: t.owner.id,
        fileName: "invoice.pdf",
        fileType: "application/pdf",
        fileSize: 1234,
        fileUrl: PUBLIC_PATH,
      },
    });

    const list = await request(app)
      .get(`/projects/${t.project.id}/attachments`)
      .set(authHeader(t.token));

    const res = await request(app).get(list.body[0].fileUrl);

    expect(res.status).toBe(200);
    expect(res.text).toBe(FILE_BODY);
  });

  it("GET /company/settings returns a signed logoUrl", async () => {
    const t = await createTenant();
    await prisma.company.update({
      where: { id: t.company.id },
      data: { logoUrl: "/uploads/logos/brand.png" },
    });

    const res = await request(app).get("/company/settings").set(authHeader(t.token));

    expect(res.status).toBe(200);
    expect(res.body.logoUrl).toMatch(/^\/uploads\/logos\/brand\.png\?exp=\d+&sig=.+$/);
  });

  it("leaves a null logoUrl null", async () => {
    const t = await createTenant();

    const res = await request(app).get("/company/settings").set(authHeader(t.token));

    expect(res.status).toBe(200);
    expect(res.body.logoUrl).toBeNull();
  });
});
