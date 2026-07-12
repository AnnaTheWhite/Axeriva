import { InfoTooltip } from "./ui/Tooltip";

type StatCardProps = {
  title: string;
  value: string | number;
  // Optional metric explanation — renders a focusable info tooltip next to
  // the title. Omitting it keeps existing call sites visually unchanged.
  tooltip?: string;
};

export default function StatCard({
  title,
  value,
  tooltip,
}: StatCardProps) {
  return (
    <article
      className="
        rounded-3xl
        border
        border-white/10
        bg-white/5
        p-6
        backdrop-blur-xl
      "
    >
      <div className="flex items-center gap-1.5">
        <p className="text-sm text-slate-400">
          {title}
        </p>
        {tooltip && <InfoTooltip label={tooltip} />}
      </div>

      <h3 className="mt-3 text-3xl font-bold">
        {value}
      </h3>
    </article>
  );
}
