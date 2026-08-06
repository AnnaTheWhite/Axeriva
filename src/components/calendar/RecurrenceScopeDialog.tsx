import Modal from "../ui/Modal";
import { useTranslation } from "../../i18n";
import type { SeriesScope } from "../../services/calendar.service";

// CAL1.6 — "this one / this and following / the whole series".
//
// Shown before any edit or delete of a RECURRING event, because the three
// answers write three different things on the server and only the user knows
// which one they meant. A calendar that guesses here destroys data silently:
// picking `series` when the user meant `this` rewrites every past and future
// occurrence at once.
//
// Deliberately has NO default and NO pre-selected button. Each choice is an
// explicit click.

type RecurrenceScopeDialogProps = {
  open: boolean;
  // Delete phrases the consequences differently from edit — "this and the
  // following will be removed" is not the same sentence as "…will be changed".
  action: "edit" | "delete";
  onSelect: (scope: SeriesScope) => void;
  onClose: () => void;
};

export default function RecurrenceScopeDialog({
  open,
  action,
  onSelect,
  onClose,
}: RecurrenceScopeDialogProps) {
  const { t } = useTranslation();

  const scopes: SeriesScope[] = ["this", "following", "series"];

  return (
    <Modal open={open} title={t(`calendar.scope.${action}Title`)} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-slate-300">{t(`calendar.scope.${action}Message`)}</p>

        <div className="space-y-3">
          {scopes.map((scope) => (
            <button
              key={scope}
              type="button"
              onClick={() => onSelect(scope)}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left transition hover:bg-white/10"
            >
              <span className="block font-medium text-white">
                {t(`calendar.scope.${scope}`)}
              </span>
              <span className="mt-1 block text-sm text-slate-400">
                {t(`calendar.scope.${scope}Hint`)}
              </span>
            </button>
          ))}
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/10 bg-white/5 px-5 py-2 text-slate-300 transition hover:bg-white/10"
          >
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
