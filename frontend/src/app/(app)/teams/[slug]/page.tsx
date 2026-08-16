"use client";

/**
 * A single team, with its own tabs.
 *
 * Everything that used to be piled onto the teams list lives here instead:
 * the roster, the settings, and the join-request queue. Which tabs appear
 * depends on who is looking — a visitor sees Details and Players; a captain
 * also sees Settings and Join Requests.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, LogOut, Send, UserMinus } from "lucide-react";

import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Flag } from "@/components/ui/flag";
import { toast } from "sonner";
import { InvitePicker } from "@/components/teams/invite-picker";
import { field, label } from "@/components/teams/team-form-fields";
import { COUNTRIES, countryName } from "@/lib/countries";
import { useAuthStore } from "@/stores/auth-store";
import {
  getUsername,
  teamsApi,
  type Team,
  type TeamJoinRequest,
  type TeamMember,
  type TeamStats,
} from "@/lib/teams-api";
import { uploadAvatar } from "@/lib/media-api";

type Tab = "details" | "players" | "settings" | "requests";

export default function TeamPage() {
  const params = useParams<{ slug: string }>();
  const slug = decodeURIComponent(params.slug ?? "");
  const router = useRouter();
  const me = useAuthStore((s) => s.user);

  const [team, setTeam] = useState<Team | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [stats, setStats] = useState<TeamStats | null>(null);
  const [requests, setRequests] = useState<TeamJoinRequest[]>([]);
  const [tab, setTab] = useState<Tab>("details");
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [asked, setAsked] = useState(false);

  const meId = me?.id ?? "";
  const isCaptain = Boolean(team && team.owner_id === meId);
  const isMember = useMemo(() => members.some((m) => m.user_id === meId), [members, meId]);

  const load = useCallback(async () => {
    try {
      const t = await teamsApi.getBySlug(slug);
      setTeam(t);

      // Each of these belongs to a different service; one being down must not
      // blank the whole page.
      const [ms, st, rq] = await Promise.all([
        teamsApi.members(t.id).catch(() => [] as TeamMember[]),
        teamsApi.stats(t.id).catch(() => null),
        teamsApi.joinRequests(t.id).catch(() => [] as TeamJoinRequest[]),
      ]);
      setMembers(ms);
      setStats(st);
      setRequests(rq);

      const ids = [...new Set([...ms.map((m) => m.user_id), ...rq.map((r) => r.user_id)])];
      const resolved = await Promise.all(ids.map(async (id) => [id, await getUsername(id)] as const));
      setNames(Object.fromEntries(resolved));
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = useCallback(
    async (fn: () => Promise<unknown>, ok: string) => {
      try {
        await fn();
        toast.success(ok);
        await load();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Something went wrong");
      }
    },
    [load],
  );

  if (loading) {
    return <Card><CardBody className="py-12 text-center text-[14px] text-text-dim">Loading team…</CardBody></Card>;
  }

  if (notFound || !team) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <h1 className="font-display text-[22px] font-bold">Team not found</h1>
        <p className="mt-2 text-[14.5px] text-text-dim">
          No team with the handle <span className="font-semibold text-text">{slug}</span> exists,
          or it has been disbanded.
        </p>
        <Link href="/teams"><Button variant="ghost" className="mt-6">Back to teams</Button></Link>
      </div>
    );
  }

  const pending = requests.filter((r) => r.status === "pending");
  const tabs: [Tab, string, boolean][] = [
    ["details", "Team Details", true],
    ["players", "Team Players", true],
    ["settings", "Team Settings", isCaptain],
    ["requests", "Join Requests", isCaptain],
  ];

  return (
    <div className="space-y-6">
      <Link href="/teams" className="inline-flex items-center gap-2 text-[13.5px] font-semibold text-text-dim hover:text-text">
        <ArrowLeft className="h-4 w-4" /> Back to teams
      </Link>

      <div className="flex flex-wrap items-center gap-5">
        {team.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={team.avatar_url} alt="" className="h-[72px] w-[72px] rounded-full object-cover" />
        ) : (
          <span className="grid h-[72px] w-[72px] place-items-center rounded-full bg-brand-gradient text-[22px] font-bold text-text-on-brand">
            {team.name.slice(0, 2).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[24px] font-extrabold tracking-[-0.3px]">{team.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px] text-text-dim">
            {team.country_code && (
              <span className="inline-flex items-center gap-1.5">
                <Flag code={team.country_code} /> {countryName(team.country_code)}
              </span>
            )}
            {team.category_detail && <span>{team.category_detail}</span>}
          </p>
        </div>

        {!isMember && team.is_recruiting && (
          <Button
            disabled={asked}
            onClick={() =>
              act(async () => {
                await teamsApi.requestJoin(team.id);
                setAsked(true);
              }, "Join request sent")
            }
          >
            <Send className="h-4 w-4" /> {asked ? "Request sent" : "Ask to join"}
          </Button>
        )}
        {isMember && !isCaptain && (
          <Button variant="ghost" onClick={() => act(async () => { await teamsApi.leave(team.id); router.push("/teams"); }, "Left the team")}>
            <LogOut className="h-4 w-4" /> Leave
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-6 border-b border-line">
        {tabs.filter(([, , show]) => show).map(([key, text]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-1 pb-3 text-[14.5px] font-semibold transition-colors ${
              tab === key ? "border-accent text-text" : "border-transparent text-text-dim hover:text-text"
            }`}
          >
            {text}
            {key === "requests" && pending.length > 0 && (
              <span className="h-1.5 w-1.5 rounded-full bg-danger" aria-label={`${pending.length} pending`} />
            )}
          </button>
        ))}
      </div>

      {tab === "details" && <DetailsTab team={team} stats={stats} />}
      {tab === "players" && (
        <PlayersTab
          team={team}
          members={members}
          names={names}
          stats={stats}
          meId={meId}
          isCaptain={isCaptain}
          onAct={act}
        />
      )}
      {tab === "settings" && isCaptain && <SettingsTab team={team} onSaved={load} />}
      {tab === "requests" && isCaptain && (
        <RequestsTab team={team} requests={pending} names={names} onAct={act} />
      )}
    </div>
  );
}

function DetailsTab({ team, stats }: { team: Team; stats: TeamStats | null }) {
  const boxes = [
    { label: "Total players", value: `${team.member_count}`, unit: "players" },
    { label: "Total flags", value: `${stats?.flags ?? 0}`, unit: "flags" },
    { label: "Total points", value: `${(stats?.points ?? 0).toLocaleString()}`, unit: "pts" },
    { label: "Events played", value: `${stats?.events_played ?? 0}`, unit: "events" },
  ];

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_260px]">
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {boxes.map((b) => (
            <Card key={b.label}>
              <CardBody className="py-4">
                <p className="text-[12px] text-text-dim">{b.label}</p>
                <p className="mt-1.5 text-[22px] font-bold leading-none text-text">
                  {b.value} <span className="text-[12px] font-medium text-text-faint">{b.unit}</span>
                </p>
              </CardBody>
            </Card>
          ))}
        </div>

        <Card>
          <CardBody>
            <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-text-faint">About team</h2>
            {team.description ? (
              <p className="whitespace-pre-line text-[14.5px] leading-relaxed text-text-dim">{team.description}</p>
            ) : (
              <p className="text-[14px] italic text-text-faint">This team hasn&apos;t written a description yet.</p>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardBody className="space-y-4">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-wide text-text-faint">Location</p>
            <p className="mt-1.5 flex items-center gap-2 text-[14px] text-text">
              {team.country_code ? (
                <>
                  <Flag code={team.country_code} /> {countryName(team.country_code)}
                </>
              ) : (
                <span className="text-text-faint">Not set</span>
              )}
            </p>
          </div>
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-wide text-text-faint">
              Affiliation
            </p>
            <p className="mt-1.5 text-[14px] text-text">
              {team.category_detail || <span className="text-text-faint">Not set</span>}
            </p>
          </div>
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-wide text-text-faint">Best rank</p>
            <p className="mt-1.5 text-[14px] text-text">{stats?.best_rank ? `#${stats.best_rank}` : "—"}</p>
          </div>
          {team.website && (
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-wide text-text-faint">Website</p>
              <a href={team.website} target="_blank" rel="noopener noreferrer" className="mt-1.5 block truncate text-[14px] text-accent hover:underline">
                {team.website}
              </a>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function PlayersTab({
  team, members, names, stats, meId, isCaptain, onAct,
}: {
  team: Team;
  members: TeamMember[];
  names: Record<string, string>;
  stats: TeamStats | null;
  meId: string;
  isCaptain: boolean;
  onAct: (fn: () => Promise<unknown>, ok: string) => Promise<void>;
}) {
  const [q, setQ] = useState("");
  const stat = (userId: string) =>
    stats?.members.find((m) => m.user_id === userId) ?? { points: 0, flags: 0, events_played: 0 };

  const shown = members.filter((m) =>
    (names[m.user_id] ?? m.user_id).toLowerCase().includes(q.trim().toLowerCase()),
  );

  return (
    <div className="space-y-4">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search players"
        className="w-full max-w-xs rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[14px] text-text outline-none placeholder:text-text-faint focus:border-line-strong"
      />

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-left">
            <thead>
              <tr className="border-b border-line text-[11.5px] font-semibold uppercase tracking-wide text-text-faint">
                <th className="px-5 py-3">Username</th>
                <th className="px-5 py-3">Role</th>
                <th className="px-5 py-3 text-right">Events</th>
                <th className="px-5 py-3 text-right">Points</th>
                <th className="px-5 py-3 text-right">Flags</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shown.map((m) => {
                const s = stat(m.user_id);
                return (
                  <tr key={m.user_id} className="text-[14px]">
                    <td className="px-5 py-3.5">
                      <span className="font-semibold text-text">{names[m.user_id] ?? m.user_id.slice(0, 8)}</span>
                      {m.user_id === meId && <span className="ml-2 text-[11px] text-text-faint">you</span>}
                    </td>
                    <td className="px-5 py-3.5 capitalize text-text-dim">
                      {m.role === "owner" ? "captain" : m.role}
                    </td>
                    <td className="px-5 py-3.5 text-right text-text-dim">{s.events_played}</td>
                    <td className="px-5 py-3.5 text-right text-text-dim">{s.points.toLocaleString()}</td>
                    <td className="px-5 py-3.5 text-right text-text-dim">{s.flags}</td>
                    <td className="px-5 py-3.5 text-right">
                      {isCaptain && m.user_id !== meId && (
                        <span className="flex justify-end gap-3">
                          <button
                            onClick={() => onAct(() => teamsApi.promote(team.id, m.user_id), "Promoted")}
                            className="text-[12.5px] font-semibold text-accent hover:underline"
                          >
                            Promote
                          </button>
                          <button
                            onClick={() => onAct(() => teamsApi.kick(team.id, m.user_id), "Removed from team")}
                            className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-danger hover:underline"
                          >
                            <UserMinus className="h-3 w-3" /> Remove
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {isCaptain && (
        <Card>
          <CardBody>
            {/* InvitePicker renders its own heading. */}
            <InvitePicker
              excludeIds={members.map((m) => m.user_id)}
              onInvite={async (userId, username) => {
                await teamsApi.invite(team.id, userId);
                toast.success(`Invited ${username}`);
              }}
            />
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function SettingsTab({ team, onSaved }: { team: Team; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(team.name);
  const [description, setDescription] = useState(team.description ?? "");
  const [country, setCountry] = useState(team.country_code ?? "");
  const [detail, setDetail] = useState(team.category_detail ?? "");
  const [website, setWebsite] = useState(team.website ?? "");
  const [recruiting, setRecruiting] = useState(team.is_recruiting);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  async function save() {
    if (name.trim().length < 3) return toast.error("Team name must be at least 3 characters");
    setSaving(true);
    try {
      await teamsApi.update(team.id, {
        name: name.trim(),
        description: description.trim(),
        country_code: country,
        category_detail: detail.trim(),
        website: website.trim(),
        is_recruiting: recruiting,
      });
      toast.success("Team settings saved");
      await onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save settings");
    } finally {
      setSaving(false);
    }
  }

  async function pickAvatar(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadAvatar(file);
      await teamsApi.update(team.id, { avatar_url: url });
      toast.success("Team picture updated");
      await onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not upload the picture");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <Card>
        <CardBody>
          <p className={label}>Team picture</p>
          <div className="flex items-center gap-4">
            {team.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={team.avatar_url} alt="" className="h-16 w-16 rounded-full object-cover" />
            ) : (
              <span className="grid h-16 w-16 place-items-center rounded-full bg-brand-gradient text-[18px] font-bold text-text-on-brand">
                {team.name.slice(0, 2).toUpperCase()}
              </span>
            )}
            <label className="cursor-pointer rounded-xl border border-line-strong bg-bg-elevated px-3.5 py-2 text-[13px] font-semibold text-text hover:bg-surface-hover">
              {uploading ? "Uploading…" : "Upload"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                disabled={uploading}
                onChange={(e) => void pickAvatar(e.target.files?.[0])}
              />
            </label>
            {team.avatar_url && (
              <button
                onClick={() =>
                  void (async () => {
                    await teamsApi.update(team.id, { avatar_url: "" });
                    toast.success("Team picture removed");
                    await onSaved();
                  })()
                }
                className="text-[13px] font-semibold text-danger hover:underline"
              >
                Remove
              </button>
            )}
          </div>
          <p className="mt-2.5 text-[12px] text-text-faint">PNG, JPEG or WebP, up to 2 MB.</p>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-4">
          <div>
            <label className={label}>Team name</label>
            <input className={field} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className={label}>Description</label>
            <textarea
              className={`${field} h-24 resize-y py-2.5`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Who you are, what you play, who you're looking for"
            />
          </div>
          <div>
            <label className={label}>Website</label>
            <input className={field} value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-4">
          <div>
            <label className={label}>Team country</label>
            <select className={field} value={country} onChange={(e) => setCountry(e.target.value)}>
              <option value="">Not set</option>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>Organisation, university or company</label>
            <input
              className={field}
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder="Optional — e.g. NUST Islamabad"
            />
            <p className="mt-1.5 text-[12px] text-text-faint">
              Shown on your team card and searchable. Leave it empty if your team
              isn&apos;t tied to an institution.
            </p>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[14px] font-semibold text-text">Allow join requests</p>
            <p className="mt-0.5 text-[12.5px] text-text-dim">
              When off, players can only join by invitation.
            </p>
          </div>
          <Toggle on={recruiting} onChange={setRecruiting} />
        </CardBody>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save changes
        </Button>
      </div>
    </div>
  );
}

function RequestsTab({
  team, requests, names, onAct,
}: {
  team: Team;
  requests: TeamJoinRequest[];
  names: Record<string, string>;
  onAct: (fn: () => Promise<unknown>, ok: string) => Promise<void>;
}) {
  const [recruiting, setRecruiting] = useState(team.is_recruiting);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-3">
        <span className="text-[13px] font-semibold text-text-dim">Allow requests</span>
        <Toggle
          on={recruiting}
          onChange={(v) => {
            setRecruiting(v);
            void onAct(() => teamsApi.update(team.id, { is_recruiting: v }), v ? "Requests allowed" : "Requests closed");
          }}
        />
      </div>

      {requests.length === 0 ? (
        <Card>
          <CardBody className="py-10 text-center text-[14px] text-text-dim">
            No pending join requests.
          </CardBody>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left">
              <thead>
                <tr className="border-b border-line text-[11.5px] font-semibold uppercase tracking-wide text-text-faint">
                  <th className="px-5 py-3">Username</th>
                  <th className="px-5 py-3">Message</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {requests.map((r) => (
                  <tr key={r.id} className="text-[14px]">
                    <td className="px-5 py-3.5 font-semibold text-text">
                      {names[r.user_id] ?? r.user_id.slice(0, 8)}
                    </td>
                    <td className="px-5 py-3.5 text-text-dim">{r.message || "—"}</td>
                    <td className="px-5 py-3.5 text-right">
                      <span className="flex justify-end gap-3">
                        <button
                          onClick={() => onAct(() => teamsApi.decideJoinRequest(r.id, true), "Request accepted")}
                          className="text-[12.5px] font-semibold text-accent hover:underline"
                        >
                          Accept
                        </button>
                        <button
                          onClick={() => onAct(() => teamsApi.decideJoinRequest(r.id, false), "Request declined")}
                          className="text-[12.5px] font-semibold text-danger hover:underline"
                        >
                          Decline
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-accent" : "bg-surface-hover"}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${on ? "left-[22px]" : "left-0.5"}`}
      />
    </button>
  );
}
