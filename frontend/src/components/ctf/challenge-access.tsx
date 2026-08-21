"use client";

import { useEffect, useState } from "react";
import { Copy, ExternalLink, Loader2, Play, Server, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  useChallengeInstance,
  useSpawnInstance,
  useStopInstance,
} from "@/hooks/use-community";
import type { CtfChallenge } from "@/types/ctf";

/**
 * How a player gets at the challenge.
 *
 * The address used to sit bare on the panel, which gives away that a challenge
 * is even reachable before anyone has chosen to engage with it, and reads as
 * clutter on the two thirds of challenges that have no address at all. It is
 * behind a deliberate action now — the same shape of action for both hosted
 * kinds, so players learn one control rather than two.
 *
 * What the control does depends on how the challenge is served:
 *
 *   static      Nothing to reach. Renders nothing rather than an inert button.
 *   shared_host One address, already running, shared by everyone. "Spawning"
 *               it would be theatre, so the button reveals it and says so.
 *   per_player  Needs a container started. One per *team*, not per player —
 *               see `InstancePanel`.
 */
export function ChallengeAccess({
  challenge,
  slug,
}: {
  challenge: CtfChallenge;
  /** Needed to spawn; without it the instance control cannot be offered. */
  slug?: string;
}) {
  const [revealed, setRevealed] = useState(false);

  if (challenge.deliveryType === "static") return null;

  if (challenge.deliveryType === "per_player") {
    return slug ? <InstancePanel challenge={challenge} slug={slug} /> : null;
  }

  if (!challenge.connectionInfo) return null;

  const url = challenge.connectionInfo;
  const isLink = /^https?:\/\//.test(url);

  return (
    <div className="rounded-xl border border-line bg-surface p-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11.5px] font-semibold uppercase tracking-wide text-text-faint">
            Connection
          </p>
          {!revealed && (
            <p className="mt-0.5 text-[12.5px] text-text-dim">
              Shared host — already running for everyone.
            </p>
          )}
        </div>

        {!revealed && (
          <Button size="sm" onClick={() => setRevealed(true)}>
            <Play className="h-3.5 w-3.5" /> Get connection
          </Button>
        )}
      </div>

      {revealed && (
        <div className="mt-2.5 flex items-center gap-2">
          {isLink ? (
            <a
              href={url}
              target="_blank"
              rel="noreferrer noopener"
              className="flex min-w-0 flex-1 items-center gap-1.5 break-all font-mono text-[13.5px] text-accent hover:underline"
            >
              {url}
              <ExternalLink className="h-3.5 w-3.5 shrink-0" />
            </a>
          ) : (
            /* nc-style host:port, which is not a link and must not pretend to be */
            <code className="min-w-0 flex-1 break-all font-mono text-[13.5px] text-accent">
              {url}
            </code>
          )}
          <button
            aria-label="Copy connection"
            onClick={() => {
              void navigator.clipboard.writeText(url);
              toast.success("Connection copied.");
            }}
            className="shrink-0 rounded-lg p-1.5 text-text-faint transition-colors hover:text-text"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The team's container for one challenge.
 *
 * Per team, not per player: three teammates each running their own copy would
 * triple the infrastructure and split the team across three hosts. So whoever
 * presses Spawn first starts it, and everyone else on the team sees the same
 * address appear — which is why this reads from a cache keyed on the challenge
 * rather than on the viewer, and why the button says who started it.
 */
function InstancePanel({ challenge, slug }: { challenge: CtfChallenge; slug: string }) {
  const { data: instance, isLoading } = useChallengeInstance(slug, challenge.id);
  const spawn = useSpawnInstance(slug);
  const stop = useStopInstance(slug);

  const live = instance && (instance.status === "running" || instance.status === "queued");
  const address = instance?.connection ?? null;

  return (
    <div className="rounded-xl border border-line bg-surface p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-text-faint">
            <Server className="h-3 w-3" /> Team instance
          </p>
          <p className="mt-0.5 text-[12.5px] text-text-dim">
            {live
              ? instance?.spawnedByName
                ? `Started by ${instance.spawnedByName}. Shared with your team.`
                : "Running for your whole team."
              : "One container for your team. Anyone on it can start or stop it."}
          </p>
        </div>

        {isLoading ? null : live ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={stop.isPending}
            onClick={() => {
              stop.mutate(challenge.id, {
                onSuccess: () => toast.success("Instance stopped."),
                onError: () => toast.error("Could not stop the instance."),
              });
            }}
          >
            {stop.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Square className="h-3.5 w-3.5" />
            )}
            Stop
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={spawn.isPending}
            onClick={() => {
              spawn.mutate(challenge.id, {
                onError: (err) =>
                  toast.error(
                    err instanceof Error ? err.message : "Could not start the instance.",
                  ),
              });
            }}
          >
            {spawn.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            {spawn.isPending ? "Starting…" : "Spawn"}
          </Button>
        )}
      </div>

      {live && address && (
        <div className="mt-2.5 flex items-center gap-2">
          <code className="min-w-0 flex-1 break-all font-mono text-[13.5px] text-accent">
            {address}
          </code>
          <button
            aria-label="Copy address"
            onClick={() => {
              void navigator.clipboard.writeText(address);
              toast.success("Address copied.");
            }}
            className="shrink-0 rounded-lg p-1.5 text-text-faint transition-colors hover:text-text"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {live && instance?.expiresAt && <Expiry at={instance.expiresAt} />}

      {instance?.status === "error" && (
        <p className="mt-2 text-[12px] text-danger">
          {instance.error || "The container failed to start."}
        </p>
      )}
    </div>
  );
}

/**
 * Time left on the box.
 *
 * A ticking clock rather than a timestamp: "expires 14:32" needs the player to
 * know what time it is now, which is exactly the thing someone six hours into
 * a CTF does not.
 */
function Expiry({ at }: { at: string }) {
  const [left, setLeft] = useState(() => msLeft(at));

  useEffect(() => {
    setLeft(msLeft(at));
    const t = setInterval(() => setLeft(msLeft(at)), 1000);
    return () => clearInterval(t);
  }, [at]);

  if (left <= 0) return null;
  const mins = Math.floor(left / 60000);
  const secs = Math.floor((left % 60000) / 1000);

  return (
    <p className="mt-2 text-[11.5px] tabular-nums text-text-faint">
      Expires in {mins}:{String(secs).padStart(2, "0")}
    </p>
  );
}

function msLeft(iso: string): number {
  return Math.max(0, new Date(iso).getTime() - Date.now());
}
