import { useId, useState } from "react";

// Lightweight, dependency-free tooltip that matches the dark design system.
// Accessible: the trigger is focusable, the tooltip is linked via
// aria-describedby, and it appears on both hover and keyboard focus. Pure
// CSS positioning (no portals) so it works inside cards and table headers.

type TooltipProps = {
  /** Tooltip text shown on hover/focus. */
  label: string;
  children: React.ReactNode;
  /** Where the bubble appears relative to the trigger. Default "top". */
  side?: "top" | "bottom";
  className?: string;
};

export default function Tooltip({ label, children, side = "top", className = "" }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const id = useId();

  const sideClass =
    side === "top"
      ? "bottom-full left-1/2 mb-2 -translate-x-1/2"
      : "top-full left-1/2 mt-2 -translate-x-1/2";

  return (
    <span
      className={`relative inline-flex ${className}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <span aria-describedby={open ? id : undefined}>{children}</span>
      {open && (
        <span
          role="tooltip"
          id={id}
          className={`pointer-events-none absolute z-50 w-max max-w-xs whitespace-normal rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-xs font-normal leading-snug text-slate-100 shadow-xl ${sideClass}`}
        >
          {label}
        </span>
      )}
    </span>
  );
}

// Small "i" info button that reveals a Tooltip. Used to annotate metric cards
// and table headers. Keyboard-focusable and screen-reader labelled.
export function InfoTooltip({ label }: { label: string }) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        aria-label={label}
        className="flex h-4 w-4 items-center justify-center rounded-full border border-white/20 text-[10px] font-semibold text-slate-400 transition hover:border-white/40 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
      >
        i
      </button>
    </Tooltip>
  );
}
