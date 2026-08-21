"use client";

import { useEffect, useRef } from "react";

/**
 * A crosshair cursor with a lagging reticle.
 *
 * The dot tracks the pointer exactly (anything else feels broken when you go
 * to click something); the ring follows on a spring and swells over anything
 * interactive. Both are driven by direct transform writes on rAF — routing a
 * cursor through React state is the classic way to make one stutter.
 *
 * Suppressed entirely on coarse pointers, where there is no cursor to augment.
 *
 * The native arrow is hidden by adding a class to <html>, and only after this
 * component has mounted and seen a real pointer move. Putting `cursor: none`
 * in the stylesheet instead would leave anyone whose JS failed to load with no
 * cursor at all — the page would look frozen rather than degraded.
 */
export default function Cursor() {
  const dot = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia("(pointer: coarse)").matches) return;

    const target = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const eased = { ...target };
    let hovering = false;
    let visible = false;

    const onMove = (e: PointerEvent) => {
      target.x = e.clientX;
      target.y = e.clientY;

      if (!visible) {
        visible = true;
        document.documentElement.classList.add("has-custom-cursor");
        if (dot.current) dot.current.style.opacity = "1";
        if (ring.current) ring.current.style.opacity = "1";
      }

      const el = e.target as HTMLElement | null;
      hovering = !!el?.closest("a, button, [data-cursor='hover']");
    };

    const onLeave = () => {
      visible = false;
      if (dot.current) dot.current.style.opacity = "0";
      if (ring.current) ring.current.style.opacity = "0";
    };

    let frame = 0;
    const loop = () => {
      eased.x += (target.x - eased.x) * 0.18;
      eased.y += (target.y - eased.y) * 0.18;

      if (dot.current) {
        dot.current.style.transform = `translate3d(${target.x}px, ${target.y}px, 0) translate(-50%, -50%)`;
      }
      if (ring.current) {
        const s = hovering ? 2.1 : 1;
        ring.current.style.transform = `translate3d(${eased.x}px, ${eased.y}px, 0) translate(-50%, -50%) scale(${s})`;
        ring.current.style.borderColor = hovering
          ? "rgba(244,244,245,0.85)"
          : "rgba(244,244,245,0.32)";
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(frame);
      document.documentElement.classList.remove("has-custom-cursor");
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[60] hidden lg:block">
      <div
        ref={ring}
        className="absolute left-0 top-0 h-8 w-8 rounded-full border opacity-0 transition-[border-color] duration-200"
        style={{ borderColor: "rgba(244,244,245,0.32)" }}
      />
      <div ref={dot} className="absolute left-0 top-0 opacity-0">
        {/* A '+' rather than a dot, to rhyme with the ticks on the grid. */}
        <span className="absolute left-1/2 top-1/2 block h-px w-3 -translate-x-1/2 -translate-y-1/2 bg-text" />
        <span className="absolute left-1/2 top-1/2 block h-3 w-px -translate-x-1/2 -translate-y-1/2 bg-text" />
      </div>
    </div>
  );
}
