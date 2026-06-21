import { useEffect, useState } from "react";
import PageHeader from "../components/PageHeader";
import { useTranslation } from "../i18n";
import Button from "../components/ui/Button";
import DangerZoneSection from "../components/account/DangerZoneSection";
import CompanyProfileSection from "../components/company/CompanyProfileSection";
import BrandingSection from "../components/company/BrandingSection";
import { useAuth } from "../context/AuthContext";
import { getMyCompany, updateMyCompany } from "../services/company.service";
import { getSubscriptionStatus } from "../services/subscription.service";

const ACTIVE_STATUSES = ["active", "trialing", "past_due"];

export default function SettingsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [hasActiveSubscription, setHasActiveSubscription] = useState(false);

  useEffect(() => {
    if (!user?.companyId) return;

    getMyCompany(user.companyId)
      .then((company) => setName(company.name))
      .finally(() => setIsLoading(false));

    getSubscriptionStatus()
      .then((status) =>
        setHasActiveSubscription(ACTIVE_STATUSES.includes(status.subscriptionStatus))
      )
      .catch(() => setHasActiveSubscription(false));
  }, [user?.companyId]);

  async function handleSave() {
    if (!user?.companyId) return;

    setMessage(null);

    try {
      await updateMyCompany(user.companyId, { name });
      setMessage("Saved.");
    } catch {
      setMessage("Failed to save changes.");
    }
  }

  if (isLoading) {
    return null;
  }

  return (
    <div className="p-4 sm:p-8">
      <PageHeader title={t("settings.title")} subtitle={t("settings.subtitle")} />

      <div className="max-w-md rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur-xl">
        <label className="block text-sm text-white/70">Company name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white outline-none focus:border-orange-500"
        />

        {message && (
          <p className="mt-4 text-sm text-slate-400">{message}</p>
        )}

        <div className="mt-6">
          <Button onClick={handleSave}>Save</Button>
        </div>
      </div>

      <CompanyProfileSection />
      <BrandingSection />

      <DangerZoneSection
        warning={
          hasActiveSubscription
            ? "You have an active subscription. You'll need to cancel it from the Subscription page before you can delete your account."
            : undefined
        }
      />
    </div>
  );
}
