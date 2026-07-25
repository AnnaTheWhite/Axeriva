import { LocalDiskStorage } from "./localDiskStorage";
import type { FileStorage } from "./types";

// The active storage backend. Routes import `fileStorage` and only ever call
// the FileStorage interface, so the v1.0 #4 migration to Cloudflare R2 is a
// change to THIS file plus a new implementation class — no route, no
// serializer and no frontend URL-building code has to move.
//
// Kept as a concrete instance (not a factory behind an env switch) because
// there is exactly one backend today; adding the switch before a second
// backend exists would be configuration with nothing to configure.
export const localDiskStorage = new LocalDiskStorage();

export const fileStorage: FileStorage = localDiskStorage;

export type { FileStorage, StorageObjectKey } from "./types";
export { UPLOADS_MOUNT, DEFAULT_URL_TTL_SECONDS } from "./localDiskStorage";
