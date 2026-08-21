"use client";

import { useCallback, useState } from "react";

import { ChallengeAccess } from "@/components/ctf/challenge-access";
import { ChallengeVerdictScene, useAnnounceSolved } from "@/components/ctf/challenge-verdict-scene";
import { playVerdict } from "@/components/landing/lib/verdict";
import { CheckCircle2, Download, Lightbulb, Lock, Droplet, X } from "lucide-react";

import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { useSubmitChallengeFlag, useUnlockHint } from "@/hooks/use-community";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/cn";
import {
  ChallengeProgressControl,
  ProgressBadge,
} from "@/components/ctf/challenge-progress-control";
import type { ChallengeProgress } from "@/lib/progress-api";
import type { CtfChallenge, ChallengeCategory } from "@/types/ctf";

const CATEGORY_COLOR: Record<ChallengeCategory, string> = {
  web: "text-info bg-info/12",
  pwn: "text-danger bg-danger/12",
  crypto: "text-accent bg-brand-gradient-soft",
  reverse: "text-warning bg-warning/12",
  forensics: "text-success bg-success/12",
  osint: "text-info bg-info/12",
  misc: "text-text-dim bg-surface-hover",
  hardware: "text-warning bg-warning/12",
};

export function ChallengeCard({
  challenge,
  onOpen,
  progress,
}: {
  challenge: CtfChallenge;
  onOpen: () => void;
  progress?: ChallengeProgress;
}) {
  return (
    <button onClick={onOpen} className="w-full text-left">
      <Card interactive className={cn("h-full p-0", challenge.solved && "border-success/40")}>
        <CardBody className="p-4">
          <div className="flex items-start justify-between">
            <span className={cn("rounded-md px-2 py-0.5 text-[11.5px] font-semibold capitalize", CATEGORY_COLOR[challenge.category])}>
              {challenge.category}
            </span>
            <span className="flex items-center gap-1.5">
              <ProgressBadge progress={progress} />
              {challenge.solved && <CheckCircle2 className="h-5 w-5 text-success" />}
            </span>
          </div>
          <h3 className="mt-2.5 font-display text-[16px] font-bold">{challenge.title}</h3>
          <div className="mt-3 flex items-center justify-between">
            <span className="font-display text-[18px] font-extrabold text-gradient">{challenge.points}</span>
            <span className="text-[12px] text-text-faint">{challenge.solveCount.toLocaleString()} solves</span>
          </div>
        </CardBody>
      </Card>
    </button>
  );
}

export function ChallengeSolver({
  eventSlug,
  eventId,
  challenge,
  progress,
  onClose,
}: {
  eventSlug: string;
  /** Progress endpoints are keyed by event id, not slug. */
  eventId?: string;
  challenge: CtfChallenge;
  progress?: ChallengeProgress;
  onClose: () => void;
}) {
  const submit = useSubmitChallengeFlag(eventSlug);
  const [flag, setFlag] = useState("");
  /** Bumped on a wrong answer so the input replays its shake. */
  const [rejected, setRejected] = useState(0);
  /** Held for the length of the celebration; see the drawer for why. */
  const [accepted, setAccepted] = useState(false);

  const announceSolved = useCallback(() => playVerdict("solved"), []);
  useAnnounceSolved(challenge.solved, announceSolved);

  /**
   * Submit, then let the skull answer.
   *
   * The verdict is driven from the mutation's result rather than from the
   * toast, so the reaction and the message can never disagree — and the wrong
   * case bumps `rejected`, which is what restarts the input's shake even when
   * the same wrong flag is submitted twice.
   */
  const trySubmit = useCallback(() => {
    const value = flag.trim();
    if (!value) return;

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
  /** hint id → the text the server returned on unlock. */
  const [revealed, setRevealed] = useState<Map<string, string>>(new Map());
  const unlockHint = useUnlockHint(eventSlug);

  /**
   * Unlocking costs points, so it goes to the server and shows only what comes
   * back. This used to flip a local flag and, when the server had withheld the
   * text, print a canned sentence — an invented hint presented as the author's.
   */
  function unlock(hintId: string) {
    unlockHint.mutate(
      { challengeId: challenge.id, hintId },
      { onSuccess: (res) => setRevealed((prev) => new Map(prev).set(hintId, res.text)) },
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Between the backdrop and the panel.

          It was mounted outside this overlay at -z-1 — behind the entire page,
          under a `fixed inset-0` dialog with an opaque backdrop, so it rendered
          perfectly and was never once visible. A scene that reacts to what
          happens *in* a dialog has to live inside that dialog's stacking
          context. */}
      <ChallengeVerdictScene />

        <div className="relative z-10 max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl glass shadow-card-lg animate-fade-up sm:rounded-3xl">
          {/* header */}
          <div className="sticky top-0 flex items-start justify-between border-b border-line bg-surface/95 p-5 backdrop-blur">
            <div>
              <div className="flex items-center gap-2">
                <span className={cn("rounded-md px-2 py-0.5 text-[11.5px] font-semibold capitalize", CATEGORY_COLOR[challenge.category])}>
                  {challenge.category}
                </span>
                <span className="font-display text-[14px] font-bold text-accent">{challenge.points} pts</span>
                {challenge.solved && (
                  <span className="flex items-center gap-1 bg-success/12 px-2 py-0.5 text-[11.5px] font-semibold text-success">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Solved
                  </span>
                )}
              </div>
              <h2 className="mt-2 font-display text-[22px] font-extrabold tracking-[-0.5px]">{challenge.title}</h2>
            </div>
            <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-xl border border-line-strong text-text-dim hover:text-text">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="p-5">
            {/* team status + assignment — only meaningful once we know the event id */}
            {eventId && (
              <div className="mb-4">
                <ChallengeProgressControl
                  eventId={eventId}
                  challengeId={challenge.id}
                  progress={progress}
                />
              </div>
            )}

            {/* first blood */}
            {challenge.firstBlood && (
              <div className="mb-4 flex items-center gap-2 rounded-xl border border-danger/25 bg-danger/8 px-3 py-2 text-[13px]">
                <Droplet className="h-4 w-4 text-danger" fill="currentColor" />
                <span className="text-text-dim">
                  First blood by <b className="text-text">{challenge.firstBlood.username}</b> · {formatRelative(challenge.firstBlood.at)}
                </span>
              </div>
            )}

            {/* description */}
            <Markdown>{challenge.description}</Markdown>

            <div className="mt-4">
              <ChallengeAccess challenge={challenge} slug={eventSlug} />
            </div>

            {/* files */}
            {challenge.files.length > 0 && (
              <div className="mt-4 space-y-2">
                <div className="text-[13px] font-semibold text-text">Files</div>
                {challenge.files.map((f) => (
                  <a
                    key={f.name}
                    href={f.url}
                    className="group relative flex items-center gap-3 rounded-xl border border-line p-3 transition-colors hover:border-accent hover:bg-surface-hover"
                  >
                    <Download className="h-4 w-4 text-accent" />
                    <span className="flex-1 font-mono text-[13.5px]">{f.name}</span>
                    <span className="text-[12px] text-text-faint">{(f.sizeBytes / 1024).toFixed(0)} KB</span>
                  </a>
                ))}
              </div>
            )}

            {/* hints */}
            {challenge.hints.length > 0 && (
              <div className="mt-4 space-y-2">
                <div className="text-[13px] font-semibold text-text">Hints</div>
                {challenge.hints.map((hint, idx) => {
                  const text = revealed.get(hint.id) ?? hint.text ?? null;
                  const open = text != null;
                  return (
                    <div key={hint.id} className="rounded-xl border border-line p-3">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2 text-[13.5px] font-medium">
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
                        <p className="mt-2 text-[13.5px] text-text-dim">{text}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* submit */}
            {(!challenge.solved || accepted) && (
              <div className={cn("mt-5 flex gap-2", accepted && "flag-accept-burst")}>
                <input
                  /* Keyed on the rejection count so React remounts it and the
                     shake animation restarts — re-applying a class to a live
                     element does nothing if the animation is already finished. */
                  key={rejected}
                  value={flag}
                  onChange={(e) => setFlag(e.target.value)}
                  placeholder="OFFCON{...}"
                  className={cn(
                    "h-11 flex-1 border bg-transparent px-3.5 font-mono text-[13px] text-text placeholder:text-text-ghost focus:outline-none",
                    accepted
                      ? "flag-accept"
                      : rejected > 0
                        ? "animate-flag-reject border-danger text-danger"
                        : "border-line-strong focus:border-text",
                  )}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") trySubmit();
                  }}
                />
                <Button
                  size="lg"
                  loading={submit.isPending}
                  disabled={!flag.trim()}
                  onClick={trySubmit}
                >
                  Submit flag
                </Button>
              </div>
            )}
          </div>
        </div>
    </div>
  );
}
