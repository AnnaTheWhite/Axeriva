import fs from "fs";
import path from "path";
import crypto from "crypto";
import multer from "multer";

// Real files on disk, not base64 in the DB — served back out via
// express.static (see index.ts). Filenames are randomized (not the
// original name) so a leaked/guessed URL alone doesn't reveal what the
// file is; access to the *link* still flows through the authenticated
// GET /projects/:id/attachments response.
export const UPLOADS_DIR = path.join(process.cwd(), "uploads", "projects");

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

export const uploadProjectFile = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_MIME_TYPES[file.mimetype]) {
      callback(new Error("Unsupported file type. Allowed: JPG, PNG, PDF, DOCX, XLSX."));
      return;
    }

    callback(null, true);
  },
}).single("file");

export function isImageMimeType(mimeType: string): boolean {
  return mimeType === "image/jpeg" || mimeType === "image/png";
}
