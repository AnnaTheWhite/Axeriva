// Storage abstraction (R1.5).
//
// The ONLY thing the rest of the app is allowed to know about file storage is
// this interface: "given the path stored in the database, give me a URL the
// browser may fetch for a limited time". Today that is a local disk plus an
// HMAC signature; under v1.0 #4 it becomes Cloudflare R2 and `signUrl` returns
// an S3 presigned URL instead. Swapping backends must not touch a single
// route — only the implementation behind `fileStorage` (services/storage) and
// the local-only verification middleware, which disappears entirely once the
// object store does its own signature checking at the edge.
//
// Deliberately NOT part of this interface: uploading and deleting. Those still
// go through multer and fs today; widening the abstraction before the R2
// migration actually needs it would be speculative design.

// The backend-neutral identity of a stored object, relative to the storage
// root: "projects/6f1e…png", "logos/2b8c…webp". This is what becomes the S3/R2
// object key verbatim, which is why it carries no leading slash and no mount
// prefix.
export type StorageObjectKey = string;

export interface FileStorage {
  // Converts the path persisted in the database ("/uploads/projects/x.png")
  // into a backend key. Returns null for anything that is not a managed
  // upload — notably the legacy base64 `data:` logos still present on old
  // Company rows, which are not stored objects at all.
  toKey(publicPath: string): StorageObjectKey | null;

  // A URL the browser can GET directly, valid for `ttlSeconds`. Values that
  // are not managed uploads are returned unchanged, so callers can pipe
  // legacy `data:` URLs through without special-casing them.
  signUrl(publicPath: string, ttlSeconds?: number): string;

  // Null-safe variant for optional columns (Company.logoUrl).
  signUrlOrNull(publicPath: string | null | undefined, ttlSeconds?: number): string | null;
}
