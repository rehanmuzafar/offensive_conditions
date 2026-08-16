import { cn } from "@/lib/cn";

/* -------------------------------------------------------------------------- */
/* Sparkline — tiny inline SVG trend line                                     */
/* -------------------------------------------------------------------------- */
export function Sparkline({ data, className }: { data: number[]; className?: string }) {
  if (data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const w = 100;
  const h = 32;
  const step = w / (data.length - 1);
  const points = data.map((v, i) => `${i * step},${h - ((v - min) / range) * h}`).join(" ");
  const area = `0,${h} ${points} ${w},${h}`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn("h-8 w-full", className)} preserveAspectRatio="none">
      <defs>
        <linearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7C3AED" stopOpacity="0.35" />
          <stop offset="1" stopColor="#7C3AED" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill="url(#spark)" />
      <polyline
        points={points}
        fill="none"
        stroke="#8B5CF6"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Metric tile                                                                */
/* -------------------------------------------------------------------------- */
export function MetricTile({
  label,
  value,
  sub,
  icon,
  spark,
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: React.ReactNode;
  spark?: number[];
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-text-dim">{label}</span>
        {icon && <span className="text-text-faint">{icon}</span>}
      </div>
      <div className="mt-2 font-display text-[26px] font-extrabold leading-none">{value}</div>
      {sub && <div className="mt-1.5 text-[12.5px] text-text-faint">{sub}</div>}
      {spark && <div className="mt-3"><Sparkline data={spark} /></div>}
    </div>
  );
}
