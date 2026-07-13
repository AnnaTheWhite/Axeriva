type ButtonProps = {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "danger" | "secondary";
  type?: "button" | "submit";
  // "lg" gives a taller, full-width-friendly touch target (44px+) for
  // mobile-first actions like Clock In/Out — default stays as-is so
  // existing call sites are unaffected.
  size?: "md" | "lg";
  className?: string;
  // Non-interactive state (e.g. "Current Plan"). Omitting it keeps existing
  // call sites unchanged.
  disabled?: boolean;
};

export default function Button({
  children,
  onClick,
  variant = "primary",
  type = "button",
  size = "md",
  className = "",
  disabled = false,
}: ButtonProps) {
  const base = "rounded-xl font-medium transition disabled:cursor-not-allowed disabled:opacity-50";

  const sizes = {
    md: "px-4 py-2",
    lg: "px-6 py-4 text-base w-full sm:w-auto",
  };

  const styles = {
    primary: "bg-orange-500 text-white hover:bg-orange-600 disabled:hover:bg-orange-500",
    danger:
      "bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 disabled:hover:bg-red-500/10",
    secondary:
      "bg-white/5 text-white border border-white/10 hover:bg-white/10 disabled:hover:bg-white/5",
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${sizes[size]} ${styles[variant]} ${className}`}
    >
      {children}
    </button>
  );
}