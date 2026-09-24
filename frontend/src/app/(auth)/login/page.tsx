"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Mail } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { OAuthButtons, OrDivider } from "../_components/oauth-buttons";
import { useLogin } from "@/hooks/use-auth";
import { SignInFormFade } from "@/components/auth/sign-in-transition";

export default function LoginPage() {
  const login = useLogin();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    login.mutate({ email, password });
  }

  return (
    <SignInFormFade>
      <div className="animate-fade-up">
      <h1 className="font-display text-[28px] font-extrabold tracking-[-0.5px]">Welcome back</h1>
      <p className="mt-1.5 text-[15px] text-text-dim">
        Sign in to continue your offensive security journey.
      </p>

      <div className="mt-7">
        <OAuthButtons disabled={login.isPending} />
        <OrDivider />

        <form onSubmit={onSubmit} noValidate>
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

          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[13.5px] font-semibold text-text">Password</span>
            <Link href="/forgot-password" className="text-[13px] font-medium text-accent hover:underline">
              Forgot password?
            </Link>
          </div>
          <PasswordInput
            id="password"
            autoComplete="current-password"
            required
            placeholder="Your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <Button type="submit" fullWidth size="lg" loading={login.isPending} className="mt-6">
            Sign in
          </Button>
        </form>
      </div>

      <p className="mt-6 text-center text-[14.5px] text-text-dim">
        New to OFFCON?{" "}
        <Link href="/register" className="font-semibold text-accent hover:underline">
          Create an account
        </Link>
      </p>
      </div>
    </SignInFormFade>
  );
}
