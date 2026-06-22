import EmptyState from "../ui/EmptyState";
import { useTranslation } from "../../i18n";
import { translatePriority } from "../../i18n/labels";
import type { OwnerNote } from "../../types/ownerNote";

type ImportantNotesWidgetProps = {
  notes: OwnerNote[];
};

const PRIORITY_BADGE_CLASS: Record<string, string> = {
  Urgent: "bg-red-500/20 text-red-400",
  High: "bg-orange-500/20 text-orange-400",
  Medium: "bg-slate-500/20 text-slate-300",
  Low: "bg-slate-500/10 text-slate-400",
};

export default function ImportantNotesWidget({ notes }: ImportantNotesWidgetProps) {
  const { t } = useTranslation();

  if (notes.length === 0) {
    return (
      <EmptyState
        title={t("dashboard.importantNotes.noNotesTitle")}
        description={t("dashboard.importantNotes.noNotesDesc")}
      />
    );
  }

  return (
    <div className="space-y-3">
      {notes.map((note) => (
        <div
          key={note.id}
          className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-xl"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="font-semibold text-white">{note.title}</p>
            <div className="flex shrink-0 items-center gap-2">
              {note.pinned && (
                <span className="rounded-full bg-orange-500/20 px-2 py-0.5 text-xs font-medium text-orange-400">
                  {t("dashboard.importantNotes.pinned")}
                </span>
              )}
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  PRIORITY_BADGE_CLASS[note.priority] ?? PRIORITY_BADGE_CLASS.Medium
                }`}
              >
                {translatePriority(t, note.priority)}
              </span>
            </div>
          </div>

          <p className="mt-1 truncate text-sm text-slate-400">{note.content}</p>

          {(note.project || note.customer || note.employee) && (
            <p className="mt-2 text-xs text-slate-500">
              {[
                note.project?.name,
                note.customer?.name,
                note.employee ? `${note.employee.firstName} ${note.employee.lastName}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
