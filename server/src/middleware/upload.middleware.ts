import fs from "fs";
import path from "path";
import crypto from "crypto";
import multer from "multer";
import { config } from "../config";

// Real files on disk, not base64 in the DB — served back out via
// express.static (see index.ts). Filenames are randomized (not the
// original name) so a leaked/guessed URL alone doesn't reveal what the
// file is; access to the *link* still flows through the authenticated
// GET /projects/:id/attachments response.
//
// UPLOAD_ROOT lets production point this at a mounted persistent disk
// (e.g. Render's disk is typically mounted outside the app's working
// directory) — without it, uploaded files would be wiped on every deploy.
// Defaults to ./uploads under the project root for local development.
export const UPLOAD_ROOT = config.uploadRoot ?? path.join(process.cwd(), "uploads");
export const UPLOADS_DIR = path.join(UPLOAD_ROOT, "projects");
// C1.2 — company logos live in their own subdirectory of the same upload
// root, so they inherit the exact same persistent-disk / static-serving
// setup as project attachments without any new infrastructure.
export const LOGOS_DIR = path.join(UPLOAD_ROOT, "logos");

// Runs at import time, i.e. during startup — if the upload directory can't
// be created (bad UPLOAD_ROOT path, missing disk mount, permissions), fail
// with a clear message now instead of erroring on the first upload request.
function ensureDir(dir: string) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (error) {
    console.error(
      `FATAL: cannot create upload directory "${dir}". ` +
        "Check UPLOAD_ROOT (must be a writable path; in production it must point inside the persistent disk mount).",
      error
    );
    process.exit(1);
  }
}
ensureDir(UPLOADS_DIR);
ensureDir(LOGOS_DIR);

const PROJECT_ATTACHMENT_MIME_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};

// C1.2 — logos are images only. SVG is accepted as a vector format (never
// rasterized/resized — see companyLogo.ts) but is ONLY ever rendered via an
// <img> tag on the frontend (BrandingSection), which does not execute
// embedded scripts, same as any other <img src>. It is never framed/objected
// or served with a script-executing context.
const LOGO_MIME_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/svg+xml": "svg",
};

// Shared factory: one place that defines "how a validated multer upload
// works" (randomized on-disk filename, MIME allowlist, size cap) — reused by
// every upload handler instead of re-implementing storage/validation per
// feature. Adding a new upload surface (future modules) means calling this,
// not writing new multer wiring.
function createUploadHandler(options: {
  destination: string;
  allowedMimeTypes: Record<string, string>;
  maxFileSizeBytes: number;
  invalidTypeMessage: string;
}) {
  const storage = multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, options.destination),
    filename: (_req, file, callback) => {
      const extension = options.allowedMimeTypes[file.mimetype] ?? "bin";
      callback(null, `${crypto.randomUUID()}.${extension}`);
    },
  });

  return multer({
    storage,
    limits: { fileSize: options.maxFileSizeBytes },
    fileFilter: (_req, file, callback) => {
      if (!options.allowedMimeTypes[file.mimetype]) {
        callback(new Error(options.invalidTypeMessage));
        return;
      }
      callback(null, true);
    },
  });
}

// Up to 20 files per request — a deliberate sanity cap, not a product
// "storage limit" (that's explicitly out of scope for this sprint).
const MAX_FILES_PER_UPLOAD = 20;

export const uploadProjectFiles = createUploadHandler({
  destination: UPLOADS_DIR,
  allowedMimeTypes: PROJECT_ATTACHMENT_MIME_TYPES,
  maxFileSizeBytes: 10 * 1024 * 1024,
  invalidTypeMessage: "Unsupported file type. Allowed: JPG, PNG, PDF, DOCX, XLSX.",
}).array("files", MAX_FILES_PER_UPLOAD);

// C1.2 — single-file logo upload, 2MB cap (logos are small by nature; a
// generous ceiling well under the multipart body limit).
export const uploadCompanyLogo = createUploadHandler({
  destination: LOGOS_DIR,
  allowedMimeTypes: LOGO_MIME_TYPES,
  maxFileSizeBytes: 2 * 1024 * 1024,
  invalidTypeMessage: "Unsupported file type. Allowed: PNG, JPG, SVG.",
}).single("logo");

export function isImageMimeType(mimeType: string): boolean {
  return mimeType === "image/jpeg" || mimeType === "image/png";
}
