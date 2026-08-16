"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/input";
import { PasswordInput, PasswordStrength, scorePassword } from "@/components/ui/password-input";
import { useResetPassword } from "@/hooks/use-auth";

function ResetForm() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const reset = useResetPassword();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const strong = scorePassword(password).score >= 3;
  const match = password === confirm && confirm.length > 0;
  const canSubmit = strong && match && token.length > 0;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (canSubmit) reset.mutate({ token, password });
  }

  if (!token) {
    return (
      <div className="text-center">
        <h1 className="font-display text-[24px] font-extrabold">Invalid reset link</h1>
        <p className="mt-2 text-[14.5px] text-text-dim">
          This link is missing or malformed. Request a new one.
        </p>
        <Link href="/forgot-password">
          <Button variant="ghost" fullWidth size="lg" className="mt-6">
            Request new link
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="animate-fade-up">
      <h1 className="font-display text-[28px] font-extrabold tracking-[-0.5px]">Set a new password</h1>
      <p className="mt-1.5 text-[15px] text-text-dim">Choose a strong password you don&apos;t use elsewhere.</p>

      <form onSubmit={onSubmit} noValidate className="mt-7">
        <FormField label="New password" htmlFor="password" required>
          <PasswordInput
            id="password"
            autoComplete="new-password"
            required
            placeholder="New password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <PasswordStrength value={password} />
        </FormField>

        <FormField
          label="Confirm password"
          htmlFor="confirm"
          required
          error={confirm.length > 0 && !match ? "Passwords don't match." : undefined}
        >
          <PasswordInput
            id="confirm"
            autoComplete="new-password"
            required
            placeholder="Re-enter password"
            invalid={confirm.length > 0 && !match}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </FormField>

        <Button type="submit" fullWidth size="lg" loading={reset.isPending} disabled={!canSubmit} className="mt-2">
          Update password
        </Button>
      </form>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="h-40" />}>
      <ResetForm />
    </Suspense>
  );
}
