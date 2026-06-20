type EmptyStateProps = {
  title: string;
  description?: string;
};

export default function EmptyState({
  title,
  description,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-3xl border border-white/10 bg-white/5 p-10 text-center">
      <p className="text-xl font-semibold text-white">
        {title}
      </p>

      {description && (
        <p className="mt-2 text-slate-400">
          {description}
        </p>
      )}
    </div>
  );
}