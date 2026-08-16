"use client";

import { useState, forwardRef } from "react";
import { Eye, EyeOff, Lock } from "lucide-react";

import { Input, type InputProps } from "./input";
import { cn } from "@/lib/cn";
import { PASSWORD_POLICY } from "@/types/auth";

/* Password field with reveal toggle. */
export const PasswordInput = forwardRef<HTMLInputElement, InputProps>(
  ({ ...props }, ref) => {
    const [show, setShow] = useState(false);
    return (
      <Input
        ref={ref}
        type={show ? "text" : "password"}
        leftIcon={<Lock className="h-[18px] w-[18px]" />}
        rightSlot={
          <button
            type="button"
            tabIndex={-1}
            aria-label={show ? "Hide password" : "Show password"}
            onClick={() => setShow((v) => !v)}
            className="grid h-8 w-8 place-items-center rounded-lg text-text-faint hover:text-text"
          >
            {show ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
          </button>
        }
        {...props}
      />
    );
  },
);
PasswordInput.displayName = "PasswordInput";

/* -------------------------------------------------------------------------- */
/* Strength meter                                                             */
/* -------------------------------------------------------------------------- */
export interface PasswordCheck {
  label: string;
  met: boolean;
}

export function scorePassword(pw: string): { score: number; checks: PasswordCheck[] } {
  const checks: PasswordCheck[] = [
    { label: `At least ${PASSWORD_POLICY.minLength} characters`, met: pw.length >= PASSWORD_POLICY.minLength },
    { label: "An uppercase letter", met: /[A-Z]/.test(pw) },
    { label: "A number", met: /[0-9]/.test(pw) },
    { label: "A symbol", met: /[^A-Za-z0-9]/.test(pw) },
  ];
  const score = checks.filter((c) => c.met).length;
  return { score, checks };
}

const LABELS = ["Too weak", "Weak", "Fair", "Good", "Strong"];
const COLORS = ["bg-danger", "bg-danger", "bg-warning", "bg-info", "bg-success"];

export function PasswordStrength({ value }: { value: string }) {
  const { score, checks } = scorePassword(value);
  if (!value) return null;

  return (
    <div className="mt-2">
      <div className="flex gap-1.5">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={cn(
              "h-1.5 flex-1 rounded-full transition-colors",
              i < score ? COLORS[score] : "bg-line-strong",
            )}
          />
        ))}
      </div>
      <div className="mt-1.5 flex items-center justify-between">
        <span className="text-[12.5px] text-text-faint">Password strength</span>
        <span
          className={cn(
            "text-[12.5px] font-semibold",
            score <= 1 ? "text-danger" : score === 2 ? "text-warning" : score === 3 ? "text-info" : "text-success",
          )}
        >
          {LABELS[score]}
        </span>
      </div>
      <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
        {checks.map((c) => (
          <li
            key={c.label}
            className={cn(
              "flex items-center gap-1.5 text-[12px]",
              c.met ? "text-success" : "text-text-faint",
            )}
          >
            <span
              className={cn(
                "grid h-3.5 w-3.5 place-items-center rounded-full text-[9px]",
                c.met ? "bg-success/20" : "bg-surface-hover",
              )}
            >
              {c.met ? "✓" : ""}
            </span>
            {c.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
