import { Fragment } from "react";
import { useTranslation } from "../../i18n";
import {
  COMPARISON_GROUPS,
  PUBLIC_PLAN_IDS,
  PLANS,
  formatStorageGb,
} from "../../config/pricing";

// ⚠️ S2.1 SCOPE — STATIC BY DESIGN. The rows/values come from the temporary
// COMPARISON_GROUPS matrix in config/pricing.ts. In S2.2 this is replaced by
// the centralized Feature Registry (plan→feature source of truth); this
// component will then map over registry entries instead of the static matrix.
// The registry is NOT implemented in S2.1 — this only prepares for it. Keep
// the rendering data-driven so the S2.2 swap is a data-source change, not a
// rewrite.
//
// Accessible, responsive feature-comparison table. Real <table> semantics:
// <caption>, column <th scope="col">, row <th scope="row">. Boolean cells
// carry an sr-only "Included / Not included" label so screen readers don't
// just hear a bare glyph. On small screens the table scrolls horizontally
// inside its own container (the page body never scrolls sideways); the plan
// header row is sticky so column context is kept while scrolling.

function BoolCell({ on }: { on: boolean }) {
  const { t } = useTranslation();
  return (
    <td className="px-4 py-3 text-center">
      <span
        className={on ? "text-orange-400" : "text-slate-600"}
        aria-hidden="true"
      >
        {on ? "✓" : "—"}
      </span>
      <span className="sr-only">
        {on ? t("pricing.compare.included") : t("pricing.compare.notIncluded")}
      </span>
    </td>
  );
}

function TextCell({ text }: { text: string }) {
  return <td className="px-4 py-3 text-center text-sm font-medium text-white">{text}</td>;
}

export default function PlanComparisonTable() {
  const { t } = useTranslation();

  return (
    <div className="overflow-x-auto rounded-3xl border border-white/10 bg-white/5">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <caption className="sr-only">{t("pricing.compare.caption")}</caption>
        <thead>
          <tr className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur">
            <th scope="col" className="px-4 py-4 text-left font-semibold text-white">
              {t("pricing.compare.featureColumn")}
            </th>
            {PUBLIC_PLAN_IDS.map((id) => (
              <th
                key={id}
                scope="col"
                className={`px-4 py-4 text-center font-semibold ${
                  PLANS[id].recommended ? "text-orange-300" : "text-white"
                }`}
              >
                {t(`pricing.plans.${id}.name`)}
                {PLANS[id].recommended && (
                  <span className="ml-1" aria-hidden="true">⭐</span>
                )}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {COMPARISON_GROUPS.map((group) => (
            <Fragment key={group.id}>
              <tr className="bg-white/5">
                <th
                  scope="colgroup"
                  colSpan={1 + PUBLIC_PLAN_IDS.length}
                  className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-400"
                >
                  {t(`pricing.compare.groups.${group.id}`)}
                </th>
              </tr>
              {group.rows.map((row) => (
                <tr key={row.id} className="border-t border-white/5">
                  <th scope="row" className="px-4 py-3 text-left font-normal text-slate-200">
                    {t(`pricing.compare.rows.${row.id}`)}
                    {row.future && (
                      <span className="ml-2 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                        {t("pricing.compare.soon")}
                      </span>
                    )}
                  </th>
                  {row.values.map((on, i) => (
                    <BoolCell key={PUBLIC_PLAN_IDS[i]} on={on} />
                  ))}
                </tr>
              ))}
            </Fragment>
          ))}

          {/* Plan meta group: storage + support, computed from config. */}
          <tr className="bg-white/5">
            <th
              scope="colgroup"
              colSpan={1 + PUBLIC_PLAN_IDS.length}
              className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-400"
            >
              {t("pricing.compare.groups.plan")}
            </th>
          </tr>
          <tr className="border-t border-white/5">
            <th scope="row" className="px-4 py-3 text-left font-normal text-slate-200">
              {t("pricing.labels.storage")}
            </th>
            {PUBLIC_PLAN_IDS.map((id) => (
              <TextCell
                key={id}
                text={PLANS[id].storageGb === null ? t("pricing.compare.custom") : formatStorageGb(PLANS[id].storageGb!)}
              />
            ))}
          </tr>
          <tr className="border-t border-white/5">
            <th scope="row" className="px-4 py-3 text-left font-normal text-slate-200">
              {t("pricing.labels.support")}
            </th>
            {PUBLIC_PLAN_IDS.map((id) => (
              <TextCell key={id} text={t(`pricing.support.${PLANS[id].support}`)} />
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
