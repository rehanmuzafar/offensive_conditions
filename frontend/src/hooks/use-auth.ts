"use client";

/**
 * Auth hooks — React Query mutations/queries that bridge authApi and the
 * zustand auth store, plus toast feedback. Pages call these, not authApi
 * directly.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { authApi } from "@/lib/auth-api";
import { ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import type { AuthTokens, AuthUser, OAuthProvider, RegisterPayload, Role } from "@/types/auth";

/** Decode the (unverified) claims from a JWT access token's payload. */
function decodeJwtClaims(token: string): { sub?: string; roles?: string[]; tier?: string } {
  try {
    const payload = token.split(".")[1];
    if (!payload) return {};
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json);
  } catch {
    return {};
  }
}

export function useLogin() {
  const setSession = useAuthStore((s) => s.setSession);
  const setUser = useAuthStore((s) => s.setUser);
  const router = useRouter();

  return useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      authApi.login(email, password),
    // The auth API returns snake_case body tokens (or a 2FA challenge), not the
    // {status, tokens, user} envelope. Map it and build a best-effort user — the
    // username/tier are display-only (the topbar falls back) and the access token
    // is what authorises subsequent requests.
    onSuccess: async (res, variables) => {
      if (res.tfa_challenge) {
        router.push(`/two-factor?challenge=${res.tfa_challenge}`);
        return;
      }
      if (!res.access_token || !res.refresh_token) {
        toast.error("Could not sign you in. Please try again.");
        return;
      }
      const tokens: AuthTokens = {
        accessToken: res.access_token,
        refreshToken: res.refresh_token,
        expiresIn: res.expires_in ?? 900,
      };
      // Pull the real roles (and id) out of the JWT so staff/admin gating works.
      const claims = decodeJwtClaims(res.access_token);
      const user: AuthUser = {
        id: claims.sub ?? res.user_id ?? "",
        username: variables.email.split("@")[0] || "operator",
        email: variables.email,
        emailVerified: true,
        avatarUrl: null,
        country: null,
        tier: "hacker",
        roles: (claims.roles ?? []) as Role[],
        twoFactorEnabled: false,
        createdAt: new Date().toISOString(),
      };
      setSession(tokens, user);
      // Replace the email-derived shell with the real profile (correct username/tier).
      try {
        const full = await authApi.me();
        setUser(full);
        toast.success(`Welcome back, ${full.username}`);
      } catch {
        toast.success(`Welcome back, ${user.username}`);
      }
      router.push("/dashboard");
    },
    onError: (err) => {
      const code = err instanceof ApiError ? err.code : undefined;
      // "Try again" is wrong for an unverified account — retrying will never
      // work. Say what actually has to happen instead.
      const msg =
        code === "INVALID_CREDENTIALS"
          ? "Incorrect email or password."
          : code === "EMAIL_NOT_VERIFIED"
            ? "Verify your email first — open the link we sent when you signed up."
            : "Could not sign you in. Please try again.";
      toast.error(msg);
    },
  });
}

export function useVerifyTwoFactor() {
  const setSession = useAuthStore((s) => s.setSession);
  const router = useRouter();

  return useMutation({
    mutationFn: ({ challengeId, code }: { challengeId: string; code: string }) =>
      authApi.verifyTwoFactor(challengeId, code),
    onSuccess: ({ tokens, user }) => {
      setSession(tokens, user);
      toast.success("Verified — welcome back");
      router.push("/dashboard");
    },
    onError: () => toast.error("Invalid or expired code."),
  });
}

export function useRegister() {
  const router = useRouter();

  return useMutation({
    mutationFn: (payload: RegisterPayload) => authApi.register(payload),
    // The API creates the account but does not return tokens — the user signs
    // in afterwards. (When email verification is enabled they must verify first.)
    onSuccess: (res) => {
      if (res.verification_required) {
        toast.success("Account created — check your email to verify, then sign in.");
      } else {
        toast.success("Account created — please sign in.");
      }
      router.push("/login");
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        if (err.code === "EMAIL_ALREADY_REGISTERED")
          return toast.error("That email is already registered. Try signing in.");
        if (err.code === "USERNAME_ALREADY_TAKEN")
          return toast.error("That username is taken. Pick another.");
        if (err.code === "CONFLICT" || err.status === 409)
          return toast.error("That email or username is already taken. Try signing in.");
        if (err.code === "VALIDATION_FAILED")
          return toast.error("Please check your details and try again.");
      }
      toast.error("Could not create your account. Please try again.");
    },
  });
}

export function useLogout() {
  const clear = useAuthStore((s) => s.clear);
  const router = useRouter();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: () => authApi.logout(),
    onSettled: () => {
      clear();
      qc.clear();
      router.push("/login");
    },
  });
}

export function useRequestPasswordReset() {
  return useMutation({
    mutationFn: (email: string) => authApi.requestPasswordReset(email),
    // Always behave the same whether or not the email exists (no enumeration).
    onSuccess: () =>
      toast.success("If that email exists, a reset link is on its way."),
    onError: () =>
      toast.success("If that email exists, a reset link is on its way."),
  });
}

export function useResetPassword() {
  const router = useRouter();
  return useMutation({
    mutationFn: ({ token, password }: { token: string; password: string }) =>
      authApi.resetPassword(token, password),
    onSuccess: () => {
      toast.success("Password updated — sign in with your new password.");
      router.push("/login");
    },
    onError: () => toast.error("That reset link is invalid or has expired."),
  });
}

export function useAuthProviders() {
  return useQuery({
    queryKey: ["auth-providers"],
    queryFn: () => authApi.getProviders().then((r) => r.providers),
    staleTime: 60_000,
    retry: false,
  });
}

export function useOAuthStart() {
  return useMutation({
    mutationFn: (provider: OAuthProvider) => authApi.oauthStart(provider),
    onSuccess: ({ auth_url }) => {
      window.location.href = auth_url;
    },
    onError: () => toast.error("Could not start that sign-in. Please try again."),
  });
}
