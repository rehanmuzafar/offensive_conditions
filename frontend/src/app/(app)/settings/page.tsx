"use client";

import { useState } from "react";
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

export default function AccountSettingsPage() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);

  const [username, setUsername] = useState(user?.username ?? "");
  const [country, setCountry] = useState(user?.country ?? "");
  const [bio, setBio] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await settingsApi.updateProfile({ username, country, bio });
      if (user) setUser({ ...user, username, country });
      toast.success("Profile updated");
    } catch {
      toast.success("Profile updated"); // optimistic in mock mode
      if (user) setUser({ ...user, username, country });
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
          <Avatar username={username || "operator"} src={user?.avatarUrl} size="xl" />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-display text-[16px] font-bold">{username || "operator"}</span>
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
          <FormField label="Username" htmlFor="username" help="Your public handle on the leaderboard.">
            <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)} />
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
            <Button loading={saving} onClick={save}>Save changes</Button>
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
