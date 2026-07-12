// Feature Registry (S2.2) — the single, immutable source of truth for every
// premium capability and the minimum plan that unlocks it.
//
// Consumed via services/planAccess.ts (hasFeature / canUseFeature) — code must
// never hardcode plan checks. Adding a feature later means adding ONE entry
// here (and, when a UI surfaces it, its i18n label); nothing else changes.
//
// `minimumPlan` refers to a canonical PlanId; a plan has the feature when its
// tier is >= that plan's tier (see PLAN_TIER). `futureModule` flags a
// commercial module that is planned but not yet shipped.

import type { PlanId } from "./plans";

export const FEATURE_IDS = [
  "dashboard",
  "analytics",
  "advanced_reports",
  "csv_export",
  "excel_export",
  "developer_api",
  "api_keys",
  "webhooks",
  "automation",
  "branding",
  "multi_location",
  "google_calendar",
  "outlook_calendar",
  "ai_assistant",
  "ai_reports",
  "ai_scheduling",
  "sso",
  "scim",
  "white_label",
  "dedicated_support",
  "sla",
] as const;

export type FeatureId = (typeof FEATURE_IDS)[number];

export type FeatureDefinition = {
  id: FeatureId;
  displayName: string;
  description: string;
  minimumPlan: PlanId;
  futureModule?: boolean;
};

// Deep-frozen so the registry is immutable at runtime (in addition to the
// compile-time `Readonly` typing). Built once at module load.
function freezeRegistry<T extends Record<string, object>>(registry: T): Readonly<T> {
  for (const value of Object.values(registry)) {
    Object.freeze(value);
  }
  return Object.freeze(registry);
}

export const FEATURES: Readonly<Record<FeatureId, Readonly<FeatureDefinition>>> = freezeRegistry({
  dashboard: {
    id: "dashboard",
    displayName: "Dashboard",
    description: "Core operational dashboard with overview metrics.",
    minimumPlan: "starter",
  },
  analytics: {
    id: "analytics",
    displayName: "Analytics",
    description: "Business analytics with charts and trends.",
    minimumPlan: "starter",
  },
  advanced_reports: {
    id: "advanced_reports",
    displayName: "Advanced Reports",
    description: "Saved and scheduled advanced reporting.",
    minimumPlan: "professional",
  },
  csv_export: {
    id: "csv_export",
    displayName: "CSV Export",
    description: "Export data as CSV.",
    minimumPlan: "starter",
  },
  excel_export: {
    id: "excel_export",
    displayName: "Excel Export",
    description: "Export data as Excel (.xlsx).",
    minimumPlan: "professional",
  },
  developer_api: {
    id: "developer_api",
    displayName: "Developer API",
    description: "Public REST API for customer integrations.",
    minimumPlan: "professional",
  },
  api_keys: {
    id: "api_keys",
    displayName: "API Keys",
    description: "Create and manage company-scoped API keys.",
    minimumPlan: "professional",
  },
  webhooks: {
    id: "webhooks",
    displayName: "Webhooks",
    description: "Outbound event webhooks.",
    minimumPlan: "business",
  },
  automation: {
    id: "automation",
    displayName: "Automation",
    description: "Automation and workflow builder.",
    minimumPlan: "business",
  },
  branding: {
    id: "branding",
    displayName: "Branding",
    description: "Advanced branding on the app and documents.",
    minimumPlan: "business",
  },
  multi_location: {
    id: "multi_location",
    displayName: "Multi-location",
    description: "Manage multiple locations or sites.",
    minimumPlan: "business",
  },
  google_calendar: {
    id: "google_calendar",
    displayName: "Google Calendar",
    description: "Google Calendar integration.",
    minimumPlan: "professional",
  },
  outlook_calendar: {
    id: "outlook_calendar",
    displayName: "Outlook Calendar",
    description: "Outlook Calendar integration.",
    minimumPlan: "professional",
  },
  ai_assistant: {
    id: "ai_assistant",
    displayName: "AI Assistant",
    description: "Conversational AI operations assistant.",
    minimumPlan: "business",
    futureModule: true,
  },
  ai_reports: {
    id: "ai_reports",
    displayName: "AI Reports",
    description: "AI-generated reporting.",
    minimumPlan: "business",
    futureModule: true,
  },
  ai_scheduling: {
    id: "ai_scheduling",
    displayName: "AI Scheduling",
    description: "AI-optimized crew scheduling.",
    minimumPlan: "business",
    futureModule: true,
  },
  sso: {
    id: "sso",
    displayName: "SSO",
    description: "Single sign-on (SAML/OIDC).",
    minimumPlan: "enterprise",
  },
  scim: {
    id: "scim",
    displayName: "SCIM",
    description: "Automated user provisioning (SCIM 2.0).",
    minimumPlan: "enterprise",
  },
  white_label: {
    id: "white_label",
    displayName: "White Label",
    description: "Remove Axeriva branding.",
    minimumPlan: "enterprise",
  },
  dedicated_support: {
    id: "dedicated_support",
    displayName: "Dedicated Support",
    description: "Dedicated account manager and priority support.",
    minimumPlan: "enterprise",
  },
  sla: {
    id: "sla",
    displayName: "SLA",
    description: "Contractual service-level agreement.",
    minimumPlan: "enterprise",
  },
});
