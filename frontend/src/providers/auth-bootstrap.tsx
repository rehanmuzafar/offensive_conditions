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
 * The service rotates the token on every call and treats a replay as an
 * attack: reusing a spent one revokes the entire family and signs the account
 * out everywhere.
 *
 * That makes this dangerous across tabs, and the product opens tabs on purpose
 * — every cross-surface link does. Each tab ran its own renewal timer holding
 * its own copy of the token in memory, so at the fifteen-minute mark two tabs
 * would refresh at once: the first rotated the token, the second replayed the
 * spent one, and the server signed the user out of everything. That is the
 * "logged out after ten or fifteen minutes" report, and the interval was the
 * access token's lifetime rather than anything to do with idleness.
 *
 * Two things fix it. The exchange is serialised across tabs with a Web Lock, so
 * only one is ever in flight; and the token is read from shared storage inside
 * that lock rather than from this tab's memory, so a tab that was waiting picks
 * up whatever the winner just stored instead of the copy it started with.
 */
async function exchange(): Promise<string | null> {
  // No token is read or passed. It is in an HttpOnly cookie the browser
  // attaches on its own, so there is nothing here to go stale between tabs —
  // which also removes the reason this used to re-read shared storage.
  //
  // The Web Lock below is still worth keeping: rotation means two simultaneous
  // refreshes would have the second replay a token the first just revoked, and
  // auth treats a replayed token as theft and kills the whole family.
  try {
    const res = await authApi.refresh();
    useAuthStore.getState().setAccessToken(res.access_token, res.expires_in);
    return res.access_token;
  } catch {
    useAuthStore.getState().clear();
    return null;
  }
}

export async function refreshAccessToken(): Promise<string | null> {
  // navigator.locks is absent on older browsers and in non-secure contexts;
  // falling back to an unserialised exchange is what every tab used to do, so
  // it is no worse there.
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request("offcon-token-refresh", exchange);
  }
  return exchange();
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
        // Nothing to read first: the refresh token is an HttpOnly cookie the
        // browser attaches by itself. A visitor who has never signed in simply
        // has no cookie and this call fails, which is the same "stay logged
        // out" path as an expired one.
        //
        // Rotation is handled entirely server-side now — the new token comes
        // back as a fresh cookie, so there is nothing here to store and no way
        // for this tab to replay a revoked one.
        const res = await authApi.refresh();
        if (cancelled) return;
        setAccessToken(res.access_token, res.expires_in);
        // Fetch fresh profile now that we have a token.
        const user = await authApi.meWithProfile();
        if (!cancelled) setUser(user);
      } catch {
        // No cookie, or it is expired or revoked — stay logged out, that's fine.
        useAuthStore.getState().clear();
      } finally {
        if (!cancelled) setInitializing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [setAccessToken, setUser, setInitializing]);

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
