/** Public user profile as returned by user-svc GET /v1/users/by-username/:username. */
export interface PublicProfile {
  userId: string;
  username: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
  countryCode: string | null;
  tier: string;
  isStaff: boolean;
  createdAt: string;
  social: {
    twitter: string;
    github: string;
    linkedin: string;
    website: string;
  };
  /** Present only when viewing your own profile. */
  email?: string;
}
