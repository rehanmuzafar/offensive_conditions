"use client";

import { useCallback, useRef, type HTMLAttributes } from "react";

import { cn } from "@/lib/cn";

/* -------------------------------------------------------------------------- */
/* Card                                                                       */
/* -------------------------------------------------------------------------- */
interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** glass = thin wash; solid = heavier wash for panels that must hold dense
   *  text. Both blur — a block with a scene behind it and no blur reads as a
   *  hole punched in the page. */
  variant?: "glass" | "solid";
  /** Border brightens and a spectral edge resolves on hover. On by default:
   *  every panel in the product answers the pointer, so opting *out* is the
   *  exception — pass `interactive={false}` for something genuinely inert. */
  interactive?: boolean;
  /** A soft highlight that tracks the pointer across the panel. */
  spotlight?: boolean;
}

/**
 * A panel is a hairline rectangle. It does not lift, glow, or round — on a
 * ruled ground the edge is what separates it from the page, and adding a
 * shadow underneath makes it float off a surface that has no depth to float
 * from. `interactive` brightens the border and nothing else.
 */
export function Card({ variant = "glass", interactive = true, spotlight, className, ...props }: CardProps) {
  const glare = useRef<HTMLSpanElement>(null);

  /**
   * The highlight is written straight to the element's style from the pointer
   * event — no state, no re-render. A card that re-rendered on mousemove would
   * be the most expensive thing on a dashboard full of them.
   */
  const onMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const node = glare.current;
    if (!node) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 100;
    const y = ((e.clientY - r.top) / r.height) * 100;
    node.style.opacity = "1";
    node.style.background = `radial-gradient(340px circle at ${x}% ${y}%, rgb(var(--text) / 0.07), transparent 62%)`;
  }, []);

  const onLeave = useCallback(() => {
    const node = glare.current;
    if (node) node.style.opacity = "0";
  }, []);

  return (
    <div
      className={cn(
        variant === "glass" ? "glass" : "glass-strong",
        interactive && "edge-iridescent transition-colors duration-300 hover:border-line-strong",
        spotlight && "relative overflow-hidden",
        className,
      )}
      onPointerMove={spotlight ? onMove : undefined}
      onPointerLeave={spotlight ? onLeave : undefined}
      {...props}
    >
      {spotlight && (
        <span
          ref={glare}
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300"
        />
      )}
      {props.children}
    </div>
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-6 pb-0", className)} {...props} />;
}
export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-6", className)} {...props} />;
}
export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-6 pt-0", className)} {...props} />;
}

/* -------------------------------------------------------------------------- */
/* Skeleton                                                                   */
/* -------------------------------------------------------------------------- */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("shimmer bg-surface-hover", className)}
      {...props}
    />
  );
}
