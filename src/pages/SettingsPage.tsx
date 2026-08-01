import PageHeader from "../components/PageHeader";
import DangerZoneSection from "../components/account/DangerZoneSection";
import CompanyProfileSection from "../components/company/CompanyProfileSection";
import BrandingSection from "../components/company/BrandingSection";
import LocalizationSection from "../components/company/LocalizationSection";
import PreferencesSection from "../components/company/PreferencesSection";
import NotificationPreferencesSection from "../components/notifications/NotificationPreferencesSection";
import { useIsOwner } from "../hooks/useIsOwner";
import { useTranslation } from "../i18n";

// Company Management (C1) — single source of truth for all company-level
// settings. Sections: Profile, Branding, Localization, Preferences, Danger
// Zone. BUSINESS_OWNER can edit everything here; EMPLOYEE sees the same
// sections read-only (each section disables its own controls via
// useIsOwner — no separate "view" page to keep in sync).
//
// The Danger Zone fetches the subscription state itself (B2), so this page
// no longer passes a warning prop — and ProfilePage gets the same behaviour
// for free.
export default function SettingsPage() {
  const { t } = useTranslation();
  const isOwner = useIsOwner();

  return (
    <div className="p-4 sm:p-8">
      <PageHeader title={t("settings.title")} subtitle={t("settings.subtitle")} />

      <CompanyProfileSection />
      <BrandingSection />
      <LocalizationSection />
      <PreferencesSection />
      {/* N1.7 — per-category preferences, one level below the three company
          switches in PreferencesSection above. Deliberately visible to
          EMPLOYEE too, and editable by them: level 3 of the model exists
          precisely because a mixed team is not one preference. */}
      <NotificationPreferencesSection />

      {isOwner && <DangerZoneSection />}
    </div>
  );
}
