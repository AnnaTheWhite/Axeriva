import { useEffect } from "react";
import { useLocation } from "react-router-dom";

// Smooth-scrolls to the element whose id matches the current location.hash.
// Runs whenever the hash changes, which covers every entry path to a landing
// section: a cross-page navigation (e.g. /pricing → /#features), a full-page
// refresh on /#features, and browser Back/Forward between hashes. No-op when
// there is no hash or no matching element, so it is safe to mount on any page.
//
// Single source of truth for hash scrolling — the LandingNavbar click handler
// and this hook stay in sync instead of each reimplementing scroll logic.
export function useScrollToHash() {
  const { hash } = useLocation();

  useEffect(() => {
    if (!hash) return;

    const id = decodeURIComponent(hash.slice(1));
    const el = document.getElementById(id);
    if (!el) return;

    // Defer to the next frame so the target section is laid out before we
    // scroll — important right after the landing page first mounts from
    // another route.
    const raf = requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    return () => cancelAnimationFrame(raf);
  }, [hash]);
}
