"use client";

/**
 * Registration control for a CTF event.
 *
 * Solo events register the person. Team events register a team, and ctf-svc
 * only accepts it from that team's owner or captain — so this offers exactly
 * the teams the viewer can actually enter, rather than letting them pick one
 * and collecting a 403.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useCtfRegister } from "@/hooks/use-community";
import { teamsApi, type Team } from "@/lib/teams-api";

export function EventRegister({
  slug,
  registered,
  teamPlay,
  maxTeamSize,
}: {
  slug: string;
  registered: boolean;
  teamPlay: boolean;
  maxTeamSize: number | null;
}) {
  if (registered) {
    return (
      <span className="inline-block rounded-xl bg-success/12 px-4 py-2 text-[14px] font-semibold text-success">
        ✓ Registered
      </span>
    );
  }
  return teamPlay ? (
    <TeamRegister slug={slug} maxTeamSize={maxTeamSize} />
  ) : (
    <SoloRegister slug={slug} />
  );
}

function SoloRegister({ slug }: { slug: string }) {
  const reg = useCtfRegister(slug);
  return (
    <Button loading={reg.isPending} onClick={() => reg.mutate(undefined)}>
      Register now
    </Button>
  );
}

function TeamRegister({ slug, maxTeamSize }: { slug: string; maxTeamSize: number | null }) {
  const reg = useCtfRegister(slug);
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [picked, setPicked] = useState("");

  useEffect(() => {
    let cancelled = false;
    teamsApi
      .listMine()
      .then((t) => {
        if (cancelled) return;
        // Every team the player belongs to, captain or not: each member enters
        // themselves, so membership is enough.
        setTeams(t);
        if (t[0]) setPicked(t[0].id);
      })
      .catch(() => !cancelled && setTeams([]));
    return () => {
      cancelled = true;
    };
  }, []);

  if (teams === null) {
    return (
      <span className="flex items-center gap-2 text-[13px] text-text-faint">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking your teams…
      </span>
    );
  }

  if (teams.length === 0) {
    return (
      <div className="text-right">
        <p className="text-[13px] text-text-dim">This is a team event.</p>
        <Link
          href="/teams"
          className="text-[13px] font-semibold text-accent hover:underline"
        >
          Create a team to enter →
        </Link>
        <p className="mt-0.5 text-[12px] text-text-faint">
          Each teammate registers themselves under the same team.
        </p>
      </div>
    );
  }

  const chosen = teams.find((t) => t.id === picked);
  const tooBig = Boolean(maxTeamSize && chosen && chosen.member_count > maxTeamSize);

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Users className="h-4 w-4 text-text-faint" />
        <select
          value={picked}
          onChange={(e) => setPicked(e.target.value)}
          className="h-10 rounded-xl border border-line-strong bg-bg-elevated px-3 text-[14px] text-text focus:border-accent focus:outline-none"
        >
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.member_count})
            </option>
          ))}
        </select>
        <Button loading={reg.isPending} disabled={!picked || tooBig} onClick={() => reg.mutate(picked)}>
          Register team
        </Button>
      </div>
      {tooBig && (
        <p className="text-[12px] text-warning">
          {chosen?.name} has {chosen?.member_count} members; this event allows {maxTeamSize}.
        </p>
      )}
    </div>
  );
}
