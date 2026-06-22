import { useTranslation } from "../../i18n";

export default function LandingFooter() {
  const { t } = useTranslation();
  return (
    <footer className="border-t border-white/10 px-6 py-10 text-center text-sm text-slate-500">
      {t("landing.footer.rights", { year: new Date().getFullYear() })}
    </footer>
  );
}
