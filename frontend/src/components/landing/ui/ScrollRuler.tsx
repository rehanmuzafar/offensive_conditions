"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { scroll, sections } from "@/components/landing/lib/telemetry";
import { useUI } from "@/components/landing/lib/store";

/**
 * The measuring rule down the left edge: 40 ticks whose length is driven by
 * how close each one is to the playhead, plus the current section's name.
 *
 * The tick lengths are written straight to the DOM from rAF rather than
 * through state — 40 elements re-rendering at 60Hz is exactly the kind of
 * thing that makes a scroll feel heavy on a mid-range laptop.
 */
const TICKS = 40;

export default function ScrollRuler() {
  const active = useUI((s) => s.active);
  const sceneReady = useUI((s) => s.sceneReady);
  const container = useRef<HTMLDivElement>(null);
  const [label, setLabel] = useState("TOP");

  useEffect(() => {
    const found = sections.find((s) => s.id === active);
    if (found) setLabel(found.label);
  }, [active]);

  useEffect(() => {
    const nodes = container.current?.querySelectorAll<HTMLSpanElement>("[data-tick]");
    if (!nodes) return;

    let frame = 0;
    const loop = () => {
      const head = scroll.progress * (TICKS - 1);
      nodes.forEach((node, i) => {
        // Triangular falloff: the tick under the playhead is full length,
        // neighbours taper off over four steps.
        const d = Math.abs(i - head);
        const near = Math.max(0, 1 - d / 4);
        const width = 6 + near * 22;
        node.style.width = `${width}px`;
        node.style.opacity = `${0.16 + near * 0.84}`;
      });
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      aria-hidden
      className={clsx(
        "pointer-events-none fixed left-0 top-1/2 z-30 hidden -translate-y-1/2 transition-opacity duration-700 lg:block",
        sceneReady ? "opacity-100" : "opacity-0",
      )}
    >
      <div className="flex items-center gap-3">
        <div ref={container} className="flex flex-col gap-[7px]">
          {Array.from({ length: TICKS }).map((_, i) => (
            <span
              key={i}
              data-tick
              className="block h-px bg-text"
              style={{ width: 6, opacity: 0.16 }}
            />
          ))}
        </div>
        <span className="text-[10px] uppercase tracking-widest text-text-dim">{label}</span>
      </div>
    </div>
  );
}
