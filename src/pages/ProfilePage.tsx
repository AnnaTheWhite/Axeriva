import PageHeader from "../components/PageHeader";
import DangerZoneSection from "../components/account/DangerZoneSection";
import { useAuth } from "../context/AuthContext";
import { useTranslation } from "../i18n";

export default function ProfilePage() {
  const { user } = useAuth();
  const { t } = useTranslation();

  return (
    <div className="p-4 sm:p-8">
      <PageHeader title={t("profile.title")} subtitle={t("profile.subtitle")} />

      <div className="max-w-md rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur-xl">
        <p className="text-sm text-slate-400">{t("profile.email")}</p>
        <p className="mt-1 text-white">{user?.email}</p>

        <p className="mt-6 text-sm text-slate-400">{t("profile.role")}</p>
        <p className="mt-1 text-white">{user?.role}</p>
      </div>

      <DangerZoneSection />
    </div>
  );
}
