"use client";

/**
 * Auth store — holds the access token + current user in memory, and persists
 * just enough to localStorage to survive a refresh. The access token getter is
 * wired into the API client (lib/api) so every request is authenticated.
 *
 * Security note: we keep the access token in memory + localStorage for SPA
 * convenience; the refresh token is httpOnly-cookie managed by the gateway, so
 * it is never readable here. On boot we attempt a silent refresh.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import { sharedSessionStorage } from "@/lib/session-storage";

import type { AuthUser, AuthTokens } from "@/types/auth";

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  /** rotated on every refresh; persisted so a reload can re-authenticate */
  /** epoch ms when the access token expires */
  expiresAt: number | null;
  /** true until the initial silent-refresh attempt resolves */
  initializing: boolean;

  setSession: (tokens: AuthTokens, user: AuthUser) => void;
  setUser: (user: AuthUser) => void;
  setAccessToken: (token: string, expiresIn: number) => void;
  clear: () => void;
  setInitializing: (v: boolean) => void;

  isAuthenticated: () => boolean;
  hasRole: (...roles: string[]) => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      expiresAt: null,
      initializing: true,

      setSession: (tokens, user) =>
        set({
          user,
          accessToken: tokens.accessToken,
          expiresAt: Date.now() + tokens.expiresIn * 1000,
          initializing: false,
        }),

      setUser: (user) => set({ user }),

      setAccessToken: (token, expiresIn) =>
        set({ accessToken: token, expiresAt: Date.now() + expiresIn * 1000 }),


      clear: () =>
        set({
          user: null,
          accessToken: null,
          expiresAt: null,
          initializing: false,
        }),

      setInitializing: (v) => set({ initializing: v }),

      isAuthenticated: () => {
        const { accessToken, expiresAt } = get();
        return Boolean(accessToken && expiresAt && expiresAt > Date.now());
      },

      hasRole: (...roles) => {
        const u = get().user;
        if (!u) return false;
        return roles.some((r) => u.roles.includes(r as AuthUser["roles"][number]));
      },
    }),
    {
      name: "offcon-auth",
      // A cookie on the parent domain, not localStorage: localStorage is scoped
      // to one origin, and the surfaces are four of them. See session-storage.
      storage: createJSONStorage(() => sharedSessionStorage),
      // auth-svc sets the refresh token as an HttpOnly cookie on the parent
      // domain and reads it on /v1/auth/refresh, so silent refresh works
      // without this store ever holding the token.
      // Only the user profile is persisted. The refresh token is NOT here and
      // must never come back: it is delivered as an HttpOnly cookie that the
      // browser attaches to /v1/auth/refresh by itself, so page scripts cannot
      // read it. Putting it back in this cookie would undo OFFCON-2026-002.
      partialize: (s) => ({ user: s.user }),
    },
  ),
);
