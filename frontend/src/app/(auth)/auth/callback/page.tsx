"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldX } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/stores/auth-store";
import { authApi } from "@/lib/auth-api";
import { playSignInTransition } from "@/components/landing/lib/transition";
import { SignInTransition } from "@/components/auth/sign-in-transition";

/**
 * Landing page for the backend's OAuth redirect.
 * The auth service completes the token exchange server-side, then redirects
 * here with tokens in the URL hash fragment:
 *   /auth/callback#access_token=...&refresh_token=...&expires_in=...&user_id=...
 *
 * Hash fragments are never sent to the server, so tokens stay client-only.
 */
function CallbackInner() {
  const router = useRouter();
  const setSession = useAuthStore((s) => s.setSession);
  const setUser = useAuthStore((s) => s.setUser);
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const hash = window.location.hash.slice(1); // remove leading #
    const params = new URLSearchParams(hash);

    const oauthError = params.get("oauth_error");
    if (oauthError) {
      setError(oauthError);
      return;
    }

    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    const expiresIn = Number(params.get("expires_in") ?? "3600");

    if (!accessToken || !refreshToken) {
      setError("missing_tokens");
      return;
    }

    // Store the token first so the API client is authenticated, then fetch the
    // real profile (username/tier/roles) before landing on the dashboard —
    // otherwise the topbar falls back to "operator".
    setSession({ accessToken, refreshToken, expiresIn }, null as never);

    (async () => {
      // The same sign-in cinematic the email/password path plays. It lived only
      // in `useLogin`, so signing in with Google skipped it entirely and dropped
      // straight onto the dashboard — the two routes end in the same place and
      // should feel the same getting there.
      const cinematic = playSignInTransition();

      try {
        const user = await authApi.me();
        setUser(user);
      } catch {
        // Non-fatal: the token is set; the profile is re-fetched on next boot.
      } finally {
        // Clear sensitive data from the URL before pushing to history.
        window.history.replaceState(null, "", "/auth/callback");
        await cinematic;
        router.replace("/dashboard");
      }
    })();
  }, [router, setSession, setUser]);

  if (error) {
    return (
      <div className="animate-fade-up text-center">
        <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-danger/15">
          <ShieldX className="h-7 w-7 text-danger" />
        </div>
        <h1 className="font-display text-[26px] font-extrabold tracking-[-0.5px]">Sign-in failed</h1>
        <p className="mt-2 text-[14.5px] text-text-dim">
          We couldn&apos;t complete that sign-in. Please try again.
        </p>
        <Link href="/login">
          <Button fullWidth size="lg" className="mt-7">Back to sign in</Button>
        </Link>
      </div>
    );
  }

  return (
    <>
      <SignInTransition />
      <div className="text-center">
        <Loader2 className="mx-auto h-10 w-10 animate-spin text-text-faint" />
        <p className="mt-4 text-[13px] text-text-dim">Completing sign-in…</p>
      </div>
    </>
  );
}

export default function OAuthCallbackPage() {
  return (
    <Suspense fallback={<div className="h-40" />}>
      <CallbackInner />
    </Suspense>
  );
}
