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
      className={cn("mb-2 block text-[10.5px] uppercase tracking-wide text-text-faint", className)}
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
            "h-10 w-full border bg-transparent px-3 text-[13px] text-text",
            "placeholder:text-text-ghost transition-colors",
            /* The focus state is the border going to full contrast — no glow
               ring, which would be the only soft-edged thing on the page. */
            "focus:border-text focus:outline-none",
            leftIcon && "pl-10",
            rightSlot && "pr-11",
            invalid ? "border-danger focus:border-danger" : "border-line-strong",
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
