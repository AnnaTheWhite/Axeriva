import { useEffect, useState } from "react";
import Button from "../ui/Button";
import { useTranslation } from "../../i18n";
import { useWriteGuard } from "../../hooks/useWriteGuard";
import {
  getNotificationPreferences,
  updateCompanyNotificationDefaults,
  updateMyNotificationPreferences,
  type CategoryResolution,
  type NotificationPreferences,
  type PreferenceUpdate,
} from "../../services/notifications.service";

// N1.7 — the preference screen for the three-level model (plan §7.1):
//
//   my override  →  company default  →  registry default
//
// The whole point of showing both scopes side by side is that "inherited" is a
// real, visible state: a user who has never touched a switch should see WHICH
// level is currently deciding for them, not a checkbox that looks like their
// own choice. So each cell is a three-way control (on / off / inherit), not a
// checkbox — a checkbox has no way to express "I have no opinion".
//
// Mandatory categories (security, critical billing — Q2) are rendered locked
// on rather than hidden. Hiding them would let a user conclude they had
// silenced everything and still receive security mail.

type Scope = "user" | "company";

// null = no row at this level, i.e. inherit from below.
type Draft = Record<string, boolean | null>;

function slotKey(category: string, channel: string): string {
  return `${category}:${channel}`;
}

function toDraft(preferences: NotificationPreferences, scope: Scope): Draft {
  const draft: Draft = {};

  for (const category of preferences.categories) {
    if (category.mandatory) continue;

    for (const channel of preferences.channels) {
      const resolution = category.channels[channel];
      if (!resolution) continue;
      draft[slotKey(category.category, channel)] =
        scope === "user" ? resolution.user : resolution.company;
    }
  }

  return draft;
}

// Only what actually changed is sent. A full-matrix PUT would rewrite rows the
// user never touched, and on the company-default path that means churning
// every tenant row on every save.
function changedEntries(before: Draft, after: Draft): PreferenceUpdate[] {
  return Object.keys(after)
    .filter((key) => before[key] !== after[key])
    .map((key) => {
      const [category, channel] = key.split(":");
      return { category, channel: channel as "EMAIL" | "IN_APP", enabled: after[key] };
    });
}

export default function NotificationPreferencesSection() {
  const { t } = useTranslation();
  const { readOnly } = useWriteGuard();

  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [scope, setScope] = useState<Scope>("user");
  const [draft, setDraft] = useState<Draft>({});
  const [baseline, setBaseline] = useState<Draft>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function adopt(next: NotificationPreferences, forScope: Scope) {
    const nextDraft = toDraft(next, forScope);
    setPreferences(next);
    setDraft(nextDraft);
    setBaseline(nextDraft);
  }

  useEffect(() => {
    let cancelled = false;

    getNotificationPreferences()
      .then((loaded) => {
        if (cancelled) return;
        adopt(loaded, "user");
      })
      .catch(() => {
        if (!cancelled) setError(t("notifications.preferences.loadFailed"));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // Loaded once on mount; t() is stable enough for a failure message and
    // re-running this on a language switch would discard unsaved edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function switchScope(next: Scope) {
    if (!preferences || next === scope) return;
    setScope(next);
    setMessage(null);
    setError(null);
    // Unsaved edits belong to the scope they were made in — carrying them
    // across would silently write a personal choice into the company default.
    const nextDraft = toDraft(preferences, next);
    setDraft(nextDraft);
    setBaseline(nextDraft);
  }

  function setSlot(category: string, channel: string, value: boolean | null) {
    setDraft((prev) => ({ ...prev, [slotKey(category, channel)]: value }));
    setMessage(null);
  }

  async function handleSave() {
    if (!preferences) return;

    const updates = changedEntries(baseline, draft);
    if (updates.length === 0) {
      setMessage(t("notifications.preferences.noChanges"));
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const saved =
        scope === "company"
          ? await updateCompanyNotificationDefaults(updates)
          : await updateMyNotificationPreferences(updates);
      adopt(saved, scope);
      setMessage(t("notifications.preferences.saved"));
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : t("notifications.preferences.saveFailed")
      );
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) return null;

  if (!preferences) {
    return (
      <div className="mt-8 max-w-2xl rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur-xl">
        <h3 className="text-lg font-semibold text-white">{t("notifications.preferences.title")}</h3>
        <p className="mt-2 text-sm text-red-400">{error}</p>
      </div>
    );
  }

  // Saving the COMPANY default is a tenant-configuration write, so it obeys
  // read-only mode exactly like every other company setting. Saving MY OWN
  // preferences does not: that is per-user state, and the server keeps it
  // writable in read-only mode on purpose (see notifications.routes.ts).
  const saveBlocked = scope === "company" && readOnly;
  const companyOff = preferences.company?.notificationsEnabled === false;

  return (
    <div className="mt-8 max-w-2xl rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur-xl">
      <h3 className="text-lg font-semibold text-white">{t("notifications.preferences.title")}</h3>
      <p className="mt-1 text-sm text-slate-400">{t("notifications.preferences.description")}</p>

      {preferences.canEditDefaults && (
        <div className="mt-6 inline-flex rounded-xl border border-white/10 bg-white/5 p-1">
          {(["user", "company"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => switchScope(option)}
              aria-pressed={scope === option}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                scope === option
                  ? "bg-orange-500/15 text-orange-400"
                  : "text-slate-300 hover:bg-white/5"
              }`}
            >
              {t(`notifications.preferences.scope.${option}`)}
            </button>
          ))}
        </div>
      )}

      <p className="mt-3 text-xs text-slate-500">
        {t(`notifications.preferences.scopeHint.${scope}`)}
      </p>

      {companyOff && (
        <p className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-300">
          {t("notifications.preferences.companyOffWarning")}
        </p>
      )}

      <div className="mt-6 space-y-3">
        {preferences.categories.map((category) => (
          <CategoryRow
            key={category.category}
            category={category}
            channels={preferences.channels}
            scope={scope}
            draft={draft}
            onChange={setSlot}
            disabled={saveBlocked}
          />
        ))}
      </div>

      {message && <p className="mt-4 text-sm text-slate-400">{message}</p>}
      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

      <div className="mt-6">
        <Button
          onClick={handleSave}
          disabled={isSaving || saveBlocked}
          title={saveBlocked ? t("readOnly.tooltip") : undefined}
        >
          {isSaving ? t("common.saving") : t("common.save")}
        </Button>
      </div>
    </div>
  );
}

type CategoryRowProps = {
  category: CategoryResolution;
  channels: string[];
  scope: Scope;
  draft: Draft;
  onChange: (category: string, channel: string, value: boolean | null) => void;
  disabled: boolean;
};

function CategoryRow({
  category,
  channels,
  scope,
  draft,
  onChange,
  disabled,
}: CategoryRowProps) {
  const { t } = useTranslation();

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-white">
          {t(`notifications.categories.${category.category}.title`)}
        </span>
        {category.mandatory && (
          <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-medium text-slate-300">
            {t("notifications.preferences.alwaysOn")}
          </span>
        )}
      </div>

      <p className="mt-0.5 text-xs text-slate-400">
        {t(`notifications.categories.${category.category}.description`)}
      </p>

      {category.mandatory ? (
        <p className="mt-2 text-xs text-slate-500">
          {t("notifications.preferences.mandatoryHint")}
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {channels.map((channel) => {
            const resolution = category.channels[channel];
            if (!resolution) return null;

            const value = draft[slotKey(category.category, channel)] ?? null;
            // What "inherit" resolves to right now, so the neutral option can
            // say so instead of leaving the user to guess.
            const inherited =
              scope === "user"
                ? resolution.company ?? resolution.registry
                : resolution.registry;

            return (
              <div
                key={channel}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <span className="text-xs text-slate-300">
                  {t(`notifications.channels.${channel}`)}
                  {resolution.blockedBy && (
                    <span className="ml-2 text-[11px] text-amber-400">
                      {t(`notifications.preferences.blocked.${resolution.blockedBy}`)}
                    </span>
                  )}
                </span>

                <div className="inline-flex rounded-lg border border-white/10 bg-white/5 p-0.5">
                  {([true, false, null] as const).map((option) => (
                    <button
                      key={String(option)}
                      type="button"
                      disabled={disabled}
                      aria-pressed={value === option}
                      onClick={() => onChange(category.category, channel, option)}
                      className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                        value === option
                          ? "bg-orange-500/15 text-orange-400"
                          : "text-slate-400 hover:bg-white/5"
                      }`}
                    >
                      {option === null
                        ? t(
                            inherited
                              ? "notifications.preferences.inheritOn"
                              : "notifications.preferences.inheritOff"
                          )
                        : t(option ? "notifications.preferences.on" : "notifications.preferences.off")}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
