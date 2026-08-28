"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/input";
import { Avatar } from "@/components/ui/identity";
import { Flag } from "@/components/ui/flag";
import { CountrySelect } from "@/components/ui/country-select";
import { isSupportedCountry } from "@/lib/countries";
import { settingsApi } from "@/lib/account-api";
import { useAuthStore } from "@/stores/auth-store";
import { useMyProfile } from "@/hooks/use-account";

export default function AccountSettingsPage() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);

  // Loaded from the profile rather than from the auth store: the store carries
  // only what the token and /auth/me expose, which is not the display name or
  // the bio. Without this the form opened with an empty bio and saving wiped it.
  const { data: profile, isLoading } = useMyProfile();

  const [displayName, setDisplayName] = useState("");
  const [country, setCountry] = useState("");
  const [bio, setBio] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setDisplayName(profile.displayName ?? "");
    setCountry(profile.country ?? "");
    setBio(profile.bio ?? "");
  }, [profile]);

  async function save() {
    setSaving(true);
    try {
      await settingsApi.updateProfile({ displayName, country, bio });
      if (user) setUser({ ...user, country });
      toast.success("Profile updated");
    } catch (err) {
      // This used to report success and update local state anyway — a leftover
      // from the mock era. The change looked saved, then came back on the next
      // load, which is a worse failure than an error would have been.
      toast.error(err instanceof Error ? err.message : "Couldn't save your profile.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-[20px] font-bold">Account</h2>
        <p className="mt-1 text-[14px] text-text-dim">Your public profile and account details.</p>
      </div>

      {/* avatar */}
      <Card>
        <CardBody className="flex items-center gap-5">
          <Avatar username={user?.username ?? "operator"} src={user?.avatarUrl} size="xl" />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-display text-[16px] font-bold">{displayName || user?.username || "operator"}</span>
              {isSupportedCountry(country) && <Flag code={country} />}
            </div>
            <p className="mt-1 text-[13px] text-text-faint">PNG, JPG or GIF. Max 2MB.</p>
            <Button variant="ghost" size="sm" className="mt-2">Change avatar</Button>
          </div>
        </CardBody>
      </Card>

      {/* profile fields */}
      <Card>
        <CardBody>
          <FormField label="Username" htmlFor="username" help="Your handle. Contact support to change it.">
            <Input id="username" value={user?.username ?? ""} disabled />
          </FormField>

          <FormField label="Display name" htmlFor="display-name" help="Shown on your profile and the leaderboard.">
            <Input id="display-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </FormField>

          <FormField label="Email" htmlFor="email" help="Contact support to change your email.">
            <Input id="email" value={user?.email ?? ""} disabled />
          </FormField>

          <FormField label="Country" htmlFor="country" help="Select your country (ISO 3166-1 alpha-2).">
            <CountrySelect id="country" value={country} onChange={setCountry} />
          </FormField>

          <FormField label="Bio" htmlFor="bio" help="A short blurb shown on your profile.">
            <textarea
              id="bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={3}
              maxLength={280}
              placeholder="Offensive security enthusiast. Breaking things to make them safer."
              className="w-full resize-y rounded-xl border border-line-strong bg-bg-elevated px-3.5 py-3 text-[14.5px] text-text placeholder:text-text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
            />
          </FormField>

          <div className="flex justify-end pt-1">
            <Button loading={saving} disabled={isLoading} onClick={save}>Save changes</Button>
          </div>
        </CardBody>
      </Card>

      {/* danger zone */}
      <Card className="border-danger/25">
        <CardBody>
          <h3 className="font-display text-[16px] font-bold text-danger">Danger zone</h3>
          <p className="mt-1.5 text-[13.5px] text-text-dim">Permanently delete your account and all associated data. This cannot be undone.</p>
          <Button variant="danger" size="sm" className="mt-3" onClick={() => toast.error("Account deletion requires email confirmation.")}>
            Delete account
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}
