type EmptyStateProps = {
  title: string;
  description?: string;
  // Optional decorative icon (e.g. an emoji or small SVG) shown above the
  // title. Omitting it keeps existing call sites unchanged.
  icon?: React.ReactNode;
  // When true, drops the card chrome so the empty state can sit inside an
  // existing bordered container (like a table shell) without doubling borders.
  bare?: boolean;
};

export default function EmptyState({
  title,
  description,
  icon,
  bare = false,
}: EmptyStateProps) {
  const shell = bare
    ? "flex flex-col items-center justify-center p-10 text-center"
    : "flex flex-col items-center justify-center rounded-3xl border border-white/10 bg-white/5 p-10 text-center";

  return (
    <div className={shell}>
      {icon && (
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-2xl text-slate-300">
          {icon}
        </div>
      )}

      <p className="text-xl font-semibold text-white">
        {title}
      </p>

      {description && (
        <p className="mt-2 max-w-sm text-slate-400">
          {description}
        </p>
      )}
    </div>
  );
}
