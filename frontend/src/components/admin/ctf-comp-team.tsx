"use client";

/**
 * Adding a team to a paid event by hand.
 *
 * Some entrants a payment gateway cannot serve: a first-semester student let in
 * free on a checked university card, an invited guest team, a fee that arrived
 * in cash. The alternative to this panel is running the event as free — which
 * prices it wrong for everyone else — or keeping those teams on paper, where
 * nothing is recorded and nobody downstream knows they are in.
 *
 * The team lands on the same entry row a paid team does, so the roster, member
 * joins and the scoreboard cannot tell the difference. Only the provider on the
 * entry can, which is how the takings still reconcile afterwards.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Loader2, Search, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { ctfAdminApi } from "@/lib/ctf-admin-api";
import { teamsApi, type Team } from "@/lib/teams-api";

const field =
  "h-10 w-full rounded-xl border border-line-strong bg-bg-elevated px-3.5 text-[14px] text-text placeholder:text-text-faint focus:border-accent focus:outline-none";
const label = "mb-1.5 block text-[12px] font-semibold uppercase tracking-wide text-text-dim";

export function CtfCompTeam({
  eventId,
  currency,
  feeCents,
}: {
  eventId: string;
  currency: string;
  feeCents: number;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Team[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<Team | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  /** Teams added in this sitting, so the organiser can see the list grow. */
  const [added, setAdded] = useState<Team[]>([]);

  const search = useCallback(async (text: string) => {
    if (text.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      setResults((await teamsApi.browse({ q: text.trim() })).slice(0, 8));
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void search(q), 250);
    return () => clearTimeout(t);
  }, [q, search]);

  async function add() {
    if (!picked) return;
    setSaving(true);
    try {
      await ctfAdminApi.compTeam(eventId, {
        team_id: picked.id,
        // The owner leads them in. Asking the organiser to name a captain as
        // well would be a second lookup for an answer the team already holds.
        captain_id: picked.owner_id,
        team_name: picked.name,
        note: note.trim() || undefined,
      });
      toast.success(`“${picked.name}” is in — no payment required`);
      setAdded((prev) => (prev.some((t) => t.id === picked.id) ? prev : [picked, ...prev]));
      setPicked(null);
      setNote("");
      setQ("");
      setResults([]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add the team");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex items-center gap-2 text-[14px] font-semibold">
          <UserPlus className="h-4 w-4" /> Add a team without payment
        </div>
        <p className="text-[12px] text-text-faint">
          This event charges {currency} {(feeCents / 100).toLocaleString()} per team. A team
          added here is registered as if it had paid — roster, joins and scoring all behave
          the same — but nothing is charged and the entry is marked as granted rather than
          bought. Everyone else still sees the paywall.
        </p>

        <div>
          <label className={label}>Find the team</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
            <input
              className={`${field} pl-9`}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPicked(null);
              }}
              placeholder="Team name…"
            />
          </div>
        </div>

        {picked ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-xl border border-accent bg-bg-elevated px-3.5 py-2.5">
              <Check className="h-4 w-4 shrink-0 text-accent" />
              <span className="min-w-0 truncate text-[14px] font-semibold">{picked.name}</span>
              <span className="ml-auto shrink-0 text-[12px] text-text-faint">
                {picked.member_count} member{picked.member_count === 1 ? "" : "s"}
              </span>
            </div>
            <div>
              <label className={label}>Why (optional)</label>
              <input
                className={field}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="CNIC + university card checked — 1st semester"
              />
              <p className="mt-1 text-[11px] text-text-faint">
                Kept on the entry. When the takings are reconciled this is the only record of
                why this team paid nothing.
              </p>
            </div>
            <div className="flex gap-2">
              <Button onClick={add} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                Add “{picked.name}”
              </Button>
              <Button variant="ghost" onClick={() => setPicked(null)} disabled={saving}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            {searching && (
              <p className="flex items-center gap-2 text-[13px] text-text-dim">
                <Loader2 className="h-4 w-4 animate-spin" /> Searching…
              </p>
            )}
            {!searching && q.trim().length >= 2 && results.length === 0 && (
              <p className="text-[13px] text-text-dim">No team by that name.</p>
            )}
            {results.length > 0 && (
              <ul className="space-y-1.5">
                {results.map((t) => (
                  <li key={t.id}>
                    <button
                      onClick={() => setPicked(t)}
                      className="flex w-full items-center gap-3 rounded-xl border border-line-strong bg-bg-elevated px-3.5 py-2.5 text-left hover:border-accent"
                    >
                      <span className="min-w-0 truncate text-[14px] font-semibold">{t.name}</span>
                      <span className="ml-auto shrink-0 text-[12px] text-text-faint">
                        {t.member_count} member{t.member_count === 1 ? "" : "s"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {added.length > 0 && (
          <div className="border-t border-line pt-3">
            <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-text-dim">
              Added just now
            </p>
            <ul className="space-y-1">
              {added.map((t) => (
                <li key={t.id} className="flex items-center gap-2 text-[13px] text-text-dim">
                  <Check className="h-3.5 w-3.5 text-accent" /> {t.name}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
