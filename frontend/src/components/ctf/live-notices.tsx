"use client";

/**
 * The event-wide ticker: who just spawned a box, who just pwned one.
 *
 * Bottom-right rather than top-centre. The top of the arena is the event bar
 * and the countdown, and a notice that covers those during the last minutes of
 * a CTF is worse than no notice at all. Bottom-right is also where the eye is
 * not, which is right for something that must never take a player's attention
 * off a flag box.
 *
 * Notices age out on their own. Hovering the stack holds them: a name you half
 * caught is worth a second look, and a strip that dissolves as you reach for it
 * is a well-known way to make an interface feel hostile.
 */

import { useEffect, useRef, useState } from "react";
import { Skull, Zap } from "lucide-react";

import { useLiveFeedStore, type LiveNotice } from "@/stores/live-feed-store";
import { cn } from "@/lib/cn";

// Long enough to read a name and a challenge title twice over.
const LIFETIME_MS = 9000;

export function LiveNotices() {
  const notices = useLiveFeedStore((s) => s.notices);
  const dismiss = useLiveFeedStore((s) => s.dismiss);
  const [held, setHeld] = useState(false);
  // Expiry is paused, not cancelled, while the pointer is over the stack, so
  // the remaining time is what is left rather than a fresh full lifetime.
  const remaining = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (held) return;
    const timers = notices.map((n) => {
      const left = remaining.current.get(n.id) ?? LIFETIME_MS - (Date.now() - n.at);
      remaining.current.delete(n.id);
      return setTimeout(() => dismiss(n.id), Math.max(600, left));
    });
    return () => {
      timers.forEach(clearTimeout);
      if (held) return;
    };
  }, [notices, held, dismiss]);

  const hold = () => {
    notices.forEach((n) =>
      remaining.current.set(n.id, Math.max(600, LIFETIME_MS - (Date.now() - n.at))),
    );
    setHeld(true);
  };

  if (notices.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-40 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2"
      onMouseEnter={hold}
      onMouseLeave={() => setHeld(false)}
      aria-live="polite"
    >
      {notices.map((n, i) => (
        <NoticeCard key={n.id} notice={n} index={i} held={held} />
      ))}
    </div>
  );
}

function NoticeCard({
  notice,
  index,
  held,
}: {
  notice: LiveNotice;
  index: number;
  held: boolean;
}) {
  const pwned = notice.kind === "pwned";
  return (
    <div
      className={cn(
        "live-notice edge-iridescent pointer-events-auto group relative overflow-hidden rounded-xl",
        "glass-strong px-3.5 py-3 shadow-[0_18px_44px_-24px_rgba(0,0,0,0.9)]",
        "transition-transform duration-300 hover:-translate-x-1",
      )}
      style={{
        // Older notices sit slightly back, so the newest is unambiguously the
        // one to read first.
        opacity: held ? 1 : Math.max(0.55, 1 - index * 0.14),
        transform: `scale(${1 - index * 0.02})`,
      }}
    >
      {/* The sweep is what makes a new notice register in peripheral vision.
          It runs once, on mount — a looping shimmer down here would compete
          with the scenario board for attention all event long. */}
      <span className="live-notice-sweep" aria-hidden />

      <div className="relative flex items-start gap-2.5">
        <span
          className={cn(
            "mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg border",
            pwned
              ? "border-accent/40 bg-accent/10 text-accent"
              : "border-line bg-white/5 text-text-muted",
          )}
        >
          {pwned ? <Skull className="h-3.5 w-3.5" /> : <Zap className="h-3.5 w-3.5" />}
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-[13px] leading-snug text-text">
            <span className="font-display font-bold text-text">{notice.playerName}</span>{" "}
            <span className="text-text-muted">has {pwned ? "pwned" : "spawned"}</span>{" "}
            <span className="font-medium text-accent">{notice.challengeName}</span>
          </p>

          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-text-dim">
            {notice.teamName ? <span className="truncate">{notice.teamName}</span> : null}
            {notice.firstBlood ? (
              <span className="rounded border border-danger/40 bg-danger/10 px-1.5 py-px font-medium uppercase tracking-wide text-danger">
                First blood
              </span>
            ) : null}
            {pwned && notice.points ? <span>+{notice.points}</span> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
