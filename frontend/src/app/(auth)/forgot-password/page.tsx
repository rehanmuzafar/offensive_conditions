"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Mail, ArrowLeft, MailCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/input";
import { useRequestPasswordReset } from "@/hooks/use-auth";

export default function ForgotPasswordPage() {
  const reset = useRequestPasswordReset();
  const [email, setEmail] = useState("");
  const sent = reset.isSuccess;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    reset.mutate(email);
  }

  if (sent) {
    return (
      <div className="animate-fade-up text-center">
        <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-success/15">
          <MailCheck className="h-7 w-7 text-success" />
        </div>
        <h1 className="font-display text-[26px] font-extrabold tracking-[-0.5px]">Check your inbox</h1>
        <p className="mx-auto mt-2 max-w-[340px] text-[14.5px] text-text-dim">
          If an account exists for <b className="text-text">{email}</b>, we&apos;ve sent a link to
          reset your password. It expires in 30 minutes.
        </p>
        <Link href="/login">
          <Button variant="ghost" fullWidth size="lg" className="mt-7">
            <ArrowLeft className="h-[18px] w-[18px]" /> Back to sign in
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="animate-fade-up">
      <h1 className="font-display text-[28px] font-extrabold tracking-[-0.5px]">Forgot password?</h1>
      <p className="mt-1.5 text-[15px] text-text-dim">
        No worries. Enter your email and we&apos;ll send you a reset link.
      </p>

      <form onSubmit={onSubmit} noValidate className="mt-7">
        <FormField label="Email" htmlFor="email" required>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@example.com"
            leftIcon={<Mail className="h-[18px] w-[18px]" />}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </FormField>
        <Button type="submit" fullWidth size="lg" loading={reset.isPending} className="mt-2">
          Send reset link
        </Button>
      </form>

      <Link href="/login" className="mt-6 flex items-center justify-center gap-1.5 text-[14px] text-text-dim hover:text-text">
        <ArrowLeft className="h-4 w-4" /> Back to sign in
      </Link>
    </div>
  );
}
