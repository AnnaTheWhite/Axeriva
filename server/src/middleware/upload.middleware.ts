import fs from "fs";
import path from "path";
import crypto from "crypto";
import multer from "multer";

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
export const UPLOAD_ROOT = process.env.UPLOAD_ROOT || path.join(process.cwd(), "uploads");
export const UPLOADS_DIR = path.join(UPLOAD_ROOT, "projects");

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

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
