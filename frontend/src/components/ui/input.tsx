import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";

import { cn } from "@/lib/cn";

/* -------------------------------------------------------------------------- */
/* Label                                                                      */
/* -------------------------------------------------------------------------- */
export function Label({
  htmlFor,
  children,
  required,
  className,
}: {
  htmlFor?: string;
  children: ReactNode;
  required?: boolean;
  className?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn("mb-1.5 block text-[13.5px] font-semibold text-text", className)}
    >
      {children}
      {required && <span className="ml-0.5 text-danger">*</span>}
    </label>
  );
}

/* -------------------------------------------------------------------------- */
/* Input                                                                      */
/* -------------------------------------------------------------------------- */
export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  /** Optional icon rendered on the left. */
  leftIcon?: ReactNode;
  /** Optional element (e.g. show/hide button) rendered on the right. */
  rightSlot?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, leftIcon, rightSlot, ...props }, ref) => {
    return (
      <div className="relative">
        {leftIcon && (
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-faint">
            {leftIcon}
          </span>
        )}
        <input
          ref={ref}
          className={cn(
            "h-11 w-full rounded-xl border bg-bg-elevated px-3.5 text-[15px] text-text",
            "placeholder:text-text-faint transition-colors",
            "focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30",
            leftIcon && "pl-10",
            rightSlot && "pr-11",
            invalid ? "border-danger focus:border-danger focus:ring-danger/30" : "border-line-strong",
            className,
          )}
          {...props}
        />
        {rightSlot && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2">{rightSlot}</span>
        )}
      </div>
    );
  },
);
Input.displayName = "Input";

/* -------------------------------------------------------------------------- */
/* FormField — label + input wrapper + error/help text                        */
/* -------------------------------------------------------------------------- */
export function FormField({
  label,
  htmlFor,
  required,
  error,
  help,
  children,
}: {
  label?: string;
  htmlFor?: string;
  required?: boolean;
  error?: string;
  help?: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-4">
      {label && (
        <Label htmlFor={htmlFor} required={required}>
          {label}
        </Label>
      )}
      {children}
      {error ? (
        <p className="mt-1.5 text-[13px] text-danger">{error}</p>
      ) : help ? (
        <p className="mt-1.5 text-[13px] text-text-faint">{help}</p>
      ) : null}
    </div>
  );
}
