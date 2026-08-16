"use client";

/**
 * Teams index — two tabs, nothing else.
 *
 * "All Teams" is discovery, "My Teams" is what you belong to. Managing a team
 * happens on its own page (`/teams/[slug]`), never inline here: mixing the
 * roster, the invite box and the join-request queue into this list is what made
 * the old page unreadable.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Plus, Search, Users } from "lucide-react";

import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Flag } from "@/components/ui/flag";
import { toast } from "sonner";
import { COUNTRIES, countryName } from "@/lib/countries";
import { teamsApi, type BrowseFilter, type Team } from "@/lib/teams-api";
import { CreateTeamDialog } from "@/components/teams/create-team-dialog";

type Tab = "all" | "mine";

export default function TeamsPage() {
  const [tab, setTab] = useState<Tab>("all");
  const [mine, setMine] = useState<Team[]>([]);
  const [all, setAll] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const [q, setQ] = useState("");
  const [country, setCountry] = useState("");

  const myIds = useMemo(() => new Set(mine.map((t) => t.id)), [mine]);

  const loadMine = useCallback(async () => {
    try {
      setMine(await teamsApi.listMine());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load your teams");
    }
  }, []);

  // A slow filter response must never overwrite a newer one.
  const seq = useRef(0);
  const search = useCallback(async (f: BrowseFilter) => {
    const mySeq = ++seq.current;
    try {
      const teams = await teamsApi.browse(f);
      if (mySeq === seq.current) setAll(teams);
    } catch {
      if (mySeq === seq.current) setAll([]);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await Promise.all([loadMine(), search({})]);
      setLoading(false);
    })();
  }, [loadMine, search]);

  useEffect(() => {
    if (tab !== "all") return;
    const t = setTimeout(() => void search({ q, country }), 250);
    return () => clearTimeout(t);
  }, [q, country, tab, search]);

  // "My Teams" filters client-side — the list is small and already loaded.
  const shown =
    tab === "all"
      ? all
      : mine.filter((t) => t.name.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Users className="h-6 w-6 text-accent" />
        <h1 className="font-display text-[26px] font-extrabold tracking-[-0.4px]">Teams</h1>
      </div>

      <div className="flex gap-6 border-b border-line">
        {(
          [
            ["all", "All Teams"],
            ["mine", `My Teams${mine.length ? ` (${mine.length})` : ""}`],
          ] as const
        ).map(([key, text]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-1 pb-3 text-[14.5px] font-semibold transition-colors ${
              tab === key
                ? "border-accent text-text"
                : "border-transparent text-text-dim hover:text-text"
            }`}
          >
            {text}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={
              tab === "all" ? "Search teams by name, university or country…" : "Search my teams"
            }
            className="w-full rounded-xl border border-line bg-surface py-2.5 pl-10 pr-3.5 text-[14px] text-text outline-none placeholder:text-text-faint focus:border-line-strong"
          />
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> Create team
        </Button>
      </div>

      {tab === "all" && (
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="rounded-full border border-line bg-surface px-3.5 py-1.5 text-[12.5px] font-semibold text-text-dim outline-none focus:border-line-strong"
          >
            <option value="">Any country</option>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
          {country && (
            <button
              onClick={() => setCountry("")}
              className="text-[12.5px] font-semibold text-text-faint hover:text-text"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {loading ? (
        <Card>
          <CardBody className="py-10 text-center text-[14px] text-text-dim">Loading teams…</CardBody>
        </Card>
      ) : shown.length === 0 ? (
        <Card>
          <CardBody className="py-12 text-center">
            <p className="text-[15px] font-semibold text-text">
              {tab === "all" ? "No teams match that search" : "You're not on a team yet"}
            </p>
            <p className="mt-1.5 text-[13.5px] text-text-dim">
              {tab === "all"
                ? "Try a different name or country."
                : "Browse All Teams to ask to join one, or create your own."}
            </p>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {shown.map((t) => (
            <TeamRow key={t.id} team={t} isMine={myIds.has(t.id)} />
          ))}
        </div>
      )}

      {creating && (
        <CreateTeamDialog
          onClose={() => setCreating(false)}
          onCreated={async () => {
            setCreating(false);
            await loadMine();
            setTab("mine");
          }}
        />
      )}
    </div>
  );
}

function TeamRow({ team, isMine }: { team: Team; isMine: boolean }) {
  // Affiliation is optional; fall back to the country, then to nothing at all.
  const affiliation = team.category_detail || countryName(team.country_code) || "";

  return (
    <Card>
      <CardBody className="flex flex-wrap items-center gap-x-6 gap-y-3 py-4">
        <div className="flex min-w-[220px] flex-1 items-center gap-3.5">
          {team.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={team.avatar_url} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover" />
          ) : (
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand-gradient text-[15px] font-bold text-text-on-brand">
              {team.name.slice(0, 2).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate text-[15.5px] font-bold text-text">{team.name}</p>
            {(team.country_code || affiliation) && (
              <p className="mt-0.5 flex items-center gap-1.5 truncate text-[13px] text-text-dim">
                {team.country_code && <Flag code={team.country_code} />}
                {affiliation}
              </p>
            )}
          </div>
        </div>

        <Stat value={`${team.member_count}`} label="Team members" />

        <Link href={`/teams/${team.slug}`} className="ml-auto">
          <Button variant={isMine ? "outline" : "ghost"}>
            {isMine ? "Manage team" : "View team"}
          </Button>
        </Link>
      </CardBody>
    </Card>
  );
}

function Stat({ value, label: text }: { value: string; label: string }) {
  return (
    <div className="min-w-[92px]">
      <p className="text-[15px] font-bold text-text">{value}</p>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-text-faint">{text}</p>
    </div>
  );
}
