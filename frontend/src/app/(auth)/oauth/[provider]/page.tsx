"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

/**
 * Handles the case where an OAuth provider redirects directly to the frontend
 * (e.g. a misconfigured callback URL). In the normal flow the backend handles
 * the exchange and redirects to /auth/callback with tokens in the URL hash.
 *
 * If an `oauth_error` query param arrives here we forward it to /auth/callback
 * so the same error UI handles it. Otherwise we just redirect to the callback
 * page which knows how to parse the hash fragment.
 */
function OAuthRedirectInner() {
  const params = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const err = params.get("error") ?? params.get("oauth_error");
    if (err) {
      router.replace(`/auth/callback#oauth_error=${encodeURIComponent(err)}`);
    } else {
      // Forward any code/state to /auth/callback — the page will show an error
      // if the expected hash tokens aren't present.
      router.replace("/auth/callback");
    }
  }, [params, router]);

  return (
    <div className="text-center">
      <Loader2 className="mx-auto h-10 w-10 animate-spin text-accent" />
      <p className="mt-4 text-[15px] text-text-dim">Completing sign-in…</p>
    </div>
  );
}

export default function OAuthProviderPage() {
  return (
    <Suspense fallback={<div className="h-40" />}>
      <OAuthRedirectInner />
    </Suspense>
  );
}
