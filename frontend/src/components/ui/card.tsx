"use client";

import { useCallback, useEffect, useRef, type HTMLAttributes } from "react";

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
  /**
   * The whole panel tilts toward the pointer in 3D — the corner under the
   * cursor lifts toward the viewer — with a slight scale and a glare that
   * tracks the same point. Off by default because it is a marketing flourish:
   * a dashboard full of tables should not lean when you mouse across it. Turned
   * on for the public pages, where each block is something to enjoy rather than
   * work through. Honours `prefers-reduced-motion` and never runs on touch.
   */
  tilt?: boolean;
}

/** Maximum tilt in degrees at the card's edge. Small on purpose — past ~8° the
 *  text starts to keystone and the panel reads as a trick rather than depth. */
const MAX_TILT = 7;

/**
 * A panel is a hairline rectangle. On the app surfaces it does not lift, glow,
 * or round — on a ruled ground the edge is what separates it from the page.
 * On the public pages it can `tilt`: the same rectangle, given depth and a
 * pointer-tracked response, because there the block is the thing being looked
 * at rather than looked past.
 */
export function Card({
  variant = "glass",
  interactive = true,
  spotlight,
  tilt,
  className,
  style,
  ...props
}: CardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const glare = useRef<HTMLSpanElement>(null);
  const reduced = useRef(false);
  const wantsPointer = spotlight || tilt;

  useEffect(() => {
    // Captured once rather than read on every pointer event: matchMedia is not
    // free, and the answer does not change mid-hover.
    reduced.current =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  /**
   * Both the glare and the tilt are written straight to the element's style
   * from the pointer event — no state, no re-render. A card that re-rendered on
   * mousemove would be the most expensive thing on a page full of them.
   */
  const onMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Fine pointer only: a tilt driven by a touch's last-known point sticks
      // the card mid-lean after the finger lifts.
      if (e.pointerType === "touch") return;
      const r = e.currentTarget.getBoundingClientRect();
      const gx = ((e.clientX - r.left) / r.width) * 100;
      const gy = ((e.clientY - r.top) / r.height) * 100;

      const node = glare.current;
      if (node) {
        node.style.opacity = "1";
        node.style.background = `radial-gradient(340px circle at ${gx}% ${gy}%, rgb(var(--text) / 0.08), transparent 62%)`;
      }

      if (tilt && !reduced.current && cardRef.current) {
        // -0.5..0.5 from the card centre. rotateY follows x; rotateX is the
        // negative of y so the edge *under* the cursor comes toward the viewer.
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        cardRef.current.style.transform =
          `perspective(900px) rotateX(${(-py * MAX_TILT).toFixed(2)}deg) ` +
          `rotateY(${(px * MAX_TILT).toFixed(2)}deg) scale(1.02)`;
      }
    },
    [tilt],
  );

  const onLeave = useCallback(() => {
    const node = glare.current;
    if (node) node.style.opacity = "0";
    if (tilt && cardRef.current) {
      cardRef.current.style.transform =
        "perspective(900px) rotateX(0deg) rotateY(0deg) scale(1)";
    }
  }, [tilt]);

  return (
    <div
      ref={cardRef}
      className={cn(
        variant === "glass" ? "glass" : "glass-strong",
        interactive && "edge-iridescent transition-colors duration-300 hover:border-line-strong",
        (spotlight || tilt) && "relative overflow-hidden",
        // The transform eases on its own line so the return-to-rest glides;
        // during an active move it lags by a frame, which reads as weight.
        tilt && "[transition:transform_220ms_cubic-bezier(0.22,1,0.36,1),border-color_300ms] [transform-style:preserve-3d] will-change-transform hover:z-[1]",
        className,
      )}
      onPointerMove={wantsPointer ? onMove : undefined}
      onPointerLeave={wantsPointer ? onLeave : undefined}
      style={style}
      {...props}
    >
      {(spotlight || tilt) && (
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
