"use client";

/**
 * The in-event scenario board: a category rail beside two clearly separated
 * lists.
 *
 * The split is the point. Unsolved scenarios carry a status and an assignee
 * because the team still has work to coordinate on them; solved ones carry
 * neither, because there is nothing left to plan. Mixing the two into one list
 * with a "solved" tag is what made the old page confusing.
 */

import { useMemo, useState } from "react";
import { ChevronDown, Check, Frown, Smile } from "lucide-react";

import { cn } from "@/lib/cn";
import { ChallengeProgressControl } from "@/components/ctf/challenge-progress-control";
import type { ChallengeProgress } from "@/lib/progress-api";
import type { CtfChallenge } from "@/types/ctf";

/** Header and rows share these templates, so the columns actually line up. */
const UNSOLVED_COLS = "minmax(0,1fr) 84px 108px 96px 76px";
const SOLVED_COLS = "minmax(0,1fr) 84px 108px";

export function ScenarioBoard({
  challenges,
  progressByChallenge,
  eventId,
  onOpen,
  headline,
}: {
  challenges: CtfChallenge[];
  progressByChallenge: Record<string, ChallengeProgress>;
  eventId?: string;
  onOpen: (c: CtfChallenge) => void;
  /** Optional stat strip rendered above the search box. */
  headline?: React.ReactNode;
}) {
  const [category, setCategory] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [showUnsolved, setShowUnsolved] = useState(true);
  const [showSolved, setShowSolved] = useState(true);

  // Per-category totals drive the rail's progress bar and its "all done" tick.
  const categories = useMemo(() => {
    const map = new Map<string, { total: number; solved: number }>();
    for (const c of challenges) {
      const e = map.get(c.category) ?? { total: 0, solved: 0 };
      e.total += 1;
      if (c.solved) e.solved += 1;
      map.set(c.category, e);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [challenges]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return challenges.filter(
      (c) =>
        (!category || c.category === category) &&
        (!needle ||
          c.title.toLowerCase().includes(needle) ||
          c.category.toLowerCase().includes(needle)),
    );
  }, [challenges, category, q]);

  const unsolved = visible.filter((c) => !c.solved);
  const solved = visible.filter((c) => c.solved);
  const scope = category ? `${category.toUpperCase()} ` : "";

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[212px_1fr]">
      <aside className="space-y-1.5">
        <RailItem
          label="All scenarios"
          total={challenges.length}
          solved={challenges.filter((c) => c.solved).length}
          active={category === null}
          onClick={() => setCategory(null)}
        />
        {categories.map(([name, { total, solved: s }]) => (
          <RailItem
            key={name}
            label={name}
            total={total}
            solved={s}
            active={category === name}
            onClick={() => setCategory(name)}
          />
        ))}
      </aside>

      <div className="min-w-0 space-y-4">
        {headline}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search scenarios by name or category…"
          className="edge-iridescent w-full rounded-xl glass px-3.5 py-2.5 text-[14px] text-text outline-none placeholder:text-text-faint focus:border-line-strong"
        />

        <Section
          tone="unsolved"
          open={showUnsolved}
          onToggle={() => setShowUnsolved((v) => !v)}
          count={unsolved.length}
          label={`${scope}SCENARIOS`}
          columns={["Points", "Difficulty", "Status", "Assignee"]}
          cols={UNSOLVED_COLS}
        >
          {unsolved.length === 0 ? (
            <Empty
              icon={<Smile className="h-6 w-6" />}
              title="Great job!"
              body="You have pwned all the scenarios."
            />
          ) : (
            unsolved.map((c) => (
              <Row key={c.id} cols={UNSOLVED_COLS}>
                <Name challenge={c} onOpen={onOpen} />
                <Cell>{c.points}</Cell>
                <Cell className="capitalize">{c.difficulty}</Cell>
                {/* Status and assignee live only here — a solved scenario has
                    nothing left to coordinate. */}
                <ChallengeProgressControl
                  eventId={eventId}
                  challengeId={c.id}
                  progress={progressByChallenge[c.id]}
                />
              </Row>
            ))
          )}
        </Section>

        <Section
          tone="solved"
          open={showSolved}
          onToggle={() => setShowSolved((v) => !v)}
          count={solved.length}
          label={`${scope}SCENARIOS`}
          columns={["Points", "Difficulty"]}
          cols={SOLVED_COLS}
        >
          {solved.length === 0 ? (
            <Empty
              icon={<Frown className="h-6 w-6" />}
              title="No scenarios solved yet."
              body="Start hacking!"
            />
          ) : (
            solved.map((c) => (
              <Row key={c.id} cols={SOLVED_COLS}>
                <Name challenge={c} onOpen={onOpen} />
                <Cell>{c.points}</Cell>
                <Cell className="capitalize">{c.difficulty}</Cell>
              </Row>
            ))
          )}
        </Section>
      </div>
    </div>
  );
}

function RailItem({
  label,
  total,
  solved,
  active,
  onClick,
}: {
  label: string;
  total: number;
  solved: number;
  active: boolean;
  onClick: () => void;
}) {
  const done = total > 0 && solved === total;
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full rounded-xl border px-3 py-2.5 text-left transition-colors",
        active
          ? "border-line-strong bg-surface-hover"
          : "border-transparent hover:bg-surface-hover/60",
      )}
    >
      <span className="flex items-center gap-1.5">
        <span
          className={cn(
            "truncate text-[13.5px] font-semibold capitalize",
            active ? "text-text" : "text-text-dim",
          )}
        >
          {label}
        </span>
        {done && <Check className="h-3.5 w-3.5 shrink-0 text-accent" />}
        <span className="ml-auto shrink-0 text-[11.5px] text-text-faint">
          {solved}/{total}
        </span>
      </span>
      <span className="mt-1.5 block h-1 bg-bg-elevated">
        <span
          className="block h-1 bg-accent transition-all"
          style={{ width: total ? `${(solved / total) * 100}%` : "0%" }}
        />
      </span>
    </button>
  );
}

function Section({
  tone,
  open,
  onToggle,
  count,
  label,
  columns,
  cols,
  children,
}: {
  tone: "unsolved" | "solved";
  open: boolean;
  onToggle: () => void;
  count: number;
  label: string;
  columns: string[];
  cols: string;
  children: React.ReactNode;
}) {
  return (
    // No overflow-hidden: the status and assignee menus open out of the rows and
    // would be clipped by it.
    <div className="edge-iridescent glass">
      <div
        className="grid items-center gap-x-4 border-b border-line px-4 py-2.5"
        style={{ gridTemplateColumns: cols }}
      >
        <span className="flex min-w-0 items-center gap-3">
          <button
            onClick={onToggle}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11.5px] font-bold uppercase tracking-wide",
              tone === "unsolved" ? "bg-warning text-black" : "bg-success text-black",
            )}
          >
            {tone}
            <ChevronDown
              className={cn("h-3.5 w-3.5 transition-transform", !open && "-rotate-90")}
            />
          </button>
          <span className="truncate text-[11.5px] font-semibold uppercase tracking-wide text-text-faint">
            {count} {label}
          </span>
        </span>
        {columns.map((c) => (
          <span
            key={c}
            className="hidden text-[11.5px] font-semibold uppercase tracking-wide text-text-faint sm:block"
          >
            {c}
          </span>
        ))}
      </div>
      {open && <div className="divide-y divide-line">{children}</div>}
    </div>
  );
}

function Row({ cols, children }: { cols: string; children: React.ReactNode }) {
  return (
    <div
      className="group relative grid items-center gap-x-4 px-4 py-2.5 transition-colors hover:bg-surface-hover"
      style={{ gridTemplateColumns: cols }}
    >
      {children}
    </div>
  );
}

function Name({
  challenge,
  onOpen,
}: {
  challenge: CtfChallenge;
  onOpen: (c: CtfChallenge) => void;
}) {
  return (
    <button onClick={() => onOpen(challenge)} className="min-w-0 truncate text-left">
      <span className="text-[14.5px] font-semibold text-text hover:text-accent">
        {challenge.title}
      </span>
      <span className="ml-2 text-[12px] text-text-faint">{challenge.solveCount} solves</span>
    </button>
  );
}

function Cell({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("hidden text-[13.5px] text-text-dim sm:block", className)}>{children}</span>
  );
}

function Empty({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="px-4 py-12 text-center text-text-faint">
      <span className="mx-auto mb-2.5 flex justify-center">{icon}</span>
      <p className="text-[14.5px] font-semibold text-text">{title}</p>
      <p className="mt-1 text-[13.5px] text-text-dim">{body}</p>
    </div>
  );
}
