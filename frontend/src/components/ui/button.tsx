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

const base =
  "inline-flex items-center justify-center gap-2 font-semibold rounded-xl whitespace-nowrap " +
  "transition-all duration-200 disabled:opacity-50 disabled:pointer-events-none " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 select-none";

const variants: Record<Variant, string> = {
  primary:
    "bg-brand-gradient text-white shadow-glow hover:-translate-y-0.5 hover:shadow-glow-lg",
  ghost:
    "bg-transparent text-text border border-line-strong hover:bg-surface-hover hover:border-accent",
  outline:
    "bg-transparent text-accent border border-accent/40 hover:bg-accent/10",
  subtle: "bg-surface text-text border border-line hover:bg-surface-hover",
  danger: "bg-danger text-white hover:brightness-110",
  white: "bg-white text-brand-purple-dark hover:-translate-y-0.5 hover:shadow-card-lg",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-4 text-[13.5px]",
  md: "h-11 px-5 text-[14.5px]",
  lg: "h-[52px] px-7 text-[16px] rounded-2xl",
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
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {children}
      </button>
    );
  },
);
Button.displayName = "Button";
