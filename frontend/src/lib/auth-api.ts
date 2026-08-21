/**
 * Auth API — thin typed wrappers over the gateway's /v1/auth/* endpoints.
 * Consumed by the React Query hooks in hooks/use-auth.ts.
 */

import { api } from "@/lib/api";
import type {
  AccountIdentity,
  AuthTokens,
  AuthUser,
  OAuthProvider,
  RegisterPayload,
} from "@/types/auth";

/** Frontend skill-rank tiers (distinct from the auth-svc's subscription tiers). */
const RANK_TIERS = [
  "noob",
  "script_kiddie",
  "hacker",
  "pro_hacker",
  "elite_hacker",
  "guru",
  "elite_operator",
];

export const authApi = {
  login: (email: string, password: string) =>
    api.post<{
      access_token?: string;
      refresh_token?: string;
      token_type?: string;
      expires_in?: number;
      tfa_challenge?: string;
      user_id?: string;
    }>("/v1/auth/login", {
      anonymous: true,
      body: { email, password },
    }),

  verifyTwoFactor: (challengeId: string, code: string, method = "totp") =>
    api.post<{ tokens: AuthTokens; user: AuthUser }>("/v1/auth/2fa/verify", {
      anonymous: true,
      body: { challengeId, code, method },
    }),

  register: (payload: RegisterPayload) =>
    api.post<{ user_id: string; verification_required: boolean; message: string }>(
      "/v1/auth/register",
      {
        anonymous: true,
        body: payload,
      },
    ),

  /** Current user profile. The auth-svc returns snake_case fields — map them to AuthUser. */
  me: async (): Promise<AuthUser> => {
    const r = await api.get<{
      user_id: string;
      username: string;
      email: string;
      email_verified: boolean;
      two_factor_enabled: boolean;
      avatar_url: string | null;
      country: string | null;
      tier: string;
      roles: string[];
      created_at: string;
    }>("/v1/auth/me");
    return {
      id: r.user_id,
      username: r.username,
      email: r.email,
      emailVerified: r.email_verified,
      avatarUrl: r.avatar_url ?? null,
      country: r.country ?? null,
      // auth-svc emits subscription tiers (free/pro/…) which aren't the frontend
      // skill-rank tiers; fall back to "hacker" for anything unrecognised so the
      // tier badge always renders a valid label.
      tier: (RANK_TIERS.includes(r.tier) ? r.tier : "hacker") as AuthUser["tier"],
      roles: (r.roles ?? []) as AuthUser["roles"],
      twoFactorEnabled: r.two_factor_enabled,
      createdAt: r.created_at,
    };
  },

  /**
   * The hacker/company answer, from user-svc.
   *
   * Not on /v1/auth/me: auth-svc owns credentials and roles, user-svc owns the
   * profile, and the account type is profile data. Two calls rather than
   * teaching auth-svc about a column it does not own.
   */
  identity: async (): Promise<AccountIdentity> => {
    const r = await api.get<{
      account_type?: string;
      onboarding_complete?: boolean;
      company_name?: string | null;
      company_website?: string | null;
    }>("/v1/me");
    return {
      accountType: (r.account_type ?? "") as AccountIdentity["accountType"],
      onboardingComplete: Boolean(r.onboarding_complete),
      companyName: r.company_name ?? null,
      companyWebsite: r.company_website ?? null,
    };
  },

  setAccountType: (body: {
    accountType: "hacker" | "company";
    companyName?: string;
    companyWebsite?: string;
  }) =>
    api.post<{ account_type: string }>("/v1/me/account-type", {
      body: {
        account_type: body.accountType,
        company_name: body.companyName || null,
        company_website: body.companyWebsite || null,
      },
    }),

  /**
   * Exchange a refresh token for a new access token.
   *
   * auth returns snake_case and rotates the refresh token on every call, so the
   * caller must persist the returned refresh_token — the old one is revoked and
   * replaying it trips the service's token-reuse detection.
   */
  refresh: (refreshToken: string) =>
    api.post<{
      access_token: string;
      refresh_token: string;
      token_type: string;
      expires_in: number;
    }>("/v1/auth/refresh", {
      anonymous: true,
      body: { refresh_token: refreshToken },
    }),

  logout: () => api.post<void>("/v1/auth/logout"),

  requestPasswordReset: (email: string) =>
    api.post<void>("/v1/auth/password-reset", {
      anonymous: true,
      body: { email },
    }),

  resetPassword: (token: string, password: string) =>
    api.post<void>("/v1/auth/password-reset/confirm", {
      anonymous: true,
      body: { token, password },
    }),

  verifyEmail: (token: string) =>
    api.post<void>("/v1/auth/verify-email", {
      anonymous: true,
      body: { token },
    }),

  resendVerification: () => api.post<void>("/v1/auth/verify-email/resend"),

  /** Returns the enabled OAuth provider names so the UI can hide unavailable buttons. */
  getProviders: () =>
    api.get<{ providers: string[] }>("/v1/auth/providers", { anonymous: true }),

  /** Returns the provider's authorize URL. The backend handles the token exchange
   *  server-side and redirects back to /auth/callback with tokens in the URL hash. */
  oauthStart: (provider: OAuthProvider) =>
    api.get<{ auth_url: string }>(`/v1/auth/oauth/${provider}`, { anonymous: true }),
};
