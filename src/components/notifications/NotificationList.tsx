import { useTranslation } from "../../i18n";
import type { NotificationItem } from "../../services/notifications.service";

// N1.7 — the feed body. Presentational: it renders what it is given and
// reports clicks upward. Fetching, paging and read-state live in
// NotificationBell, so this same list can be dropped into a full-page feed
// later without carrying a data layer with it.

// The four levels the billing UX spec already defined (§13) and the backend
// stores on every row, so the bell and the billing banners use one visual
// language for "how bad is this".
const SEVERITY_DOT: Record<string, string> = {
  info: "bg-slate-400",
  success: "bg-emerald-400",
  warning: "bg-amber-400",
  critical: "bg-red-400",
};

// Relative time via the platform's own Intl — no dependency, and correct in
// both languages including Hungarian's suffix rules, which a hand-rolled
// "{{n}} ago" template would get wrong.
function useRelativeTime() {
  const { language } = useTranslation();
  const locale = language === "hu" ? "hu-HU" : "en-GB";
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 365 * 24 * 60 * 60 * 1000],
    ["month", 30 * 24 * 60 * 60 * 1000],
    ["day", 24 * 60 * 60 * 1000],
    ["hour", 60 * 60 * 1000],
    ["minute", 60 * 1000],
  ];

  return (iso: string): string => {
    const elapsed = new Date(iso).getTime() - Date.now();

    for (const [unit, ms] of UNITS) {
      if (Math.abs(elapsed) >= ms) {
        return formatter.format(Math.round(elapsed / ms), unit);
      }
    }
    return formatter.format(0, "minute");
  };
}

type NotificationListProps = {
  items: NotificationItem[];
  onSelect: (item: NotificationItem) => void;
  isLoading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  isLoadingMore: boolean;
};

export default function NotificationList({
  items,
  onSelect,
  isLoading,
  hasMore,
  onLoadMore,
  isLoadingMore,
}: NotificationListProps) {
  const { t } = useTranslation();
  const relativeTime = useRelativeTime();

  if (isLoading) {
    return (
      <div className="p-6 text-center text-sm text-slate-400" aria-busy="true">
        {t("common.loading")}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="px-6 py-10 text-center">
        <p className="text-sm font-medium text-white">{t("notifications.emptyTitle")}</p>
        <p className="mt-1 text-xs text-slate-400">{t("notifications.emptyDescription")}</p>
      </div>
    );
  }

  return (
    <>
      <ul className="divide-y divide-white/5">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onSelect(item)}
              className={`flex w-full gap-3 px-4 py-3 text-left transition hover:bg-white/5 ${
                item.readAt ? "opacity-60" : ""
              }`}
            >
              <span
                aria-hidden="true"
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                  SEVERITY_DOT[item.severity] ?? SEVERITY_DOT.info
                } ${item.readAt ? "opacity-40" : ""}`}
              />

              <span className="min-w-0 flex-1">
                {/* Title and body are rendered server-side in the recipient's
                    language at delivery time — never passed through t(). */}
                <span className="block text-sm font-medium text-white">{item.title}</span>
                <span className="mt-0.5 block text-xs text-slate-400">{item.body}</span>

                <span className="mt-1 flex items-center gap-2">
                  <span className="text-[11px] text-slate-500">
                    {relativeTime(item.createdAt)}
                  </span>
                  {item.ctaLabel && (
                    <span className="text-[11px] font-medium text-orange-400">
                      {item.ctaLabel} →
                    </span>
                  )}
                </span>
              </span>

              {!item.readAt && (
                <span className="sr-only">{t("notifications.unreadLabel")}</span>
              )}
            </button>
          </li>
        ))}
      </ul>

      {hasMore && (
        <div className="border-t border-white/10 p-2">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={isLoadingMore}
            className="w-full rounded-lg px-3 py-2 text-xs font-medium text-slate-300 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoadingMore ? t("common.loading") : t("notifications.loadMore")}
          </button>
        </div>
      )}
    </>
  );
}
