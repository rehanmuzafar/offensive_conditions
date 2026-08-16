"use client";

import { useEffect, useState } from "react";

/**
 * <Countdown /> — live ticking countdown to a target ISO timestamp. Renders
 * d/h/m/s blocks. Calls onComplete once when it hits zero.
 */
export function Countdown({ to, onComplete }: { to: string; onComplete?: () => void }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const diff = Math.max(0, new Date(to).getTime() - now);
  useEffect(() => {
    if (diff === 0) onComplete?.();
  }, [diff, onComplete]);

  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);

  return (
    <div className="flex gap-2">
      {d > 0 && <Block value={d} label="days" />}
      <Block value={h} label="hrs" />
      <Block value={m} label="min" />
      <Block value={s} label="sec" />
    </div>
  );
}

function Block({ value, label }: { value: number; label: string }) {
  return (
    <div className="min-w-[52px] rounded-xl border border-line bg-bg-elevated px-2.5 py-2 text-center">
      <div className="font-display text-[22px] font-extrabold leading-none tabular-nums">
        {String(value).padStart(2, "0")}
      </div>
      <div className="mt-1 text-[10px] uppercase tracking-wide text-text-faint">{label}</div>
    </div>
  );
}
