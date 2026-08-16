import type { HTMLAttributes } from "react";

import { cn } from "@/lib/cn";

/* -------------------------------------------------------------------------- */
/* Card                                                                       */
/* -------------------------------------------------------------------------- */
interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** glass = translucent blurred (marketing/dark shells); solid = opaque surface. */
  variant?: "glass" | "solid";
  /** Lift + glow on hover. */
  interactive?: boolean;
}

export function Card({ variant = "solid", interactive, className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-2xl",
        variant === "glass" ? "glass" : "border border-line bg-surface shadow-card",
        interactive &&
          "transition-all duration-300 hover:-translate-y-1.5 hover:border-accent hover:shadow-card-lg",
        className,
      )}
      {...props}
    />
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
      className={cn("shimmer rounded-lg bg-surface-hover", className)}
      {...props}
    />
  );
}
