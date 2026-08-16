"use client";

/**
 * Scenario detail as a left slide-over.
 *
 * A centred modal fights the board: you lose your place in the list and the
 * three-column layout collapses behind a dimmed sheet. Sliding in from the left
 * keeps the row you came from visible on the right, so flag → next scenario
 * stays one glance apart.
 */

import { useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, Download, X } from "lucide-react";

import { cn } from "@/lib/cn";
import { useSubmitChallengeFlag } from "@/hooks/use-community";
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
      <aside className="animate-slide-in-left h-full w-full max-w-[560px] overflow-y-auto border-r border-line bg-bg-elevated">
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

          {!challenge.solved && (
            <div className="relative">
              <input
                value={flag}
                onChange={(e) => setFlag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && flag.trim()) {
                    submit.mutate({ challengeId: challenge.id, flag });
                    setFlag("");
                  }
                }}
                placeholder="Submit flag & press enter"
                className="w-full rounded-xl border border-line-strong bg-surface py-2.5 pl-3.5 pr-11 text-[14px] text-text outline-none placeholder:text-text-faint focus:border-accent"
              />
              <button
                aria-label="Submit flag"
                disabled={!flag.trim() || submit.isPending}
                onClick={() => {
                  submit.mutate({ challengeId: challenge.id, flag });
                  setFlag("");
                }}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-text-faint hover:text-accent disabled:opacity-40"
              >
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          )}

          {challenge.files.length > 0 && (
            <div className="rounded-xl border border-line bg-surface p-4">
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
        className="h-full flex-1 cursor-default bg-black/50"
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
