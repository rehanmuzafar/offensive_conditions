"use client";

/**
 * AuthGuard — gates the app shell. While the initial silent-refresh is in
 * flight we show a splash; if the user ends up unauthenticated we redirect to
 * /login (preserving where they were headed).
 */

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";

import { useAuthStore } from "@/stores/auth-store";
import { refreshAccessToken } from "@/providers/auth-bootstrap";
import { OffconMark } from "@/components/brand/offcon-mark";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const initializing = useAuthStore((s) => s.initializing);
  const isAuthed = useAuthStore((s) => s.isAuthenticated());

  /**
   * Try to recover before giving up.
   *
   * `isAuthenticated()` only asks whether the *access* token is still inside its
   * fifteen-minute window. That is not the same question as "is this person
   * signed out" — a valid refresh token may be sitting in the store, which is
   * exactly the state a tab reaches after being left open. Redirecting there
   * threw people back to the sign-in page mid-session.
   *
   * So an expired access token first attempts a refresh, and only a refresh
   * that actually fails counts as signed out.
   */
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    if (initializing || isAuthed) return;

    const canRecover = Boolean(useAuthStore.getState().refreshToken);
    if (!canRecover) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }

    let cancelled = false;
    setRecovering(true);
    void refreshAccessToken().then((token) => {
      if (cancelled) return;
      setRecovering(false);
      if (!token) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    });

    return () => {
      cancelled = true;
    };
  }, [initializing, isAuthed, pathname, router]);

  if (initializing || recovering) {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="flex flex-col items-center gap-4">
          <OffconMark height={34} />
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      </div>
    );
  }

  if (!isAuthed) return null; // redirecting

  return <>{children}</>;
}
