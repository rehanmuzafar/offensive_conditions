"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/cn";

/**
 * A segmented control — the "All / Live now / Upcoming / Past" pattern.
 *
 * This existed as copy-pasted markup on at least four pages, each with slightly
 * different padding and a filled pill for the active item. Two problems with
 * that: the filled pill was the loudest block of colour on pages that are
 * otherwise monochrome, and every copy drifted.
 *
 * The active state is now an indicator that *slides* between options. That is
 * worth the machinery: a pill that simply appears in a new place tells you
 * where you are, while one that travels tells you where you came from, which is
 * the actual question when someone is flipping between filters.
 *
 * The indicator is measured from the DOM rather than computed from flex ratios,
 * because the options are text of different widths and any arithmetic guess
 * would drift with the font.
 */
export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Optional trailing count, rendered dimmer than the label. */
  count?: number;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  className,
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
  className?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const measure = () => {
      const active = list.querySelector<HTMLButtonElement>('[data-active="true"]');
      if (!active) return;
      setIndicator({ left: active.offsetLeft, width: active.offsetWidth });
    };

    measure();

    // Re-measure on resize and on font load: the control is set in a webfont,
    // and measuring before it swaps in leaves the indicator a few pixels off.
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    document.fonts?.ready.then(measure).catch(() => {});
    return () => observer.disconnect();
  }, [value, options]);

  const pad = size === "sm" ? "px-3 py-1.5 text-[11.5px]" : "px-4 py-2 text-[12.5px]";

  return (
    <div
      ref={listRef}
      role="tablist"
      className={cn("relative inline-flex border border-line", className)}
    >
      {/* The travelling indicator. Sits under the labels, so the active label
          keeps full contrast rather than being knocked out on a fill. */}
      {indicator && (
        <span
          aria-hidden
          className="absolute inset-y-0 z-0 bg-surface-hover transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
          style={{ left: indicator.left, width: indicator.width }}
        />
      )}
      {/* A spectral rule under the active option — the one flash of colour, and
          it travels with the indicator. */}
      {indicator && (
        <span
          aria-hidden
          className="iridescent-rule absolute bottom-0 z-10 h-px transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
          style={{ left: indicator.left, width: indicator.width }}
        />
      )}

      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            role="tab"
            aria-selected={active}
            data-active={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "relative z-10 whitespace-nowrap transition-colors duration-200",
              pad,
              active ? "text-text" : "text-text-faint hover:text-text-dim",
            )}
          >
            {option.label}
            {option.count != null && (
              <span className="ml-1.5 tabular-nums text-text-ghost">{option.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
