"use client";

import { useState } from "react";
import { Shield, Smartphone, Monitor, LogOut, Check } from "lucide-react";

import { Card, CardBody, Skeleton } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FormField } from "@/components/ui/input";
import { PasswordInput, PasswordStrength, scorePassword } from "@/components/ui/password-input";
import { useSessions, useRevokeSession, useChangePassword } from "@/hooks/use-account";
import { useAuthStore } from "@/stores/auth-store";
import { formatRelative } from "@/lib/format";

export default function SecuritySettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-[20px] font-bold">Security</h2>
        <p className="mt-1 text-[14px] text-text-dim">Keep your account locked down.</p>
      </div>
      <ChangePasswordCard />
      <TwoFactorCard />
      <SessionsCard />
    </div>
  );
}

function ChangePasswordCard() {
  const change = useChangePassword();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

  const strong = scorePassword(next).score >= 3;
  const match = next === confirm && confirm.length > 0;
  const canSave = current.length > 0 && strong && match;

  function save() {
    if (!canSave) return;
    change.mutate({ current, next }, { onSuccess: () => { setCurrent(""); setNext(""); setConfirm(""); } });
  }

  return (
    <Card>
      <CardBody>
        <h3 className="mb-4 font-display text-[16px] font-bold">Change password</h3>
        <FormField label="Current password" htmlFor="current">
          <PasswordInput id="current" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        </FormField>
        <FormField label="New password" htmlFor="next">
          <PasswordInput id="next" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
          <PasswordStrength value={next} />
        </FormField>
        <FormField label="Confirm new password" htmlFor="confirm" error={confirm.length > 0 && !match ? "Passwords don't match." : undefined}>
          <PasswordInput id="confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} invalid={confirm.length > 0 && !match} autoComplete="new-password" />
        </FormField>
        <div className="flex justify-end pt-1">
          <Button loading={change.isPending} disabled={!canSave} onClick={save}>Update password</Button>
        </div>
      </CardBody>
    </Card>
  );
}

function TwoFactorCard() {
  const enabled = useAuthStore((s) => s.user?.twoFactorEnabled ?? false);
  return (
    <Card>
      <CardBody>
        <div className="flex items-start justify-between gap-4">
          <div className="flex gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-gradient-soft text-accent">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-display text-[16px] font-bold">Two-factor authentication</h3>
                {enabled ? <Badge tone="success"><Check className="h-3 w-3" /> On</Badge> : <Badge tone="neutral">Off</Badge>}
              </div>
              <p className="mt-1 text-[13.5px] text-text-dim">Add an extra layer of security with an authenticator app (TOTP) or hardware key (WebAuthn).</p>
            </div>
          </div>
          <Button variant={enabled ? "ghost" : "primary"} size="sm">{enabled ? "Manage" : "Enable"}</Button>
        </div>
      </CardBody>
    </Card>
  );
}

function SessionsCard() {
  const { data: sessions, isLoading } = useSessions();
  const revoke = useRevokeSession();

  return (
    <Card>
      <CardBody>
        <h3 className="mb-4 font-display text-[16px] font-bold">Active sessions</h3>
        {isLoading || !sessions ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <div className="space-y-2.5">
            {sessions.map((s) => {
              const isMobile = /iphone|android|mobile/i.test(s.device);
              return (
                <div key={s.id} className="flex items-center justify-between rounded-xl border border-line p-3.5">
                  <div className="flex items-center gap-3">
                    <div className="grid h-10 w-10 place-items-center rounded-xl bg-surface-hover text-text-dim">
                      {isMobile ? <Smartphone className="h-5 w-5" /> : <Monitor className="h-5 w-5" />}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 text-[14px] font-semibold">
                        {s.device} · {s.browser}
                        {s.current && <span className="rounded bg-success/12 px-1.5 py-0.5 text-[10.5px] font-semibold text-success">This device</span>}
                      </div>
                      <div className="text-[12.5px] text-text-faint">
                        {s.location ?? "Unknown"} · {s.ipAddress} · {s.current ? "active now" : formatRelative(s.lastActiveAt)}
                      </div>
                    </div>
                  </div>
                  {!s.current && (
                    <button
                      onClick={() => revoke.mutate(s.id)}
                      className="grid h-9 w-9 place-items-center rounded-lg border border-line-strong text-text-faint transition-colors hover:border-danger hover:text-danger"
                      aria-label="Revoke session"
                    >
                      <LogOut className="h-4 w-4" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
