"use client";

/**
 * A horizontal row of program cards.
 *
 * A row that scrolls rather than a grid that wraps: each row is a *ranking*
 * ("top paying", "answers fastest"), and a wrapped grid destroys rank order —
 * position four ends up below position one instead of after it. Scrolling keeps
 * the sequence readable left to right.
 *
 * Native scroll-snap rather than a carousel library: the arrows are a
 * convenience, and dragging, trackpads and keyboard scrolling all keep working
 * without any of it being reimplemented.
 */

import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { ProgramCard } from "@/components/bounty/program-card";
import { cn } from "@/lib/cn";
import type { BountyProgram } from "@/types/bounty";

export function ProgramRow({
  title,
  hint,
  programs,
}: {
  title: string;
  hint?: string;
  programs: BountyProgram[];
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  if (programs.length === 0) return null;

  const scrollBy = (dir: 1 | -1) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.round(el.clientWidth * 0.8), behavior: "smooth" });
  };

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    setAtStart(el.scrollLeft < 8);
    // 8px of slack: sub-pixel widths mean scrollLeft rarely lands exactly.
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 8);
  };

  return (
    <section>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-[19px] font-bold tracking-[-0.3px]">{title}</h2>
          {hint && <p className="mt-0.5 text-[13px] text-text-dim">{hint}</p>}
        </div>
        <div className="hidden shrink-0 gap-1.5 sm:flex">
          <ArrowButton dir="left" disabled={atStart} onClick={() => scrollBy(-1)} />
          <ArrowButton dir="right" disabled={atEnd} onClick={() => scrollBy(1)} />
        </div>
      </div>

      <div
        ref={scroller}
        onScroll={onScroll}
        className="mt-4 flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {programs.map((p) => (
          <div
            key={p.id}
            className="w-[290px] shrink-0 snap-start sm:w-[310px]"
          >
            <ProgramCard program={p} />
          </div>
        ))}
      </div>
    </section>
  );
}

function ArrowButton({
  dir,
  disabled,
  onClick,
}: {
  dir: "left" | "right";
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = dir === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={dir === "left" ? "Scroll left" : "Scroll right"}
      className={cn(
        "grid h-8 w-8 place-items-center rounded-full border border-line transition-colors",
        disabled
          ? "cursor-default text-text-ghost opacity-40"
          : "text-text-dim hover:border-line-strong hover:text-text",
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
