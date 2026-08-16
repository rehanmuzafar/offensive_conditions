"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Mail, User } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/input";
import { PasswordInput, PasswordStrength, scorePassword } from "@/components/ui/password-input";
import { OAuthButtons, OrDivider } from "../_components/oauth-buttons";
import { useRegister } from "@/hooks/use-auth";

export default function RegisterPage() {
  const register = useRegister();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accept, setAccept] = useState(false);

  const pwOk = scorePassword(password).score >= 3;
  const canSubmit = username.length >= 3 && email.includes("@") && pwOk && accept;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    register.mutate({ username, email, password, acceptTerms: accept });
  }

  return (
    <div className="animate-fade-up">
      <h1 className="font-display text-[28px] font-extrabold tracking-[-0.5px]">Create your account</h1>
      <p className="mt-1.5 text-[15px] text-text-dim">
        Start hacking for free. No credit card required.
      </p>

      <div className="mt-7">
        <OAuthButtons disabled={register.isPending} />
        <OrDivider text="or sign up with email" />

        <form onSubmit={onSubmit} noValidate>
          <FormField
            label="Username"
            htmlFor="username"
            required
            help="This is your public handle on the leaderboard."
          >
            <Input
              id="username"
              autoComplete="username"
              required
              placeholder="sh4dowByte"
              leftIcon={<User className="h-[18px] w-[18px]" />}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </FormField>

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

          <FormField label="Password" htmlFor="password" required>
            <PasswordInput
              id="password"
              autoComplete="new-password"
              required
              placeholder="Create a strong password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <PasswordStrength value={password} />
          </FormField>

          <label className="mb-4 flex cursor-pointer items-start gap-2.5 text-[13.5px] text-text-dim">
            <input
              type="checkbox"
              checked={accept}
              onChange={(e) => setAccept(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-line-strong accent-brand-purple"
            />
            <span>
              I agree to the{" "}
              <Link href="/terms" className="font-medium text-accent hover:underline">Terms</Link> and{" "}
              <Link href="/privacy" className="font-medium text-accent hover:underline">Privacy Policy</Link>.
            </span>
          </label>

          <Button type="submit" fullWidth size="lg" loading={register.isPending} disabled={!canSubmit}>
            Create account
          </Button>
        </form>
      </div>

      <p className="mt-6 text-center text-[14.5px] text-text-dim">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
