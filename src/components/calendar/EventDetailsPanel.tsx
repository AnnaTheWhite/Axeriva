import Modal from "../ui/Modal";
import { useTranslation } from "../../i18n";
import { useAuth } from "../../context/AuthContext";
import { useWriteGuard } from "../../hooks/useWriteGuard";
import {
  type CalendarOccurrence,
  type CalendarSummary,
  canModify,
} from "../../services/calendar.service";

// CAL1.6 — the details of one occurrence.
//
// THE FREE/BUSY BRANCH IS THE POINT OF THIS COMPONENT. When `busy` is true the
// server never sent a title, a description, a location or a source reference —
// the keys are absent from the payload, not empty — so there is nothing here to
// accidentally render. The union type makes the branch mandatory rather than
// optional: the content fields are not reachable on the busy shape at all.

type EventDetailsPanelProps = {
  occurrence: CalendarOccurrence | null;
  calendar: CalendarSummary | undefined;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
};

export default function EventDetailsPanel({
  occurrence,
  calendar,
  onEdit,
  onDelete,
  onClose,
}: EventDetailsPanelProps) {
  const { t, language } = useTranslation();
  const { user } = useAuth();
  const { readOnly, guardProps } = useWriteGuard();

  if (!occurrence) return null;

  const locale = language === "hu" ? "hu-HU" : "en-US";
  const start = new Date(occurrence.startsAt);
  const end = new Date(occurrence.endsAt);

  const when = occurrence.allDay
    ? new Intl.DateTimeFormat(locale, { dateStyle: "full" }).format(start)
    : `${new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "short" }).format(start)} – ${new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(end)}`;

  const mayEdit = canModify(calendar, occurrence, user?.id ?? null, "edit");
  const mayDelete = canModify(calendar, occurrence, user?.id ?? null, "delete");

  return (
    <Modal
      open
      title={occurrence.busy ? t("calendar.busy") : occurrence.title}
      onClose={onClose}
    >
      <div className="space-y-4">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="text-sm text-slate-400">{t("calendar.details.when")}</p>
          <p className="mt-1 text-white">{when}</p>
        </div>

        {occurrence.busy ? (
          // Nothing else exists to show. Saying so is better than an empty
          // panel that reads as a loading failure.
          <p className="text-sm text-slate-400">{t("calendar.details.busyExplanation")}</p>
        ) : (
          <>
            {occurrence.description && (
              <div>
                <p className="text-sm text-slate-400">{t("calendar.details.description")}</p>
                <p className="mt-1 whitespace-pre-wrap text-slate-200">{occurrence.description}</p>
              </div>
            )}

            {occurrence.location.address && (
              <div>
                <p className="text-sm text-slate-400">{t("calendar.details.location")}</p>
                <p className="mt-1 text-slate-200">{occurrence.location.address}</p>
                {/* Where the address came FROM. An address inherited from the
                    project is not the event's own, and saying which is which is
                    what stops someone "correcting" it on the wrong record. */}
                {occurrence.location.source && occurrence.location.source !== "event" && (
                  <p className="mt-1 text-xs text-slate-500">
                    {t(`calendar.details.locationFrom.${occurrence.location.source}`)}
                  </p>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-slate-300">
                {t(`calendar.status.${occurrence.status}`)}
              </span>
              <span className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-slate-300">
                {t(`calendar.visibility.${occurrence.visibility}`)}
              </span>
              {occurrence.recurring && (
                <span className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-slate-300">
                  {t("calendar.details.recurring")}
                </span>
              )}
              {occurrence.overridden && (
                <span className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-sky-200">
                  {t("calendar.details.overridden")}
                </span>
              )}
            </div>
          </>
        )}

        <div className="flex flex-wrap justify-end gap-3">
          {mayEdit && (
            <button
              type="button"
              onClick={onEdit}
              {...guardProps}
              disabled={readOnly}
              className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-2 text-sm text-blue-400 transition hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              ✏ {t("common.edit")}
            </button>
          )}

          {mayDelete && (
            <button
              type="button"
              onClick={onDelete}
              {...guardProps}
              disabled={readOnly}
              className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-400 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              🗑 {t("common.delete")}
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/10"
          >
            {t("common.close")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
