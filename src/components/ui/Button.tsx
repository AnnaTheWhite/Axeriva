type ButtonProps = {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "danger" | "secondary";
  type?: "button" | "submit";
};

export default function Button({
  children,
  onClick,
  variant = "primary",
  type = "button",
}: ButtonProps) {
  const base =
    "rounded-xl px-4 py-2 font-medium transition";

  const styles = {
    primary: "bg-orange-500 text-white hover:bg-orange-600",
    danger:
      "bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20",
    secondary:
      "bg-white/5 text-white border border-white/10 hover:bg-white/10",
  };

  return (
    <button
      type={type}
      onClick={onClick}
      className={`${base} ${styles[variant]}`}
    >
      {children}
    </button>
  );
}