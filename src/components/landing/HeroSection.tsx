import { Link } from "react-router-dom";
import { useTranslation } from "../../i18n";

export default function HeroSection() {
  const { t } = useTranslation();
  return (
    <section className="relative overflow-hidden px-6 pt-24 pb-20 text-center">
      <div
        className="
          pointer-events-none
          absolute
          left-1/2
          top-0
          h-[480px]
          w-[480px]
          -translate-x-1/2
          rounded-full
          bg-orange-500/20
          blur-[120px]
        "
      />

      <div className="relative mx-auto max-w-3xl">
        <span className="inline-block rounded-full border border-white/10 bg-white/5 px-4 py-1 text-xs font-medium text-orange-400 backdrop-blur-xl">
          {t("landing.hero.badge")}
        </span>

        <h1 className="mt-6 text-4xl font-bold tracking-tight text-white sm:text-5xl md:text-6xl">
          {t("landing.hero.titleLine1")}
          <br />
          {t("landing.hero.titleLine2")}
        </h1>

        <p className="mx-auto mt-6 max-w-xl text-lg text-slate-400">
          {t("landing.hero.description")}
        </p>

        <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Link
            to="/register"
            className="w-full rounded-xl bg-orange-500 px-8 py-3 text-base font-semibold text-white transition hover:bg-orange-600 sm:w-auto"
          >
            {t("landing.hero.signUp")}
          </Link>
          <Link
            to="/login"
            className="w-full rounded-xl border border-white/10 bg-white/5 px-8 py-3 text-base font-semibold text-white backdrop-blur-xl transition hover:bg-white/10 sm:w-auto"
          >
            {t("landing.hero.logIn")}
          </Link>
        </div>
      </div>
    </section>
  );
}
