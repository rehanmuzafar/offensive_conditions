import clsx from "clsx";
import type { ReactNode } from "react";

/** Small shared marks used across sections — kept together so the page's
 *  vocabulary stays consistent instead of being re-invented per section. */

/** Section eyebrow: index number, rule, label. */
export function Eyebrow({
  index,
  label,
  className,
}: {
  index: string;
  label: string;
  className?: string;
}) {
  return (
    <div className={clsx("flex items-center gap-3 text-[10.5px] uppercase tracking-widest", className)}>
      <span className="text-text-ghost tabular-nums">{index}</span>
      <span className="iridescent-rule h-px w-10 opacity-70" />
      <span className="text-text-dim">{label}</span>
    </div>
  );
}

/** Giant ghost word that sits behind a section, echoing the outline type on
 *  technical drawings. Hidden from assistive tech — it is pure texture. */
export function GhostWord({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={clsx(
        "outline-type pointer-events-none select-none font-display font-extrabold uppercase leading-[0.8] tracking-mega",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Filled/outline pill button pair, matching the nav's invert-fill hover. */
export function ActionLink({
  href,
  children,
  variant = "outline",
  className,
}: {
  href: string;
  children: ReactNode;
  variant?: "solid" | "outline";
  className?: string;
}) {
  if (variant === "solid") {
    return (
      <a
        href={href}
        className={clsx(
          "no-text-shadow group relative inline-flex items-center gap-2.5 overflow-hidden rounded-full bg-text px-7 py-3.5 text-[13px] font-medium text-bg transition-colors duration-300",
          className,
        )}
      >
        <span className="relative z-10 transition-colors duration-300 group-hover:text-text">
          {children}
        </span>
        <span className="relative z-10 transition-transform duration-300 group-hover:translate-x-1 group-hover:text-text">
          →
        </span>
        <span className="absolute inset-0 translate-y-full bg-bg-elevated transition-transform duration-300 ease-[cubic-bezier(0.2,0.7,0.3,1)] group-hover:translate-y-0" />
      </a>
    );
  }

  return (
    <a
      href={href}
      className={clsx(
        "group relative inline-flex items-center gap-2.5 overflow-hidden rounded-full border border-text/20 px-7 py-3.5 text-[13px] text-text transition-colors duration-300 hover:text-bg",
        className,
      )}
    >
      <span className="relative z-10">{children}</span>
      <span className="relative z-10 transition-transform duration-300 group-hover:translate-x-1">
        →
      </span>
      <span className="absolute inset-0 translate-y-full bg-text transition-transform duration-300 ease-[cubic-bezier(0.2,0.7,0.3,1)] group-hover:translate-y-0" />
    </a>
  );
}
