// Presentation-only translation for backend enum-like string values.
// Backend values (OwnerNote.status, OwnerNote.priority) are never
// translated or modified — these helpers only map a stable backend value
// to a display label, the same way STATUS_STYLES maps it to a CSS class.
import type { OwnerNoteStatus, Priority } from "../types/ownerNote";
import type { useTranslation } from "./index";

type T = ReturnType<typeof useTranslation>["t"];

export function translateOwnerNoteStatus(t: T, status: OwnerNoteStatus): string {
  return t(`commandCenter.status.${status}`);
}

export function translatePriority(t: T, priority: Priority): string {
  return t(`commandCenter.priority.${priority}`);
}

export function translateProjectStatus(t: T, status: string): string {
  return t(`projects.status.${status}`);
}

export function translateEmployeeStatus(t: T, status: string): string {
  const key: Record<string, string> = {
    Active: "employees.statusActive",
    Sick: "employees.statusSick",
    Vacation: "employees.statusVacation",
  };
  return key[status] ? t(key[status]) : status;
}

export function translateAttachmentCategory(t: T, category: string): string {
  return t(`projectActivity.attachments.category.${category}`);
}
