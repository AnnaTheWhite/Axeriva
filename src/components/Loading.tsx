export default function Loading() {
  return (
    <div className="space-y-3">
      <div className="h-6 w-1/3 animate-pulse rounded bg-white/10" />
      <div className="h-6 w-full animate-pulse rounded bg-white/10" />
      <div className="h-6 w-full animate-pulse rounded bg-white/10" />
      <div className="h-6 w-2/3 animate-pulse rounded bg-white/10" />
    </div>
  );
}