export const ATTACHMENT_CATEGORIES = [
  "Before",
  "During",
  "After",
  "Issue",
  "Material",
  "Other",
] as const;

export type AttachmentCategory = (typeof ATTACHMENT_CATEGORIES)[number];

export function normalizeCategory(value: unknown): AttachmentCategory {
  return (ATTACHMENT_CATEGORIES as readonly string[]).includes(value as string)
    ? (value as AttachmentCategory)
    : "Other";
}
