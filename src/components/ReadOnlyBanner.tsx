import { Link } from "react-router-dom";
import { useReadOnly } from "../context/ReadOnlyContext";
import { useTranslation } from "../i18n";

// S2.7 — global read-only banner. Rendered in the dashboard shell for every
// authenticated tenant user; visible only when the company is read-only.
// Links straight to Billing so the owner can upgrade/resume out of it.
export default function ReadOnlyBanner() {
  const { readOnly } = useReadOnly();
  const { t } = useTranslation();

  if (!readOnly) return null;

  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-500/30 bg-amber-500/10 px-6 py-3 text-sm"
    >
      <span className="text-amber-200">
        <strong className="font-semibold">{t("readOnly.bannerTitle")}</strong>{" "}
        {t("readOnly.bannerBody")}
      </span>
      <Link
        to="/subscription"
        className="shrink-0 rounded-lg border border-amber-500/40 px-3 py-1.5 font-medium text-amber-200 transition hover:bg-amber-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50"
      >
        {t("readOnly.bannerCta")}
      </Link>
    </div>
  );
}
