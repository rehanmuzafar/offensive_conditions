import { Star } from "lucide-react";

import { cn } from "@/lib/cn";

/* -------------------------------------------------------------------------- */
/* Progress bar                                                               */
/* -------------------------------------------------------------------------- */
export function ProgressBar({
  value,
  max = 100,
  className,
  height = 8,
}: {
  value: number;
  max?: number;
  className?: string;
  height?: number;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div
      className={cn("w-full overflow-hidden rounded-full bg-line-strong", className)}
      style={{ height }}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemax={max}
    >
      <div
        className="h-full rounded-full bg-brand-gradient transition-[width] duration-500"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Rating stars                                                               */
/* -------------------------------------------------------------------------- */
export function Rating({ value, count, className }: { value: number; count?: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span className="flex">
        {[0, 1, 2, 3, 4].map((i) => {
          const filled = value >= i + 0.75;
          const half = !filled && value >= i + 0.25;
          return (
            <span key={i} className="relative">
              <Star className="h-3.5 w-3.5 text-line-strong" fill="currentColor" />
              {(filled || half) && (
                <span className="absolute inset-0 overflow-hidden" style={{ width: half ? "50%" : "100%" }}>
                  <Star className="h-3.5 w-3.5 text-warning" fill="currentColor" />
                </span>
              )}
            </span>
          );
        })}
      </span>
      <span className="text-[12.5px] font-medium text-text-dim">
        {value.toFixed(1)}
        {count != null && <span className="text-text-faint"> ({count.toLocaleString()})</span>}
      </span>
    </span>
  );
}
