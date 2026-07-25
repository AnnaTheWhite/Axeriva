import crypto from "crypto";
import { config } from "../../config";
import type { FileStorage, StorageObjectKey } from "./types";

// Local-disk implementation of FileStorage (R1.5).
//
// Before this existed, /uploads was a bare express.static mount: every
// attachment and company logo was world-readable to anyone who learned the
// URL, with no authentication and no expiry. Randomized UUID filenames made
// guessing impractical, but a URL that leaks once (a referrer header, a
// shared screenshot, a proxy log, a forwarded email) grants permanent access
// to a document that may contain client data.
//
// The fix mirrors how S3/R2 presigned URLs work, so the v1.0 #4 migration
// replaces this file rather than reworking the callers:
//   - reads go through signUrl(), which appends `exp` and `sig`
//   - the URL is unguessable AND expires
//   - verification is stateless: no DB lookup, no session, so it still works
//     from a plain <img src> that cannot send an Authorization header
//
// The signing key is DERIVED from JWT_SECRET rather than being a new required
// environment variable: adding one would break every existing deployment at
// startup (config.ts fails fast on missing vars) for no security gain. The
// derivation label keeps the key cryptographically separate from the one used
// to sign sessions, so a signed file URL can never be confused for — or
// downgraded into — an auth token.
const SIGNING_KEY = crypto
  .createHmac("sha256", config.jwtSecret)
  .update("axeriva:file-url-signing:v1")
  .digest();

export const UPLOADS_MOUNT = "/uploads";

// One hour. Long enough that a project page left open (or a lightbox opened
// after a while) keeps working; short enough that a leaked URL stops being
// useful the same session. Attachment lists are re-fetched on navigation, so
// the client naturally receives fresh signatures.
export const DEFAULT_URL_TTL_SECONDS = 60 * 60;

function isManagedUpload(publicPath: string): boolean {
  return publicPath.startsWith(`${UPLOADS_MOUNT}/`);
}

// Signature over key + expiry. The key is included so a signature minted for
// one file can never be replayed onto another, and `exp` is included so it
// cannot be extended by editing the query string.
function computeSignature(key: StorageObjectKey, expiresAt: number): string {
  return crypto
    .createHmac("sha256", SIGNING_KEY)
    .update(`${key}:${expiresAt}`)
    .digest("base64url");
}

export class LocalDiskStorage implements FileStorage {
  toKey(publicPath: string): StorageObjectKey | null {
    if (!isManagedUpload(publicPath)) {
      return null;
    }

    // Drop any query string a caller may already have appended, so re-signing
    // an already-signed URL is idempotent rather than producing a key with a
    // stale signature baked into it.
    const withoutQuery = publicPath.split("?")[0]!;
    return withoutQuery.slice(UPLOADS_MOUNT.length + 1);
  }

  signUrl(publicPath: string, ttlSeconds: number = DEFAULT_URL_TTL_SECONDS): string {
    const key = this.toKey(publicPath);

    // Not a managed upload (legacy `data:` logo, or an absolute URL) — hand it
    // back untouched.
    if (key === null) {
      return publicPath;
    }

    const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
    const signature = computeSignature(key, expiresAt);

    return `${UPLOADS_MOUNT}/${key}?exp=${expiresAt}&sig=${signature}`;
  }

  signUrlOrNull(
    publicPath: string | null | undefined,
    ttlSeconds: number = DEFAULT_URL_TTL_SECONDS
  ): string | null {
    if (!publicPath) {
      return null;
    }
    return this.signUrl(publicPath, ttlSeconds);
  }

  // Local-backend only: with R2 the object store verifies its own presigned
  // URLs and nothing in this app sees the request. Kept off the FileStorage
  // interface for exactly that reason.
  verify(key: StorageObjectKey, rawExp: unknown, rawSig: unknown): boolean {
    if (typeof rawExp !== "string" || typeof rawSig !== "string") {
      return false;
    }

    const expiresAt = Number(rawExp);

    if (!Number.isInteger(expiresAt) || expiresAt * 1000 < Date.now()) {
      return false;
    }

    const expected = Buffer.from(computeSignature(key, expiresAt));
    const provided = Buffer.from(rawSig);

    // Length check first: timingSafeEqual throws on a length mismatch, and
    // length is not a secret.
    if (expected.length !== provided.length) {
      return false;
    }

    return crypto.timingSafeEqual(expected, provided);
  }
}
