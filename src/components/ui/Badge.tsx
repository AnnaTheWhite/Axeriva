type BadgeProps = {
  children: React.ReactNode;
  // "neutral" matches the slate/white pill already used for e.g. plan names;
  // the rest mirror the color language already used by ad-hoc status pills
  // (see AdminUsersPage's StatusBadge) — centralized here as a reusable
  // primitive instead of re-declared per page.
  variant?: "neutral" | "success" | "warning" | "danger" | "info";
  className?: string;
};

const VARIANT_STYLES: Record<NonNullable<BadgeProps["variant"]>, string> = {
  neutral: "bg-white/10 text-slate-300",
  success: "bg-emerald-500/15 text-emerald-300",
  warning: "bg-amber-500/15 text-amber-300",
  danger: "bg-red-500/15 text-red-300",
  info: "bg-orange-500/15 text-orange-300",
};

export default function Badge({ children, variant = "neutral", className = "" }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${VARIANT_STYLES[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
