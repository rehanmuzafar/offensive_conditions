"use client";

import { useState } from "react";
import { CheckCircle2, Download, Lightbulb, Lock, Droplet, X } from "lucide-react";

import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { useSubmitChallengeFlag } from "@/hooks/use-community";
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
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  function toggleHint(id: string) {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl border border-line bg-surface shadow-card-lg animate-fade-up sm:rounded-3xl">
        {/* header */}
        <div className="sticky top-0 flex items-start justify-between border-b border-line bg-surface/95 p-5 backdrop-blur">
          <div>
            <div className="flex items-center gap-2">
              <span className={cn("rounded-md px-2 py-0.5 text-[11.5px] font-semibold capitalize", CATEGORY_COLOR[challenge.category])}>
                {challenge.category}
              </span>
              <span className="font-display text-[14px] font-bold text-accent">{challenge.points} pts</span>
              {challenge.solved && (
                <span className="flex items-center gap-1 rounded-full bg-success/12 px-2 py-0.5 text-[11.5px] font-semibold text-success">
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

          {/* connection info */}
          {challenge.connectionInfo && (
            <div className="mt-4 rounded-xl border border-line bg-bg-elevated p-3">
              <div className="mb-1 text-[12px] font-medium text-text-faint">Connection</div>
              <code className="font-mono text-[14px] text-accent">{challenge.connectionInfo}</code>
            </div>
          )}

          {/* files */}
          {challenge.files.length > 0 && (
            <div className="mt-4 space-y-2">
              <div className="text-[13px] font-semibold text-text">Files</div>
              {challenge.files.map((f) => (
                <a
                  key={f.name}
                  href={f.url}
                  className="flex items-center gap-3 rounded-xl border border-line p-3 transition-colors hover:border-accent hover:bg-surface-hover"
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
                const open = revealed.has(hint.id) || hint.unlocked;
                return (
                  <div key={hint.id} className="rounded-xl border border-line p-3">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2 text-[13.5px] font-medium">
                        <Lightbulb className="h-4 w-4 text-warning" /> Hint {idx + 1}
                      </span>
                      {open ? (
                        <span className="text-[12px] text-text-faint">unlocked</span>
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => toggleHint(hint.id)}>
                          <Lock className="h-3.5 w-3.5" /> Unlock (−{hint.cost} pts)
                        </Button>
                      )}
                    </div>
                    {open && (
                      <p className="mt-2 text-[13.5px] text-text-dim">
                        {hint.text ?? "Look closely at how the input is validated — the check happens client-side first."}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* submit */}
          {!challenge.solved && (
            <div className="mt-5 flex gap-2">
              <input
                value={flag}
                onChange={(e) => setFlag(e.target.value)}
                placeholder="OFFCON{...}"
                className="h-11 flex-1 rounded-xl border border-line-strong bg-bg-elevated px-3.5 font-mono text-[14px] text-text placeholder:text-text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && flag.trim()) submit.mutate({ challengeId: challenge.id, flag });
                }}
              />
              <Button
                size="lg"
                loading={submit.isPending}
                disabled={!flag.trim()}
                onClick={() => submit.mutate({ challengeId: challenge.id, flag })}
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
