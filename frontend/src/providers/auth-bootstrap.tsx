"use client";

/**
 * AuthBootstrap — owns the access-token lifecycle:
 *   1. wires the token getter and refresher into the API client
 *   2. on mount, exchanges the stored refresh token so a returning user is
 *      logged straight back in
 *   3. renews the token a minute before it expires, so long-running work is
 *      never interrupted by an expired token
 *
 * auth returns the refresh token in the login body rather than setting an
 * httpOnly cookie, so it is persisted client-side (see auth-store for the
 * security note). Renders nothing; mounted inside Providers.
 */

import { useEffect } from "react";

import { setTokenGetter, setTokenRefresher } from "@/lib/api";
import { authApi } from "@/lib/auth-api";
import { useAuthStore } from "@/stores/auth-store";

// Wire the getter immediately at module load (before any request fires).
setTokenGetter(() => useAuthStore.getState().accessToken);

/**
 * Exchange the stored refresh token for a new access token.
 *
 * The service rotates the refresh token on every call, so the new one must be
 * stored — replaying a spent token trips its reuse detection and revokes the
 * whole family. Returns null when the session is genuinely over.
 */
export async function refreshAccessToken(): Promise<string | null> {
  const stored = useAuthStore.getState().refreshToken;
  if (!stored) return null;
  try {
    const res = await authApi.refresh(stored);
    useAuthStore.getState().setAccessToken(res.access_token, res.expires_in);
    useAuthStore.getState().setRefreshToken(res.refresh_token);
    return res.access_token;
  } catch {
    useAuthStore.getState().clear();
    return null;
  }
}

setTokenRefresher(refreshAccessToken);

/**
 * How long before expiry to renew. The access token lives 15 minutes; renewing
 * a minute early means a request is never in flight against a token that dies
 * mid-journey, and a minute is far longer than a refresh round trip.
 */
const RENEW_MARGIN_MS = 60_000;

export function AuthBootstrap() {
  const setAccessToken = useAuthStore((s) => s.setAccessToken);
  const setRefreshToken = useAuthStore((s) => s.setRefreshToken);
  const setUser = useAuthStore((s) => s.setUser);
  const setInitializing = useAuthStore((s) => s.setInitializing);

  /**
   * Keep an open tab signed in.
   *
   * The API layer refreshes on a 401, which covers a request that happens to
   * land after expiry — but nothing was renewing the token while a tab simply
   * sat there. Fifteen minutes in, `isAuthenticated()` started returning false
   * because it only compares `expiresAt` to the clock, and AuthGuard bounced
   * the user to /login with a perfectly good refresh token in the store.
   *
   * So the session renews itself just before it lapses, and reschedules from
   * the new expiry each time.
   */
  const expiresAt = useAuthStore((s) => s.expiresAt);
  useEffect(() => {
    if (!expiresAt) return;
    const delay = Math.max(0, expiresAt - Date.now() - RENEW_MARGIN_MS);
    const id = setTimeout(() => {
      void refreshAccessToken();
    }, delay);
    return () => clearTimeout(id);
  }, [expiresAt]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // Zustand rehydrates from localStorage before this effect runs.
        const stored = useAuthStore.getState().refreshToken;
        if (!stored) return;

        const res = await authApi.refresh(stored);
        if (cancelled) return;
        setAccessToken(res.access_token, res.expires_in);
        // The token is rotated server-side; keep the new one or the next
        // reload replays a revoked token and the family gets killed.
        setRefreshToken(res.refresh_token);
        // Fetch fresh profile now that we have a token.
        const user = await authApi.me();
        if (!cancelled) setUser(user);
      } catch {
        // Expired or revoked refresh token — stay logged out, that's fine.
        useAuthStore.getState().clear();
      } finally {
        if (!cancelled) setInitializing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [setAccessToken, setRefreshToken, setUser, setInitializing]);

  // Access tokens last 15 minutes. Renew a minute before expiry so work in
  // progress — a half-filled challenge form — never hits a 401 at submit time.
  useEffect(() => {
    const timer = setInterval(() => {
      const { accessToken, expiresAt } = useAuthStore.getState();
      if (!accessToken || !expiresAt) return;
      if (expiresAt - Date.now() < 60_000) {
        void refreshAccessToken();
      }
    }, 30_000);
    return () => clearInterval(timer);
  }, []);

  return null;
}
