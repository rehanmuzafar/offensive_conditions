"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { progressApi, type ProgressUpdate } from "@/lib/progress-api";

/** Team-wide progress for one event. Skipped until the event id is known. */
export function useChallengeProgress(eventId: string | undefined) {
  return useQuery({
    queryKey: ["ctf-progress", eventId],
    queryFn: () => progressApi.list(eventId as string),
    enabled: Boolean(eventId),
    // The websocket pushes changes; this is only a safety net for a dropped
    // connection, so it can be slow.
    refetchInterval: 60_000,
  });
}

export function useSetChallengeProgress(eventId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ challengeId, ...body }: ProgressUpdate & { challengeId: string }) =>
      progressApi.set(eventId as string, challengeId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ctf-progress", eventId] }),
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Couldn't update that."),
  });
}
