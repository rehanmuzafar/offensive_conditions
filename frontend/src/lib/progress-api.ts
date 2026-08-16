/**
 * Per-team challenge progress and assignment (ctf-svc).
 *
 * Rows are keyed by participant, so on a team event everyone on the team reads
 * and writes the same state — that is the whole point: it stops five people
 * working the same challenge.
 */

import { api } from "@/lib/api";

export type ProgressStatus = "untouched" | "in_progress" | "need_help" | "done";

export interface ChallengeProgress {
  challenge_id: string;
  status: ProgressStatus;
  note: string | null;
  assigned_to_user_id: string | null;
  assigned_by_user_id: string | null;
  updated_by_user_id: string | null;
  updated_at: string;
}

export interface ProgressUpdate {
  status?: ProgressStatus;
  note?: string;
  assign_to_user_id?: string;
  unassign?: boolean;
}

export const STATUS_LABEL: Record<ProgressStatus, string> = {
  untouched: "Untouched",
  in_progress: "In progress",
  need_help: "Need help",
  done: "Done",
};

/** Status is also spelled out in text, so colour is never the only signal. */
export const STATUS_STYLE: Record<ProgressStatus, string> = {
  untouched: "bg-surface-hover text-text-faint",
  in_progress: "bg-info/12 text-info",
  need_help: "bg-warning/12 text-warning",
  done: "bg-success/12 text-success",
};

export const progressApi = {
  list: (eventId: string) => api.get<ChallengeProgress[]>(`/v1/ctf/events/${eventId}/progress`),

  set: (eventId: string, challengeId: string, body: ProgressUpdate) =>
    api.put<ChallengeProgress>(`/v1/ctf/events/${eventId}/progress/${challengeId}`, { body }),
};
