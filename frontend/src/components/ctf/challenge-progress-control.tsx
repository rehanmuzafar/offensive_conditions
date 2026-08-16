"use client";

/**
 * Status + assignment for one challenge, shared across the team.
 *
 * Both controls write the same row, so a teammate's browser sees the change on
 * its next poll. Names come from the team roster; ids are what the API wants.
 */

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, UserPlus, X } from "lucide-react";

import { useSetChallengeProgress } from "@/hooks/use-progress";
import {
  STATUS_LABEL,
  STATUS_STYLE,
  type ChallengeProgress,
  type ProgressStatus,
} from "@/lib/progress-api";
import { teamsApi, getUsername } from "@/lib/teams-api";
import { cn } from "@/lib/cn";

/** "untouched" is reachable through Clear, so it is not offered as a pick. */
const PICKABLE: ProgressStatus[] = ["in_progress", "need_help", "done"];

interface Mate {
  user_id: string;
  username: string;
}

export function ChallengeProgressControl({
  eventId,
  challengeId,
  progress,
}: {
  eventId: string | undefined;
  challengeId: string;
  progress?: ChallengeProgress;
}) {
  const set = useSetChallengeProgress(eventId);
  const [mates, setMates] = useState<Mate[]>([]);
  const status = progress?.status ?? "untouched";

  // The roster is only needed to turn ids into names and to offer assignees.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const teams = await teamsApi.listMine();
        if (!teams[0]) return;
        const members = await teamsApi.members(teams[0].id);
        const named = await Promise.all(
          members.map(async (m) => ({
            user_id: m.user_id,
            username: await getUsername(m.user_id),
          })),
        );
        if (!cancelled) setMates(named);
      } catch {
        /* roster is optional — the controls still work without names */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const assignee = mates.find((m) => m.user_id === progress?.assigned_to_user_id);
  const updater = mates.find((m) => m.user_id === progress?.updated_by_user_id);

  // A fragment, not a wrapper: the caller lays these out as two table columns.
  return (
    <>
      <StatusPicker
        status={status}
        pending={set.isPending}
        onPick={(s) => set.mutate({ challengeId, status: s })}
        onClear={() => set.mutate({ challengeId, status: "untouched" })}
        setBy={progress?.updated_by_user_id ? updater?.username : undefined}
      />
      <AssigneePicker
        mates={mates}
        assignee={assignee}
        assignedId={progress?.assigned_to_user_id ?? null}
        pending={set.isPending}
        onAssign={(m) => {
          set.mutate({ challengeId, assign_to_user_id: m.user_id });
          toast.success(`Assigned to ${m.username}`);
        }}
        onUnassign={() => set.mutate({ challengeId, unassign: true })}
      />
    </>
  );
}

/**
 * The status control: a coloured diamond that opens a short menu. Compact
 * because it sits in a table row — the row is the unit of scanning, so the
 * control must not out-weigh the scenario's name.
 */
function StatusPicker({
  status,
  pending,
  onPick,
  onClear,
  setBy,
}: {
  status: ProgressStatus;
  pending: boolean;
  onPick: (s: ProgressStatus) => void;
  onClear: () => void;
  setBy?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside<HTMLDivElement>(() => setOpen(false));

  return (
    <div ref={ref} className="relative">
      <button
        disabled={pending}
        onClick={() => setOpen((v) => !v)}
        title={setBy ? `${STATUS_LABEL[status]} — set by ${setBy}` : STATUS_LABEL[status]}
        className="flex items-center gap-1 rounded-lg border border-line-strong bg-bg-elevated px-2 py-1.5 hover:bg-surface-hover"
        aria-label={`Status: ${STATUS_LABEL[status]}`}
      >
        <Diamond status={status} />
        <ChevronDown className={cn("h-3.5 w-3.5 text-text-faint transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1.5 w-44 overflow-hidden rounded-xl border border-line bg-surface shadow-xl">
          {PICKABLE.map((s) => (
            <button
              key={s}
              onClick={() => {
                onPick(s);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[13.5px] text-text hover:bg-surface-hover"
            >
              <Diamond status={s} />
              {STATUS_LABEL[s]}
            </button>
          ))}
          {status !== "untouched" && (
            <button
              onClick={() => {
                onClear();
                setOpen(false);
              }}
              className="flex w-full items-center justify-between border-t border-line px-3 py-2.5 text-left text-[13px] text-text-faint hover:bg-surface-hover hover:text-text"
            >
              Clear status <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function AssigneePicker({
  mates,
  assignee,
  assignedId,
  pending,
  onAssign,
  onUnassign,
}: {
  mates: Mate[];
  assignee?: Mate;
  assignedId: string | null;
  pending: boolean;
  onAssign: (m: Mate) => void;
  onUnassign: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useClickOutside<HTMLDivElement>(() => setOpen(false));
  const shown = mates.filter((m) => m.username.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div ref={ref} className="relative">
      <button
        disabled={pending}
        onClick={() => setOpen((v) => !v)}
        title={assignee ? `Assigned to ${assignee.username}` : "Assign a teammate"}
        aria-label={assignee ? `Assigned to ${assignee.username}` : "Assign a teammate"}
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold",
          assignedId
            ? "bg-brand-gradient text-text-on-brand"
            : "border border-dashed border-line-strong text-text-faint hover:text-text",
        )}
      >
        {assignedId ? (
          (assignee?.username ?? "??").slice(0, 2).toUpperCase()
        ) : (
          <UserPlus className="h-3.5 w-3.5" />
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-1.5 w-56 overflow-hidden rounded-xl border border-line bg-surface shadow-xl">
          <p className="border-b border-line px-3 py-2.5 text-[12px] font-semibold uppercase tracking-wide text-text-dim">
            Assign team member
          </p>
          {mates.length === 0 ? (
            <p className="px-3 py-3 text-[12.5px] text-text-faint">
              Join a team to hand scenarios to teammates.
            </p>
          ) : (
            <>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search"
                className="w-full border-b border-line bg-transparent px-3 py-2 text-[13px] text-text outline-none placeholder:text-text-faint"
              />
              <div className="max-h-52 overflow-y-auto">
                {shown.map((m) => (
                  <button
                    key={m.user_id}
                    onClick={() => {
                      onAssign(m);
                      setOpen(false);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13.5px] text-text hover:bg-surface-hover"
                  >
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-gradient text-[10px] font-bold text-text-on-brand">
                      {m.username.slice(0, 2).toUpperCase()}
                    </span>
                    {m.username}
                  </button>
                ))}
              </div>
              {assignedId && (
                <button
                  onClick={() => {
                    onUnassign();
                    setOpen(false);
                  }}
                  className="flex w-full items-center justify-between border-t border-line px-3 py-2.5 text-[13px] text-text-faint hover:bg-surface-hover hover:text-danger"
                >
                  Unassign <X className="h-3.5 w-3.5" />
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Status reads as a colour first, a label second. */
function Diamond({ status }: { status: ProgressStatus }) {
  return (
    <span
      className={cn(
        "block h-2.5 w-2.5 rotate-45 rounded-[2px]",
        status === "untouched" && "border border-text-faint",
        status === "in_progress" && "bg-warning",
        status === "need_help" && "bg-danger",
        status === "done" && "bg-accent",
      )}
    />
  );
}

function useClickOutside<T extends HTMLElement>(onOutside: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  });
  return ref;
}

/** Compact badge for the challenge grid. */
export function ProgressBadge({ progress }: { progress?: ChallengeProgress }) {
  if (!progress || progress.status === "untouched") return null;
  return (
    <span
      className={cn(
        "rounded-md px-2 py-0.5 text-[11px] font-semibold",
        STATUS_STYLE[progress.status],
      )}
    >
      {STATUS_LABEL[progress.status]}
    </span>
  );
}
