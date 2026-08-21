/**
 * Auth + session types. Mirror the auth-svc API contracts (JWT claims, login
 * responses, 2FA challenges, OAuth providers).
 */

import type { Tier } from "./index";

export type Role =
  | "user"
  | "admin"
  | "moderator"
  | "support"
  | "ctf_organizer"
  | "triager";

/** The authenticated user as returned by auth-svc /v1/auth/me. */
export interface AuthUser {
  id: string;
  username: string;
  email: string;
  emailVerified: boolean;
  avatarUrl: string | null;
  country: string | null; // ISO alpha-2
  tier: Tier;
  points?: number;
  roles: Role[];
  twoFactorEnabled: boolean;
  createdAt: string;
}

/** Which product this account is for. Empty until onboarding is answered. */
export type AccountType = "hacker" | "company" | "";

export interface AccountIdentity {
  accountType: AccountType;
  onboardingComplete: boolean;
  companyName: string | null;
  companyWebsite: string | null;
}

/** Tokens returned on a successful login / refresh. */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** seconds until the access token expires */
  expiresIn: number;
}

/** Login can succeed outright, or demand a second factor first. */
export type LoginResult =
  | { status: "ok"; tokens: AuthTokens; user: AuthUser }
  | { status: "2fa_required"; challengeId: string; methods: TwoFactorMethod[] };

export type TwoFactorMethod = "totp" | "webauthn" | "backup_code";

export interface RegisterPayload {
  username: string;
  email: string;
  password: string;
  country?: string;
  acceptTerms: boolean;
}

export type OAuthProvider = "github" | "google" | "discord";

export interface PasswordPolicy {
  minLength: number;
  requireUpper: boolean;
  requireNumber: boolean;
  requireSymbol: boolean;
}

export const PASSWORD_POLICY: PasswordPolicy = {
  minLength: 12,
  requireUpper: true,
  requireNumber: true,
  requireSymbol: true,
};
