import { useEffect, useState } from "react";

import { useTranslation } from "../../i18n";
import { useWriteGuard } from "../../hooks/useWriteGuard";
import {
  type CalendarSummary,
  type ReadShareLevel,
  type ShareLevel,
  getShareLevel,
  setShareLevel,
} from "../../services/calendar.service";

// CAL1.6 — the sharing level of the caller's OWN personal calendar (R2/R4).
//
// This is the only sharing UI in CAL1.6, by decision (b): grant management for
// shared calendars is CAL2.5, and the "Kész, ha" asks for exactly one thing —
// "the sharing level is settable on one's own personal calendar".
//
// Three levels, and the middle one is the point of the whole model: the
// company learns WHEN you are busy without learning WHAT you are doing. There
// is no fourth "share content with one person" option here; that is a grant,
// and grants are CAL2.5.
//
// The level is not a column on the server — it is the presence and preset of
// the COMPANY grant row. That is why "PRIVATE" is a real state and not an
// absence of configuration, and why GET can answer "OTHER": somebody granted
// the company something that is neither of the two share presets, and the API
// refuses to misreport it.

type ShareLevelControlProps = {
  calendar: CalendarSummary;
};

const LEVELS: ShareLevel[] = ["PRIVATE", "FREE_BUSY", "DETAILS"];

export default function ShareLevelControl({ calendar }: ShareLevelControlProps) {
  const { t } = useTranslation();
  const { readOnly, guardProps } = useWriteGuard();

  const [level, setLevel] = useState<ReadShareLevel | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    getShareLevel(calendar.id)
      .then((result) => {
        if (!cancelled) setLevel(result.shareLevel);
      })
      .catch(() => {
        if (!cancelled) setLevel(null);
      });

    return () => {
      cancelled = true;
    };
  }, [calendar.id]);

  function choose(next: ShareLevel) {
    if (next === level || saving || readOnly) return;

    setSaving(true);
    setError(null);
    setShareLevel(calendar.id, next)
      .then((result) => setLevel(result.shareLevel))
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : t("calendar.share.failed"))
      )
      .finally(() => setSaving(false));
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <p className="text-sm font-medium text-white">{t("calendar.share.title")}</p>
      <p className="mt-1 text-xs text-slate-400">{t("calendar.share.subtitle")}</p>

      <div className="mt-3 space-y-2">
        {LEVELS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => choose(option)}
            {...guardProps}
            disabled={saving || readOnly}
            className={`w-full rounded-xl border px-3 py-2 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
              level === option
                ? "border-orange-500/40 bg-orange-500/20 text-orange-200"
                : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
            }`}
          >
            <span className="block font-medium">{t(`calendar.share.level.${option}`)}</span>
            <span className="mt-0.5 block text-xs text-slate-400">
              {t(`calendar.share.levelHint.${option}`)}
            </span>
          </button>
        ))}
      </div>

      {/* Somebody granted the whole company a preset that is not one of the two
          share levels. Saying so is better than showing three buttons none of
          which is highlighted, which would read as "nothing is shared". */}
      {level === "OTHER" && (
        <p className="mt-3 text-xs text-amber-300">{t("calendar.share.other")}</p>
      )}

      {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
    </div>
  );
}
