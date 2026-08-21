import type { HTMLAttributes } from "react";

import { cn } from "@/lib/cn";

type BadgeTone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

/**
 * Tones carry their colour in the text and the border only. A filled pill puts
 * a block of hue on a page whose whole argument is that colour is scarce; a
 * hairline box with coloured type says the same thing and stays out of the way.
 */
const tones: Record<BadgeTone, string> = {
  neutral: "border-line text-text-faint",
  brand: "border-accent/40 text-accent",
  success: "border-success/40 text-success",
  warning: "border-warning/40 text-warning",
  danger: "border-danger/40 text-danger",
  info: "border-info/40 text-info",
};

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  dot?: boolean;
}

export function Badge({ tone = "neutral", dot, className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 border px-2 py-0.5",
        "text-[10px] uppercase tracking-wide",
        tones[tone],
        className,
      )}
      {...props}
    >
      {dot && <span className="h-1 w-1 rounded-full bg-current animate-pulse-dot" />}
      {children}
    </span>
  );
}
