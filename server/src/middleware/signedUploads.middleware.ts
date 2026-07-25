import { NextFunction, Request, Response } from "express";
import { localDiskStorage } from "../services/storage";

// Gate in front of the static /uploads mount (R1.5). Every request for a
// stored file must carry a valid, unexpired signature produced by
// fileStorage.signUrl() — which is only ever handed out in an authenticated
// API response, so possession of a working URL implies the caller was
// authorized when it was issued.
//
// This middleware is LOCAL-BACKEND ONLY. Once uploads move to Cloudflare R2
// (v1.0 #4) the object store verifies its own presigned URLs at the edge, the
// static mount goes away, and this file is deleted — nothing else changes.
//
// Failures answer 404, not 403: a wrong signature and a nonexistent file must
// be indistinguishable, or the endpoint becomes an oracle for which
// attachment ids exist.
export function requireSignedUploadUrl() {
  return function signedUploadGuard(req: Request, res: Response, next: NextFunction) {
    // Mounted at /uploads, so req.path is the key with a leading slash
    // ("/projects/6f1e….png"). decodeURIComponent so a key containing escaped
    // characters hashes the same way it was signed.
    let key: string;
    try {
      key = decodeURIComponent(req.path.replace(/^\/+/, ""));
    } catch {
      return res.status(404).json({ error: "Not found" });
    }

    if (!key) {
      return res.status(404).json({ error: "Not found" });
    }

    if (!localDiskStorage.verify(key, req.query.exp, req.query.sig)) {
      return res.status(404).json({ error: "Not found" });
    }

    return next();
  };
}
