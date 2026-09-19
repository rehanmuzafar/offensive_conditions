/**
 * <Stat /> — a single headline metric.
 *
 * The number used to carry the brand gradient. In a monochrome design the
 * figure is already the loudest thing in its box by size alone; colouring it as
 * well made a row of four stat tiles read as four separate badges. It is now
 * full-contrast type over a hairline box, with the label demoted to a caption.
 */

import { Card } from "@/components/ui/card";

export function Stat({ value, label }: { value: string; label: string }) {
  return (
    <Card interactive className="px-4 py-6">
      <div className="font-display text-[clamp(28px,3.4vw,42px)] font-extrabold leading-none tracking-mega tabular-nums">
        {value}
      </div>
      <div className="mt-3 text-[10.5px] uppercase tracking-wide text-text-faint">{label}</div>
    </Card>
  );
}
