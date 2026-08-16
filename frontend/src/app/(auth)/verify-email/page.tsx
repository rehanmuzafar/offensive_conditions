"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { MailCheck, MailX, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { authApi } from "@/lib/auth-api";

type State = "verifying" | "success" | "error";

function VerifyInner() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [state, setState] = useState<State>("verifying");

  useEffect(() => {
    if (!token) {
      setState("error");
      return;
    }
    let cancelled = false;
    authApi
      .verifyEmail(token)
      .then(() => !cancelled && setState("success"))
      .catch(() => !cancelled && setState("error"));
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (state === "verifying") {
    return (
      <div className="text-center">
        <Loader2 className="mx-auto h-10 w-10 animate-spin text-accent" />
        <p className="mt-4 text-[15px] text-text-dim">Verifying your email…</p>
      </div>
    );
  }

  if (state === "success") {
    return (
      <div className="animate-fade-up text-center">
        <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-success/15">
          <MailCheck className="h-7 w-7 text-success" />
        </div>
        <h1 className="font-display text-[26px] font-extrabold tracking-[-0.5px]">Email verified</h1>
        <p className="mt-2 text-[14.5px] text-text-dim">
          Your account is fully activated. Time to root your first box.
        </p>
        <Link href="/dashboard">
          <Button fullWidth size="lg" className="mt-7">
            Go to dashboard
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="animate-fade-up text-center">
      <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-danger/15">
        <MailX className="h-7 w-7 text-danger" />
      </div>
      <h1 className="font-display text-[26px] font-extrabold tracking-[-0.5px]">Verification failed</h1>
      <p className="mt-2 text-[14.5px] text-text-dim">
        This link is invalid or has expired. Request a fresh verification email.
      </p>
      <Button
        variant="ghost"
        fullWidth
        size="lg"
        className="mt-7"
        onClick={() => authApi.resendVerification()}
      >
        Resend verification email
      </Button>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="h-40" />}>
      <VerifyInner />
    </Suspense>
  );
}
