/**
 * <Stat /> — a single headline metric with the brand-gradient number.
 * Used in the landing stats strip and dashboards.
 */

import { Card } from "@/components/ui/card";

export function Stat({ value, label }: { value: string; label: string }) {
  return (
    <Card interactive className="px-4 py-6 text-center">
      <div className="font-display text-[38px] font-extrabold leading-none text-gradient">
        {value}
      </div>
      <div className="mt-2 text-[14px] font-medium text-text-dim">{label}</div>
    </Card>
  );
}
