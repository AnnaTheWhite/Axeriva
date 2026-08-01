import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "../../i18n";
import NotificationList from "./NotificationList";
import {
  getNotifications,
  getUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationItem,
} from "../../services/notifications.service";

// N1.7 — the bell in the Topbar. First notification surface the user ever
// sees; the data behind it has been real since N1.5.
//
// Polls only the unread COUNT, and only the count: it is a single indexed
// count on the server, whereas the feed is a page of rows nobody is looking
// at while the panel is shut. The feed loads when the panel opens.
const POLL_INTERVAL_MS = 60_000;
const PAGE_SIZE = 10;

export default function NotificationBell() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);

  // A failed count refresh keeps the previous badge rather than surfacing an
  // error: the bell is ambient, and a red toast every 60 seconds during a
  // brief network blip would be worse than a slightly stale number. A genuine
  // session failure is already handled centrally by apiFetch's 401 path.
  const refreshUnread = useCallback(async () => {
    try {
      setUnread(await getUnreadCount());
    } catch {
      /* keep the last known count */
    }
  }, []);

  useEffect(() => {
    // The badge subscribes to an external system on an interval; the state
    // update happens in the promise continuation, never synchronously in the
    // effect body. react-hooks/set-state-in-effect cannot see across the await
    // and flags the kick-off call anyway — the alternative it would accept is
    // an empty badge for the first POLL_INTERVAL_MS, which is a worse product
    // for no real benefit.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshUnread();

    const timer = window.setInterval(() => {
      // A backgrounded tab has nobody watching the badge; polling it only
      // burns request quota and wakes the API for nothing.
      if (!document.hidden) void refreshUnread();
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [refreshUnread]);

  // Same close-on-outside-interaction contract as LanguageSwitcher: click
  // outside, scroll, resize or Escape. The panel is anchored `absolute` to
  // this component's own relative wrapper for the same reason documented
  // there — a `fixed` overlay breaks under the Topbar's backdrop-filter.
  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function close() {
      setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", close);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  async function loadFirstPage() {
    setIsLoading(true);
    try {
      const feed = await getNotifications({ limit: PAGE_SIZE });
      setItems(feed.items);
      setNextCursor(feed.nextCursor);
    } catch {
      setItems([]);
      setNextCursor(null);
    } finally {
      setIsLoading(false);
    }
  }

  async function loadMore() {
    if (nextCursor === null) return;

    setIsLoadingMore(true);
    try {
      const feed = await getNotifications({ cursor: nextCursor, limit: PAGE_SIZE });
      setItems((prev) => [...prev, ...feed.items]);
      setNextCursor(feed.nextCursor);
    } catch {
      /* leave what is already on screen */
    } finally {
      setIsLoadingMore(false);
    }
  }

  function handleTriggerClick() {
    if (open) {
      setOpen(false);
      return;
    }

    setOpen(true);
    void loadFirstPage();
  }

  async function handleSelect(item: NotificationItem) {
    // Optimistic: the row greys out immediately and the badge drops. The
    // server call is idempotent (marking an already-read row is a no-op), so
    // a failure here costs a stale badge until the next poll, not a wrong one.
    if (!item.readAt) {
      const readAt = new Date().toISOString();
      setItems((prev) => prev.map((row) => (row.id === item.id ? { ...row, readAt } : row)));
      setUnread((prev) => Math.max(0, prev - 1));

      try {
        await markNotificationRead(item.id);
      } catch {
        void refreshUnread();
      }
    }

    if (item.ctaPath) {
      setOpen(false);
      navigate(item.ctaPath);
    }
  }

  async function handleMarkAllRead() {
    const readAt = new Date().toISOString();
    setItems((prev) => prev.map((row) => (row.readAt ? row : { ...row, readAt })));
    setUnread(0);

    try {
      await markAllNotificationsRead();
    } catch {
      void refreshUnread();
    }
  }

  const badge = unread > 99 ? "99+" : String(unread);

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={handleTriggerClick}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={
          unread > 0
            ? t("notifications.bellLabelWithCount", { count: unread })
            : t("notifications.bellLabel")
        }
        className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white transition hover:bg-white/10"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2a2 2 0 01-.6 1.4L4 17h5m6 0a3 3 0 11-6 0m6 0H9"
          />
        </svg>

        {unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] font-bold text-white"
          >
            {badge}
          </span>
        )}
      </button>

      {/* The panel is viewport-anchored on phones and trigger-anchored from
          `sm` up, and that split is not cosmetic. The bell sits in the MIDDLE
          of the mobile Topbar (menu · title · bell · language · log out ·
          avatar), so a panel anchored `right-0` to the trigger hangs 320px
          leftwards from a right edge only ~134px in — 186px of it lands
          off-screen, and since the body never scrolls horizontally that part is
          simply unreachable. `fixed` is safe here specifically because nothing
          between this panel and the root establishes a containing block (no
          transform, filter, backdrop-filter or contain) — the opposite of the
          LandingNavbar case documented in LanguageSwitcher, where backdrop-blur
          broke exactly this. The top offset matches the Topbar's own height
          (py-4 around a 2.5rem avatar). From `sm` the header is wide enough for
          the trigger anchor to fit, so it goes back to hanging off the bell. */}
      {open && (
        <div
          role="dialog"
          aria-label={t("notifications.title")}
          className="fixed inset-x-3 top-[4.5rem] z-50 overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[22rem]"
        >
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <span className="text-sm font-semibold text-white">{t("notifications.title")}</span>
            {unread > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                className="text-xs font-medium text-orange-400 transition hover:text-orange-300"
              >
                {t("notifications.markAllRead")}
              </button>
            )}
          </div>

          {/* Capped height so a long feed scrolls inside the panel instead of
              growing it past the viewport. */}
          <div className="max-h-[24rem] overflow-y-auto">
            <NotificationList
              items={items}
              onSelect={handleSelect}
              isLoading={isLoading}
              hasMore={nextCursor !== null}
              onLoadMore={loadMore}
              isLoadingMore={isLoadingMore}
            />
          </div>
        </div>
      )}
    </div>
  );
}
