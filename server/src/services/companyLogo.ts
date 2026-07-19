import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import { LOGOS_DIR } from "../middleware/upload.middleware";

// C1.2 — the ONE place logo files are processed after upload. Called by
// company.routes.ts; no other route touches logo files on disk directly
// (attachments.routes.ts's fs.unlink pattern is mirrored here for removal).

// Logos are capped to this square, aspect-ratio-preserved, never upscaled —
// a company logo never needs to be larger than this for any current
// consumer (dashboard header, PDF exports).
const MAX_LOGO_DIMENSION = 512;

// Resizes a raster logo (PNG/JPEG) and re-encodes it as PNG for a single
// consistent on-disk format; re-validates that the uploaded bytes are a
// genuine, decodable image (multer's fileFilter only checked the MIME header
// the client claimed — sharp actually parses the pixel data, so a renamed
// non-image file fails here instead of being served later as a "logo").
// SVGs are left completely untouched (vector, no raster resize concept) but
// are still confirmed to look like well-formed SVG.
//
// Returns the final on-disk filename — re-encoding a JPEG upload to PNG
// changes its extension, so the caller must persist THIS filename as
// `logoUrl`, not the one multer originally assigned.
export async function processUploadedLogo(filePath: string, mimeType: string): Promise<string> {
  if (mimeType === "image/svg+xml") {
    const contents = await fs.readFile(filePath, "utf8");
    // Cheap sanity check: must look like an SVG document. Full XML/script
    // sanitization is out of scope — SVGs are only ever rendered via <img>
    // on the frontend, which does not execute embedded scripts.
    if (!/<svg[\s>]/i.test(contents)) {
      await fs.unlink(filePath).catch(() => {});
      throw new Error("File is not a valid SVG image.");
    }
    return path.basename(filePath);
  }

  let metadata;
  try {
    metadata = await sharp(filePath).metadata();
  } catch {
    await fs.unlink(filePath).catch(() => {});
    throw new Error("File is not a valid image.");
  }

  if (!metadata.width || !metadata.height) {
    await fs.unlink(filePath).catch(() => {});
    throw new Error("File is not a valid image.");
  }

  const needsResize = metadata.width > MAX_LOGO_DIMENSION || metadata.height > MAX_LOGO_DIMENSION;
  const resizedBuffer = await sharp(filePath)
    .resize(MAX_LOGO_DIMENSION, MAX_LOGO_DIMENSION, { fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();

  // Re-encoding to PNG changes the extension for JPEG uploads — write to a
  // fresh .png path and remove the original to avoid a stale duplicate.
  const pngPath = filePath.replace(/\.[^.]+$/, ".png");
  await fs.writeFile(pngPath, resizedBuffer);
  if (pngPath !== filePath) {
    await fs.unlink(filePath).catch(() => {});
  }

  if (needsResize) {
    console.log(`[companyLogo] resized ${path.basename(filePath)} to fit ${MAX_LOGO_DIMENSION}px`);
  }

  return path.basename(pngPath);
}

// Best-effort delete of a previously stored logo file, given its stored
// `/uploads/logos/<filename>` URL. Mirrors attachments.routes.ts's cleanup —
// never throws (a missing file on disk should not block clearing the DB
// reference).
export async function deleteLogoFile(logoUrl: string | null | undefined): Promise<void> {
  if (!logoUrl || !logoUrl.startsWith("/uploads/logos/")) {
    // Not one of our on-disk logos (e.g. a legacy base64 data URL from
    // before this feature) — nothing to remove from disk.
    return;
  }
  const filePath = path.join(LOGOS_DIR, path.basename(logoUrl));
  await fs.unlink(filePath).catch((error) => {
    if (error?.code !== "ENOENT") {
      console.error("[companyLogo] failed to delete file from disk", error);
    }
  });
}
