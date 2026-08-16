"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { Github, Twitter, Linkedin, Globe, Calendar, ShieldCheck, UserX } from "lucide-react";

import { Card, CardBody, Skeleton } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, TierBadge } from "@/components/ui/identity";
import { Flag } from "@/components/ui/flag";
import { useCtfStats, useProfile } from "@/hooks/use-profile";
import { useAuthStore } from "@/stores/auth-store";
import { formatDate } from "@/lib/format";
import type { Tier } from "@/types";

// auth-svc emits subscription tiers (free/…); fall back to a valid skill-rank
// so the tier badge always renders.
const RANK_TIERS = ["noob", "script_kiddie", "hacker", "pro_hacker", "elite_hacker", "guru", "elite_operator"];

export default function ProfilePage() {
  const params = useParams<{ username: string }>();
  const username = decodeURIComponent(params.username ?? "");
  const { data: profile, isLoading, isError } = useProfile(username);
  const me = useAuthStore((s) => s.user);
  const { data: ctf } = useCtfStats(profile?.userId);
  const isOwn = me?.username?.toLowerCase() === username.toLowerCase();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Card>
          <CardBody className="flex items-center gap-5">
            <Skeleton className="h-[72px] w-[72px] rounded-xl" />
            <div className="space-y-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-24" />
            </div>
          </CardBody>
        </Card>
        <Card><CardBody><Skeleton className="h-20 w-full" /></CardBody></Card>
      </div>
    );
  }

  if (isError || !profile) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-surface">
          <UserX className="h-7 w-7 text-text-faint" />
        </div>
        <h1 className="font-display text-[22px] font-bold">Profile not found</h1>
        <p className="mt-2 text-[14.5px] text-text-dim">
          No operator with the handle <span className="font-semibold text-text">@{username}</span> exists,
          or their profile is private.
        </p>
        <Link href="/leaderboard">
          <Button variant="ghost" className="mt-6">Back to leaderboard</Button>
        </Link>
      </div>
    );
  }

  const tier = (RANK_TIERS.includes(profile.tier) ? profile.tier : "hacker") as Tier;
  const display = profile.displayName || profile.username;
  const social = [
    profile.social.github && { icon: Github, label: "GitHub", href: `https://github.com/${profile.social.github}` },
    profile.social.twitter && { icon: Twitter, label: "Twitter", href: `https://twitter.com/${profile.social.twitter}` },
    profile.social.linkedin && { icon: Linkedin, label: "LinkedIn", href: profile.social.linkedin },
    profile.social.website && { icon: Globe, label: "Website", href: profile.social.website },
  ].filter(Boolean) as { icon: typeof Github; label: string; href: string }[];

  return (
    <div className="space-y-6">
      {/* header */}
      <Card>
        <CardBody className="flex flex-wrap items-center gap-5">
          <Avatar username={profile.username} src={profile.avatarUrl} size="xl" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="font-display text-[22px] font-extrabold tracking-[-0.3px]">{display}</h1>
              <TierBadge tier={tier} />
              {profile.isStaff && (
                <span className="inline-flex items-center gap-1 rounded-md bg-accent/15 px-2 py-0.5 text-[11.5px] font-semibold text-accent">
                  <ShieldCheck className="h-3.5 w-3.5" /> Staff
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px] text-text-dim">
              <span className="text-text-faint">@{profile.username}</span>
              {profile.countryCode && (
                <span className="inline-flex items-center gap-1.5">
                  <Flag code={profile.countryCode} /> {profile.countryCode}
                </span>
              )}
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" /> Joined {formatDate(profile.createdAt)}
              </span>
            </div>
          </div>
          {isOwn && (
            <Link href="/settings">
              <Button variant="outline" size="sm">Edit profile</Button>
            </Link>
          )}
        </CardBody>
      </Card>

      {/* CTF record — absent while ctf-svc is unreachable, zeroed for a player
          who has not entered an event yet. */}
      {ctf && (
        <Card>
          <CardBody>
            <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-text-faint">
              CTF record
            </h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {[
                { label: "Points", value: ctf.points.toLocaleString() },
                { label: ctf.flags === 1 ? "Flag" : "Flags", value: ctf.flags.toLocaleString() },
                { label: "First bloods", value: ctf.first_bloods.toLocaleString() },
                { label: "Events", value: ctf.events_played.toLocaleString() },
                { label: "Teams", value: ctf.teams_played_with.toLocaleString() },
                { label: "Best rank", value: ctf.best_rank ? `#${ctf.best_rank}` : "\u2014" },
              ].map((s) => (
                <div key={s.label} className="rounded-xl border border-line bg-bg-elevated/50 px-3 py-2.5">
                  <p className="text-[18px] font-bold leading-tight text-text">{s.value}</p>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-text-faint">
                    {s.label}
                  </p>
                </div>
              ))}
            </div>
            {ctf.last_solve_at && (
              <p className="mt-3 text-[12.5px] text-text-faint">
                Last flag {formatDate(ctf.last_solve_at)}
              </p>
            )}
          </CardBody>
        </Card>
      )}

      {/* bio */}
      <Card>
        <CardBody>
          <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-text-faint">About</h2>
          {profile.bio ? (
            <p className="whitespace-pre-line text-[14.5px] leading-relaxed text-text-dim">{profile.bio}</p>
          ) : (
            <p className="text-[14px] italic text-text-faint">
              {isOwn ? "You haven't written a bio yet. " : "This operator hasn't written a bio yet."}
              {isOwn && <Link href="/settings" className="not-italic font-medium text-accent hover:underline">Add one</Link>}
            </p>
          )}

          {social.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-2">
              {social.map((s) => (
                <a
                  key={s.label}
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-[13px] font-medium text-text-dim transition-colors hover:bg-surface-hover hover:text-text"
                >
                  <s.icon className="h-4 w-4" /> {s.label}
                </a>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
