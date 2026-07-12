import type { ChartDataPoint } from "../services/adminAnalytics.service";

type Props = {
  data: ChartDataPoint[];
  label: string;
  color?: string;
  /** Total days to show on the X axis (fills missing days with 0). Default 30. */
  days?: number;
};

// Builds a YYYY-MM-DD string for a date offset from today.
function dateKey(offsetFromToday: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetFromToday);
  return d.toISOString().split("T")[0];
}

// Fills in missing calendar days so the chart always spans the full window.
function fillDays(data: ChartDataPoint[], days: number): ChartDataPoint[] {
  const lookup = new Map(data.map((d) => [d.date, d.count]));
  return Array.from({ length: days }, (_, i) => {
    const date = dateKey(i - days + 1);
    return { date, count: lookup.get(date) ?? 0 };
  });
}

const W = 400;
const H = 80;
const PAD_B = 16; // bottom padding for labels

export default function MiniLineChart({ data, label, color = "#818cf8", days = 30 }: Props) {
  const filled = fillDays(data, days);
  const max = Math.max(...filled.map((d) => d.count), 1);
  const total = filled.reduce((s, d) => s + d.count, 0);

  // Map data points to SVG coordinates.
  const pts = filled.map((d, i) => {
    const x = (i / (filled.length - 1)) * W;
    const y = H - (d.count / max) * H;
    return { x, y, ...d };
  });

  const polyline = pts.map((p) => `${p.x},${p.y}`).join(" ");

  // Closed polygon for the area fill (line + bottom edge).
  const areaPath = [
    `M ${pts[0].x},${H}`,
    ...pts.map((p) => `L ${p.x},${p.y}`),
    `L ${pts[pts.length - 1].x},${H}`,
    "Z",
  ].join(" ");

  // X-axis labels: first day and last day.
  const firstLabel = filled[0]?.date.slice(5) ?? ""; // MM-DD
  const lastLabel = filled[filled.length - 1]?.date.slice(5) ?? "";

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="text-xs text-slate-400">{label}</p>
        <p className="text-lg font-bold leading-none">{total}</p>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H + PAD_B}`}
        className="w-full"
        aria-hidden="true"
        preserveAspectRatio="none"
      >
        {/* Horizontal grid lines */}
        {[0.25, 0.5, 0.75].map((frac) => (
          <line
            key={frac}
            x1={0}
            y1={H - frac * H}
            x2={W}
            y2={H - frac * H}
            stroke="currentColor"
            strokeOpacity={0.06}
            strokeWidth={1}
          />
        ))}

        {/* Area fill */}
        <path d={areaPath} fill={color} fillOpacity={0.1} />

        {/* Line */}
        <polyline
          points={polyline}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* X-axis date labels */}
        <text x={0} y={H + PAD_B - 2} fontSize={9} fill="currentColor" fillOpacity={0.4}>
          {firstLabel}
        </text>
        <text
          x={W}
          y={H + PAD_B - 2}
          fontSize={9}
          fill="currentColor"
          fillOpacity={0.4}
          textAnchor="end"
        >
          {lastLabel}
        </text>
      </svg>
    </div>
  );
}
