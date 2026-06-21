export const OWNER_NOTE_STATUSES = ["Inbox", "Reviewed", "Archived"] as const;

export type OwnerNoteStatus = (typeof OWNER_NOTE_STATUSES)[number];

export function normalizeOwnerNoteStatus(value: unknown): OwnerNoteStatus {
  return (OWNER_NOTE_STATUSES as readonly string[]).includes(value as string)
    ? (value as OwnerNoteStatus)
    : "Inbox";
}
