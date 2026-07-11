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

// Runs at import time, i.e. during startup — if the upload directory can't
// be created (bad UPLOAD_ROOT path, missing disk mount, permissions), fail
// with a clear message now instead of erroring on the first upload request.
try {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
} catch (error) {
  console.error(
    `FATAL: cannot create upload directory "${UPLOADS_DIR}". ` +
      "Check UPLOAD_ROOT (must be a writable path; in production it must point inside the persistent disk mount).",
    error
  );
  process.exit(1);
}

const ALLOWED_MIME_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => {
    callback(null, UPLOADS_DIR);
  },
  filename: (_req, file, callback) => {
    const extension = ALLOWED_MIME_TYPES[file.mimetype] ?? "bin";
    callback(null, `${crypto.randomUUID()}.${extension}`);
  },
});

// Up to 20 files per request — a deliberate sanity cap, not a product
// "storage limit" (that's explicitly out of scope for this sprint).
const MAX_FILES_PER_UPLOAD = 20;

export const uploadProjectFiles = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: MAX_FILES_PER_UPLOAD },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_MIME_TYPES[file.mimetype]) {
      callback(new Error("Unsupported file type. Allowed: JPG, PNG, PDF, DOCX, XLSX."));
      return;
    }

    callback(null, true);
  },
}).array("files", MAX_FILES_PER_UPLOAD);

export function isImageMimeType(mimeType: string): boolean {
  return mimeType === "image/jpeg" || mimeType === "image/png";
}
