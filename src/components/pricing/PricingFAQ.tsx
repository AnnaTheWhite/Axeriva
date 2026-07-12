import { useTranslation } from "../../i18n";
import { FAQ_IDS } from "../../config/pricing";

// Accessible FAQ built on native <details>/<summary> — keyboard-operable and
// screen-reader friendly out of the box, styled to the dark design system.
export default function PricingFAQ() {
  const { t } = useTranslation();
  return (
    <section className="mx-auto max-w-3xl" aria-label={t("pricing.faq.title")}>
      <h2 className="text-center text-2xl font-bold text-white sm:text-3xl">
        {t("pricing.faq.title")}
      </h2>
      <div className="mt-8 space-y-3">
        {FAQ_IDS.map((id) => (
          <details
            key={id}
            className="group rounded-2xl border border-white/10 bg-white/5 p-5 transition hover:border-white/20"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900">
              {t(`pricing.faq.items.${id}.q`)}
              <span
                aria-hidden="true"
                className="shrink-0 text-slate-400 transition-transform group-open:rotate-45"
              >
                +
              </span>
            </summary>
            <p className="mt-3 text-sm leading-relaxed text-slate-400">
              {t(`pricing.faq.items.${id}.a`)}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}
