import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/cn";

type Variant = "primary" | "ghost" | "outline" | "subtle" | "danger" | "white";
type Size = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  fullWidth?: boolean;
}

/**
 * Every variant is a rectangle with a one-pixel border and no shadow. Depth in
 * this design comes from the hairline and the ground behind it, not from
 * elevation, so a button that lifts on hover reads as belonging to a different
 * product.
 */
const base =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap border font-medium " +
  "transition-colors duration-200 select-none " +
  "disabled:opacity-40 disabled:pointer-events-none " +
  "focus-visible:outline-1 focus-visible:outline-offset-2";

/**
 * `primary` is `bg-text` on `text-bg` rather than a fixed white or black, which
 * means it inverts with the theme for free: bone-on-black in ink, black-on-
 * paper in light. Hover empties the fill instead of brightening it — the same
 * invert the marketing nav uses.
 */
const variants: Record<Variant, string> = {
  primary: "border-text bg-text text-bg hover:bg-transparent hover:text-text",
  ghost: "border-line-strong bg-transparent text-text hover:border-text hover:bg-surface-hover",
  outline: "border-accent/50 bg-transparent text-accent hover:border-accent hover:bg-accent/10",
  subtle: "border-line bg-surface text-text-dim hover:bg-surface-hover hover:text-text",
  danger: "border-danger/50 bg-transparent text-danger hover:border-danger hover:bg-danger/10",
  /* Kept as an alias so existing marketing CTAs keep working; it resolves to
     the same invert as `primary`. */
  white: "border-text bg-text text-bg hover:bg-transparent hover:text-text",
};

/* Monospace runs wide, so each step is a shade smaller than its proportional
   equivalent would be. */
const sizes: Record<Size, string> = {
  sm: "h-8 px-3.5 text-[12px]",
  md: "h-10 px-5 text-[13px]",
  lg: "h-12 px-7 text-[14px]",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { variant = "primary", size = "md", loading, fullWidth, className, children, disabled, ...props },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(base, variants[variant], sizes[size], fullWidth && "w-full", className)}
        {...props}
      >
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {children}
      </button>
    );
  },
);
Button.displayName = "Button";
