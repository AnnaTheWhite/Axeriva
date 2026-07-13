// Shared usage-vs-limit progress bar (color thresholds match the existing
// admin analytics storage bars: green under 70%, amber 70–90%, red above).
export default function UsageBar({ current, limit }: { current: number; limit: number | null }) {
  if (limit === null || limit <= 0) return null;
  const pct = Math.min(100, (current / limit) * 100);
  const color = pct >= 90 ? "bg-red-500/70" : pct >= 70 ? "bg-orange-500/70" : "bg-emerald-500/70";

  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-white/10" aria-hidden="true">
      <span className={`block h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </span>
  );
}
