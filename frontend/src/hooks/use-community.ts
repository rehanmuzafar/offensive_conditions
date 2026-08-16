"use client";

/**
 * Hooks for CTF, forum, and writeups. Live API with mock fallback, same
 * pattern as use-content.ts.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { ctfApi, forumApi, writeupApi, type ThreadQuery, type WriteupQuery } from "@/lib/community-api";
import {
  mockCtfEvents,
  mockCtfEvent,
  MOCK_CHALLENGES,
  mockScoreboard,
  MOCK_CATEGORIES,
  mockThreads,
  mockThread,
  mockPosts,
  mockWriteups,
  mockWriteupDetail,
} from "@/lib/mock-community";

/**
 * Live API only — the mock fallback is intentionally disabled.
 *
 * Serving seed data when a request fails hides backend outages behind
 * plausible-looking content, which on a scoring platform means users could see
 * fabricated machines or standings. Errors now propagate to React Query so the
 * UI shows a real error state. `fallback` is kept in the signature so the call
 * sites stay unchanged, but it is never invoked.
 */
async function withMock<T>(fn: () => Promise<T>, _fallback: () => T): Promise<T> {
  return fn();
}

/* ---------------------------------- CTF ----------------------------------- */
export function useCtfEvents(state?: string) {
  return useQuery({
    queryKey: ["ctf-events", state],
    queryFn: () => withMock(() => ctfApi.listEvents(state), mockCtfEvents),
  });
}
export function useCtfEvent(slug: string) {
  return useQuery({
    queryKey: ["ctf-event", slug],
    queryFn: () => withMock(() => ctfApi.getEvent(slug), () => mockCtfEvent(slug)),
    enabled: Boolean(slug),
  });
}
export function useCtfChallenges(slug: string) {
  return useQuery({
    queryKey: ["ctf-challenges", slug],
    queryFn: () => withMock(() => ctfApi.listChallenges(slug), () => MOCK_CHALLENGES),
    enabled: Boolean(slug),
  });
}
export function useScoreboard(slug: string) {
  return useQuery({
    queryKey: ["ctf-scoreboard", slug],
    queryFn: () => withMock(() => ctfApi.scoreboard(slug), mockScoreboard),
    enabled: Boolean(slug),
    // live scoreboard refresh
    refetchInterval: 15000,
  });
}
export function useCtfRegister(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (teamId?: string) => ctfApi.register(slug, teamId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ctf-event", slug] });
      toast.success("You're registered — good luck!");
    },
    // The service explains exactly why (window closed, teams only, already
    // registered, payment pending). Swallowing that left users guessing.
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Couldn't register. Try again."),
  });
}
export function useSubmitChallengeFlag(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ challengeId, flag }: { challengeId: string; flag: string }) =>
      ctfApi.submitFlag(slug, challengeId, flag),
    onSuccess: (res) => {
      if (!res.correct) {
        toast.error("Incorrect flag. Keep at it.");
        return;
      }
      if (res.alreadySolved) {
        toast.info("Already solved.");
        return;
      }
      qc.invalidateQueries({ queryKey: ["ctf-challenges", slug] });
      qc.invalidateQueries({ queryKey: ["ctf-scoreboard", slug] });
      const blood = res.firstBlood ? " 🩸 First blood!" : "";
      toast.success(`Correct! +${res.pointsAwarded} pts${blood}`);
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Couldn't submit. Try again."),
  });
}

/* --------------------------------- forum ---------------------------------- */
export function useForumCategories() {
  return useQuery({
    queryKey: ["forum-categories"],
    queryFn: () => withMock(() => forumApi.categories(), () => MOCK_CATEGORIES),
  });
}
export function useThreads(query: ThreadQuery) {
  return useQuery({
    queryKey: ["forum-threads", query],
    queryFn: () => withMock(() => forumApi.listThreads(query), mockThreads),
  });
}
export function useThread(id: string) {
  return useQuery({
    queryKey: ["forum-thread", id],
    queryFn: () => withMock(() => forumApi.getThread(id), () => mockThread(id)),
    enabled: Boolean(id),
  });
}
export function useThreadPosts(threadId: string) {
  return useQuery({
    queryKey: ["forum-posts", threadId],
    queryFn: () => withMock(() => forumApi.listPosts(threadId), () => mockPosts(threadId)),
    enabled: Boolean(threadId),
  });
}
export function useReply(threadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (bodyMd: string) => forumApi.reply(threadId, bodyMd),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["forum-posts", threadId] });
      toast.success("Reply posted");
    },
    onError: () => toast.error("Couldn't post your reply."),
  });
}
export function useCreateThread() {
  return useMutation({
    mutationFn: (body: { title: string; categorySlug: string; bodyMd: string; tags: string[] }) =>
      forumApi.createThread(body),
    onError: () => toast.error("Couldn't create the thread."),
  });
}

/* -------------------------------- writeups -------------------------------- */
export function useWriteups(query: WriteupQuery) {
  return useQuery({
    queryKey: ["writeups", query],
    queryFn: () => withMock(() => writeupApi.list(query), mockWriteups),
  });
}
export function useWriteup(slug: string) {
  return useQuery({
    queryKey: ["writeup", slug],
    queryFn: () => withMock(() => writeupApi.get(slug), () => mockWriteupDetail(slug)),
    enabled: Boolean(slug),
  });
}
export function usePublishWriteup() {
  return useMutation({
    mutationFn: (body: { title: string; targetSlug: string; bodyMd: string; tags: string[] }) =>
      writeupApi.publish(body),
    onError: () => toast.error("Couldn't publish the writeup."),
  });
}

/** The viewer's own rank, points and flags inside one event. */
export function useMyParticipation(eventId: string | undefined) {
  return useQuery({
    queryKey: ["ctf-my-participation", eventId],
    enabled: Boolean(eventId),
    retry: false,
    queryFn: () => ctfApi.myParticipation(eventId as string),
  });
}
