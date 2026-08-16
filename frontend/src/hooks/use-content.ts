"use client";

/**
 * Data hooks for machines, instances, dashboard, leaderboard.
 *
 * Each uses React Query against the live API, but falls back to mock seed data
 * if the request fails (so the UI is fully navigable during the build-then-wire
 * workflow). Once the gateway is live, the mock branch never runs.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { contentApi, labApi, trackApi, type MachineQuery } from "@/lib/content-api";
import { scoringApi, type LeaderboardQuery } from "@/lib/scoring-api";
import { MOCK_INSTANCES, MOCK_DASHBOARD } from "@/lib/mock-data";

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

/* --------------------------------- machines --------------------------------- */
export function useMachines(query: MachineQuery) {
  return useQuery({
    queryKey: ["machines", query],
    queryFn: () => contentApi.listMachines(query),
  });
}

export function useMachine(slug: string) {
  return useQuery({
    queryKey: ["machine", slug],
    queryFn: () => contentApi.getMachine(slug),
    enabled: Boolean(slug),
  });
}

export function useDashboard() {
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: () => withMock(() => contentApi.getDashboard(), () => MOCK_DASHBOARD),
  });
}

/* --------------------------------- instances -------------------------------- */
export function useInstances() {
  return useQuery({
    queryKey: ["instances"],
    queryFn: () => withMock(() => labApi.listInstances(), () => MOCK_INSTANCES),
    // While something is provisioning we want fresh state; poll lightly.
    refetchInterval: (q) => {
      const data = q.state.data;
      const busy = data?.some((i) => i.state === "provisioning" || i.state === "queued" || i.state === "stopping");
      return busy ? 3000 : false;
    },
  });
}

export function useSpawnInstance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (machineId: string) => labApi.spawn(machineId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["instances"] });
      toast.success("Spawning your machine…");
    },
    onError: () => toast.error("Couldn't spawn the machine. Try again."),
  });
}

export function useStopInstance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => labApi.stop(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["instances"] });
      toast.success("Machine stopped.");
    },
    onError: () => toast.error("Couldn't stop the machine."),
  });
}

export function useExtendInstance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => labApi.extend(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["instances"] });
      toast.success("Extended by 1 hour.");
    },
    onError: () => toast.error("Couldn't extend the instance."),
  });
}

export function useResetInstance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => labApi.reset(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["instances"] });
      toast.success("Resetting machine to a clean state…");
    },
    onError: () => toast.error("Couldn't reset the machine."),
  });
}

export function useSubmitFlag(machineId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ flag, kind }: { flag: string; kind: "user" | "root" }) =>
      labApi.submitFlag(machineId, flag, kind),
    onSuccess: (res) => {
      if (!res.accepted) {
        toast.error("Incorrect flag. Keep digging.");
        return;
      }
      if (res.alreadyOwned) {
        toast.info("You already own this flag.");
        return;
      }
      qc.invalidateQueries({ queryKey: ["machine"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      const blood = res.firstBlood ? " 🩸 First blood!" : "";
      toast.success(`${res.kind === "root" ? "Root" : "User"} flag accepted · +${res.pointsAwarded} pts${blood}`);
    },
    onError: () => toast.error("Couldn't submit the flag. Try again."),
  });
}

/* ---------------------------------- tracks ---------------------------------- */
export function useTracks() {
  return useQuery({
    queryKey: ["tracks"],
    queryFn: () => trackApi.list(),
  });
}

export function useTrack(slug: string) {
  return useQuery({
    queryKey: ["track", slug],
    queryFn: () => trackApi.get(slug),
    enabled: Boolean(slug),
  });
}

/* -------------------------------- leaderboard ------------------------------- */
export function useLeaderboard(query: LeaderboardQuery) {
  return useQuery({
    queryKey: ["leaderboard", query],
    queryFn: () => scoringApi.leaderboard(query),
  });
}

export function useSeasons() {
  return useQuery({
    queryKey: ["seasons"],
    queryFn: () => scoringApi.seasons(),
  });
}

export function useHallOfFame() {
  return useQuery({
    queryKey: ["hall-of-fame"],
    queryFn: () => scoringApi.hallOfFame(),
  });
}
