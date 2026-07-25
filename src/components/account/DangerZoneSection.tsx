import { useEffect, useState } from "react";
import DeleteAccountModal from "./DeleteAccountModal";
import ArchiveCompanyModal from "../company/ArchiveCompanyModal";
import { useTranslation } from "../../i18n";
import { useIsOwner } from "../../hooks/useIsOwner";
import { useAuth } from "../../context/AuthContext";
import { getSubscriptionStatus } from "../../services/subscription.service";

// Mirrors server/src/constants/subscriptionStatuses.ts (no shared module
// exists between server/ and src/, so the list is duplicated by design —
// keep the two in sync). This is the frontend's ONLY copy.
const ACTIVE_SUBSCRIPTION_STATUSES = ["active", "trialing", "past_due"];

// B2 — the subscription lookup lives HERE, not in the pages that render this
// section, so every mount point (SettingsPage AND ProfilePage) gets the same
// protection without prop-drilling. The backend guard is the real gate; this
// is honest UI on top of it, which is why a failed lookup fails OPEN (buttons
// stay enabled and the server's 409 text surfaces in the modal instead).
export default function DangerZoneSection() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isOwner = useIsOwner();
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isArchiveModalOpen, setIsArchiveModalOpen] = useState(false);
  const [hasActiveSubscription, setHasActiveSubscription] = useState(false);
  const [isArchiveBlocked, setIsArchiveBlocked] = useState(false);

  const companyId = user?.companyId ?? null;

  useEffect(() => {
    // Gate on owner + company: an EMPLOYEE would get a 403 from
    // GET /subscription (requireRole), and useIsOwner() is also true for
    // DEVELOPER, who has no company — the handler dereferences companyId.
    if (!isOwner || companyId === null) {
      return;
    }

    getSubscriptionStatus()
      .then((status) => {
        const isBilledStatus = ACTIVE_SUBSCRIPTION_STATUSES.includes(
          status.subscriptionStatus
        );
        setHasActiveSubscription(isBilledStatus);
        // Same rule as the backend guard: a registration trial has no Stripe
        // subscription (stripeSubscriptionId is null), nothing will charge,
        // so archiving it is allowed.
        setIsArchiveBlocked(
          isBilledStatus && status.stripeSubscriptionId !== null
        );
      })
      .catch(() => {
        // Fail open — the backend guard still refuses with a 409 whose
        // message the archive modal already displays.
        setHasActiveSubscription(false);
        setIsArchiveBlocked(false);
      });
  }, [isOwner, companyId]);

  return (
    <div className="mt-8 max-w-md rounded-3xl border border-red-500/30 bg-red-500/5 p-8">
      <h3 className="text-lg font-semibold text-red-400">{t("account.dangerZone.title")}</h3>
      <p className="mt-2 text-sm text-slate-400">
        {t("account.dangerZone.description")}
      </p>

      {hasActiveSubscription && (
        <p className="mt-4 rounded-lg bg-orange-500/10 px-3 py-2 text-sm text-orange-400">
          {t("account.dangerZone.activeSubscriptionWarning")}
        </p>
      )}

      <div className="mt-6 flex flex-col gap-3">
        {/* C1.7 — Archive Company: owner-only. Disables login for every
            company user while preserving all data (employees, customers,
            projects, invoices, Stripe history) — never deletes anything. */}
        {isOwner && (
          <>
            <button
              onClick={() => setIsArchiveModalOpen(true)}
              disabled={isArchiveBlocked}
              title={
                isArchiveBlocked
                  ? t("settings.dangerZone.archiveBlockedSubscription")
                  : undefined
              }
              className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-red-500/10"
            >
              {t("settings.dangerZone.archiveCompany")}
            </button>
            {isArchiveBlocked && (
              <p className="text-xs text-slate-400">
                {t("settings.dangerZone.archiveBlockedSubscription")}
              </p>
            )}
          </>
        )}

        <button
          onClick={() => setIsDeleteModalOpen(true)}
          className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition hover:bg-red-500/20"
        >
          {t("account.dangerZone.deleteAccount")}
        </button>
      </div>

      <DeleteAccountModal
        open={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
      />
      <ArchiveCompanyModal
        open={isArchiveModalOpen}
        onClose={() => setIsArchiveModalOpen(false)}
      />
    </div>
  );
}
