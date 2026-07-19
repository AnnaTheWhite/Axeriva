import { useEffect, useState } from "react";
import PageHeader from "../components/PageHeader";
import DangerZoneSection from "../components/account/DangerZoneSection";
import CompanyProfileSection from "../components/company/CompanyProfileSection";
import BrandingSection from "../components/company/BrandingSection";
import LocalizationSection from "../components/company/LocalizationSection";
import PreferencesSection from "../components/company/PreferencesSection";
import { getSubscriptionStatus } from "../services/subscription.service";
import { useIsOwner } from "../hooks/useIsOwner";
import { useTranslation } from "../i18n";

const ACTIVE_STATUSES = ["active", "trialing", "past_due"];

// Company Management (C1) — single source of truth for all company-level
// settings. Sections: Profile, Branding, Localization, Preferences, Danger
// Zone. BUSINESS_OWNER can edit everything here; EMPLOYEE sees the same
// sections read-only (each section disables its own controls via
// useIsOwner — no separate "view" page to keep in sync).
export default function SettingsPage() {
  const { t } = useTranslation();
  const isOwner = useIsOwner();
  const [hasActiveSubscription, setHasActiveSubscription] = useState(false);

  useEffect(() => {
    getSubscriptionStatus()
      .then((status) => setHasActiveSubscription(ACTIVE_STATUSES.includes(status.subscriptionStatus)))
      .catch(() => setHasActiveSubscription(false));
  }, []);

  return (
    <div className="p-4 sm:p-8">
      <PageHeader title={t("settings.title")} subtitle={t("settings.subtitle")} />

      <CompanyProfileSection />
      <BrandingSection />
      <LocalizationSection />
      <PreferencesSection />

      {isOwner && (
        <DangerZoneSection
          warning={
            hasActiveSubscription
              ? t("account.dangerZone.activeSubscriptionWarning")
              : undefined
          }
        />
      )}
    </div>
  );
}
