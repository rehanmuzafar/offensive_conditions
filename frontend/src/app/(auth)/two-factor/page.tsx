"use client";

import { Suspense, useState, useRef, type ClipboardEvent, type KeyboardEvent } from "react";
import { useSearchParams } from "next/navigation";
import { ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useVerifyTwoFactor } from "@/hooks/use-auth";

const LEN = 6;

function TwoFactorForm() {
  const params = useSearchParams();
  const challengeId = params.get("challenge") ?? "";
  const verify = useVerifyTwoFactor();

  const [digits, setDigits] = useState<string[]>(Array(LEN).fill(""));
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const code = digits.join("");
  const complete = code.length === LEN;

  function setDigit(i: number, v: string) {
    const ch = v.replace(/\D/g, "").slice(-1);
    setDigits((prev) => {
      const next = [...prev];
      next[i] = ch;
      return next;
    });
    if (ch && i < LEN - 1) refs.current[i + 1]?.focus();
  }

  function onKeyDown(i: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[i] && i > 0) refs.current[i - 1]?.focus();
  }

  function onPaste(e: ClipboardEvent) {
    e.preventDefault();
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, LEN);
    if (text) {
      const next = Array(LEN).fill("");
      for (let i = 0; i < text.length; i++) next[i] = text[i]!;
      setDigits(next);
      refs.current[Math.min(text.length, LEN - 1)]?.focus();
    }
  }

  function submit() {
    if (complete && challengeId) verify.mutate({ challengeId, code });
  }

  return (
    <div className="animate-fade-up text-center">
      <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-brand-gradient shadow-glow">
        <ShieldCheck className="h-7 w-7 text-white" />
      </div>
      <h1 className="font-display text-[26px] font-extrabold tracking-[-0.5px]">Two-factor verification</h1>
      <p className="mx-auto mt-2 max-w-[320px] text-[14.5px] text-text-dim">
        Enter the 6-digit code from your authenticator app.
      </p>

      <div className="mt-7 flex justify-center gap-2.5" onPaste={onPaste}>
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            inputMode="numeric"
            maxLength={1}
            value={d}
            onChange={(e) => setDigit(i, e.target.value)}
            onKeyDown={(e) => onKeyDown(i, e)}
            className="h-14 w-12 rounded-xl border border-line-strong bg-bg-elevated text-center font-display text-[24px] font-bold text-text focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
        ))}
      </div>

      <Button
        fullWidth
        size="lg"
        className="mt-7"
        loading={verify.isPending}
        disabled={!complete}
        onClick={submit}
      >
        Verify &amp; continue
      </Button>

      <button className="mt-5 text-[13.5px] text-text-dim hover:text-text">
        Use a backup code instead
      </button>
    </div>
  );
}

export default function TwoFactorPage() {
  return (
    <Suspense>
      <TwoFactorForm />
    </Suspense>
  );
}
