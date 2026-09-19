"use client";

/**
 * Scenario detail as a left slide-over.
 *
 * A centred modal fights the board: you lose your place in the list and the
 * three-column layout collapses behind a dimmed sheet. Sliding in from the left
 * keeps the row you came from visible on the right, so flag → next scenario
 * stays one glance apart.
 */

import { useCallback, useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, Download, Lightbulb, Lock, X } from "lucide-react";

import { ChallengeAccess } from "@/components/ctf/challenge-access";
import { ChallengeVerdictScene, useAnnounceSolved } from "@/components/ctf/challenge-verdict-scene";
import { playVerdict } from "@/components/landing/lib/verdict";
import { Button } from "@/components/ui/button";

import { cn } from "@/lib/cn";
import { useSubmitChallengeFlag, useUnlockHint } from "@/hooks/use-community";
import type { CtfChallenge } from "@/types/ctf";

export function ScenarioDrawer({
  challenge,
  slug,
  onClose,
}: {
  challenge: CtfChallenge;
  slug: string;
  onClose: () => void;
}) {
  const submit = useSubmitChallengeFlag(slug);
  const [flag, setFlag] = useState("");
  /** Bumped on a wrong answer so the input replays its shake. */
  const [rejected, setRejected] = useState(0);
  /**
   * Held for the length of the celebration.
   *
   * A correct flag refetches the challenge, so `solved` flips and the whole
   * submit block would unmount within a couple of hundred milliseconds — taking
   * the green burst with it before anyone saw it. This keeps the field on
   * screen long enough to finish the animation.
   */
  const [accepted, setAccepted] = useState(false);
  /** hint id → the text the server returned on unlock. */
  const [revealed, setRevealed] = useState<Map<string, string>>(new Map());
  const unlockHint = useUnlockHint(slug);

  const announceSolved = useCallback(() => playVerdict("solved"), []);
  useAnnounceSolved(challenge.solved, announceSolved);

  /**
   * Submit, then let the skull answer.
   *
   * Driven from the mutation's result rather than from the toast, so the
   * reaction and the message can never disagree.
   */
  const trySubmit = useCallback(() => {
    const value = flag.trim();
    if (!value) return;
    setFlag("");

    submit.mutate(
      { challengeId: challenge.id, flag: value },
      {
        onSuccess: (res) => {
          if (res.correct && !res.alreadySolved) {
            playVerdict("correct");
            setAccepted(true);
            setTimeout(() => setAccepted(false), 1600);
          } else if (res.alreadySolved) {
            playVerdict("solved");
          } else {
            playVerdict("wrong");
            setRejected((n) => n + 1);
          }
        },
        onError: () => {
          playVerdict("wrong");
          setRejected((n) => n + 1);
        },
      },
    );
  }, [flag, challenge.id, submit]);

  /**
   * Unlocking costs points, so it goes to the server and the text shown is
   * whatever the server sends back — never a local guess.
   */
  function unlock(hintId: string) {
    unlockHint.mutate(
      { challengeId: challenge.id, hintId },
      { onSuccess: (res) => setRevealed((prev) => new Map(prev).set(hintId, res.text)) },
    );
  }
  // Escape closes it — the drawer is transient, so trapping the player in it
  // would be worse than the modal it replaces.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* The skull leans in from the right, opposite the panel, so the two
          never read each other's space. It sits above the dimmed board (z-0)
          and below the panel (z-20). */}
      <ChallengeVerdictScene layerClassName="z-10" />

      <aside className="animate-slide-in-left relative z-20 h-full w-full max-w-[560px] overflow-y-auto border-r border-line bg-bg-elevated">
        {challenge.solved && (
          <div className="flex items-center gap-2.5 bg-success/15 px-5 py-3.5">
            <CheckCircle2 className="h-5 w-5 text-success" />
            <span className="text-[14.5px] font-bold text-success">Scenario pwned</span>
          </div>
        )}

        <div className="flex items-start justify-between gap-4 px-5 pt-5">
          <div className="min-w-0">
            <p className="text-[11.5px] font-semibold uppercase tracking-wide text-text-faint">
              Scenario name
            </p>
            <h2 className="mt-1 font-display text-[20px] font-bold text-text">{challenge.title}</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-text-faint hover:bg-surface-hover hover:text-text"
          >
            <X className="h-4.5 w-4.5" />
          </button>
        </div>

        <div className="space-y-5 px-5 py-5">
          {challenge.description && (
            <p className="whitespace-pre-line text-[14px] leading-relaxed text-text-dim">
              {challenge.description}
            </p>
          )}

          {(!challenge.solved || accepted) && (
            <div className={cn("relative", accepted && "flag-accept-burst")}>
              <input
                /* Keyed on the rejection count so React remounts it and the
                   shake restarts — re-applying a class to a live element does
                   nothing once the animation has finished. */
                key={rejected}
                value={flag}
                onChange={(e) => setFlag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") trySubmit();
                }}
                placeholder="Submit flag & press enter"
                className={cn(
                  "w-full rounded-xl border bg-surface py-2.5 pl-3.5 pr-11 text-[14px] text-text outline-none placeholder:text-text-faint",
                  accepted
                    ? "flag-accept"
                    : rejected > 0
                      ? "animate-flag-reject border-danger text-danger"
                      : "border-line-strong focus:border-accent",
                )}
              />
              <button
                aria-label="Submit flag"
                disabled={!flag.trim() || submit.isPending}
                onClick={trySubmit}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-text-faint hover:text-accent disabled:opacity-40"
              >
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          )}

          <ChallengeAccess challenge={challenge} slug={slug} />

          {challenge.files.length > 0 && (
            <div className="rounded-xl glass p-4">
              <p className="text-[14px] font-semibold text-text">Scenario files</p>
              <p className="mt-0.5 text-[12.5px] text-text-dim">
                Files to assist you in finding the flag
              </p>
              <ul className="mt-3 space-y-1.5">
                {challenge.files.map((f) => (
                  <li key={f.url}>
                    <a
                      href={f.url}
                      className="flex items-center gap-2 text-[13.5px] text-accent hover:underline"
                    >
                      <Download className="h-3.5 w-3.5" /> {f.name}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {challenge.hints.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11.5px] font-semibold uppercase tracking-wide text-text-faint">
                Hints
              </p>
              {challenge.hints.map((hint, idx) => {
                const text = revealed.get(hint.id) ?? hint.text ?? null;
                const open = text != null;
                return (
                  <div key={hint.id} className="rounded-xl border border-line p-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2 text-[13.5px] font-medium text-text">
                        <Lightbulb className="h-4 w-4 text-warning" /> Hint {idx + 1}
                      </span>
                      {open ? (
                        <span className="text-[12px] text-text-faint">unlocked</span>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          loading={unlockHint.isPending}
                          onClick={() => unlock(hint.id)}
                        >
                          <Lock className="h-3.5 w-3.5" /> Unlock (−{hint.cost} pts)
                        </Button>
                      )}
                    </div>
                    {open && (
                      <p className="mt-2 text-[13.5px] leading-relaxed text-text-dim">{text}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-line">
            <Stat label="Points" value={`${challenge.points}`} />
            <Stat label="Difficulty" value={challenge.difficulty} className="border-l border-line" />
          </div>
        </div>
      </aside>

      {/* Clicking the board behind closes, the way a drawer should. */}
      <button
        aria-label="Close scenario"
        onClick={onClose}
        className="relative z-0 h-full flex-1 cursor-default bg-black/50"
      />
    </div>
  );
}

function Stat({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={cn("px-4 py-3.5 text-center", className)}>
      <p className="font-mono text-[16px] font-bold capitalize text-text">{value}</p>
      <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-text-faint">
        {label}
      </p>
    </div>
  );
}
