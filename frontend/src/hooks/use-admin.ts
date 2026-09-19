"use client";

/**
 * Admin hooks — live API with mock fallback (same pattern as other modules).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { adminApi, mapQueueItem } from "@/lib/admin-api";
import {
  MOCK_OVERVIEW,
  mockAdminMachines,
  mockAdminUsers,
  MOCK_FLAGGED,
  MOCK_BROADCASTS,
} from "@/lib/mock-admin";
import type { Severity } from "@/types/bounty";
import type { Broadcast } from "@/types/admin";

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

export function useAdminOverview() {
  return useQuery({ queryKey: ["admin-overview"], queryFn: () => withMock(() => adminApi.overview(), () => MOCK_OVERVIEW) });
}

export function useAdminMachines(q?: string) {
  return useQuery({ queryKey: ["admin-machines", q], queryFn: () => withMock(() => adminApi.machines(q), mockAdminMachines) });
}
export function useSetMachineStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => adminApi.setMachineStatus(id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-machines"] });
      toast.success("Machine status updated");
    },
    onError: () => toast.error("Couldn't update status"),
  });
}

export function useReportQueue(params: { state?: string; severity?: string; program?: string } = {}) {
  return useQuery({
    queryKey: ["admin-reports", params],
    queryFn: async () => {
      const res = await adminApi.reportQueue(params);
      return (res.items ?? []).map(mapQueueItem);
    },
  });
}

/**
 * Triage decisions.
 *
 * One mutation per decision rather than a generic `transition(state)`, because
 * that is the shape bounty-svc actually has: each verb takes different required
 * data, and the state machine rejects moves that skip a step — a report must be
 * claimed (`triage`) before it can be accepted or rejected.
 */
export function useTriageReport() {
  const qc = useQueryClient();
  const done = (msg: string) => {
    qc.invalidateQueries({ queryKey: ["admin-reports"] });
    qc.invalidateQueries({ queryKey: ["admin-report"] });
    toast.success(msg);
  };
  const fail = (err: unknown) =>
    toast.error(err instanceof Error ? err.message : "Couldn't update the report");

  return {
    claim: useMutation({
      mutationFn: (id: string) => adminApi.startTriage(id),
      onSuccess: () => done("Report claimed"),
      onError: fail,
    }),
    accept: useMutation({
      mutationFn: ({ id, ...body }: { id: string; severity: Severity; cvss_score?: number | null; internal_notes?: string | null }) =>
        adminApi.acceptReport(id, body),
      onSuccess: () => done("Report accepted"),
      onError: fail,
    }),
    reject: useMutation({
      mutationFn: ({ id, reason }: { id: string; reason: string }) => adminApi.rejectReport(id, reason),
      onSuccess: () => done("Report rejected"),
      onError: fail,
    }),
    duplicate: useMutation({
      mutationFn: ({ id, duplicateOfId, reason }: { id: string; duplicateOfId: string; reason?: string }) =>
        adminApi.duplicateReport(id, duplicateOfId, reason),
      onSuccess: () => done("Marked as duplicate"),
      onError: fail,
    }),
    resolve: useMutation({
      mutationFn: ({ id, note }: { id: string; note?: string }) => adminApi.resolveReport(id, note),
      onSuccess: () => done("Report resolved"),
      onError: fail,
    }),
  };
}

export function useAwardBounty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, amountCents, initiatePayout }: { id: string; amountCents: number; initiatePayout?: boolean }) =>
      adminApi.awardBounty(id, amountCents, { initiatePayout }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-reports"] });
      qc.invalidateQueries({ queryKey: ["admin-report"] });
      toast.success("Bounty awarded");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Couldn't award the bounty"),
  });
}

export function useAdminUsers(q?: string) {
  return useQuery({ queryKey: ["admin-users", q], queryFn: () => withMock(() => adminApi.users(q), mockAdminUsers) });
}
export function useSetUserStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => adminApi.setUserStatus(id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      toast.success("User status updated");
    },
    onError: () => toast.error("Couldn't update user"),
  });
}

export function useFlaggedContent() {
  return useQuery({ queryKey: ["flagged"], queryFn: () => withMock(() => adminApi.flaggedContent(), () => MOCK_FLAGGED) });
}
export function useModerate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "remove" | "lock" }) => adminApi.moderate(id, action),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["flagged"] });
      toast.success("Content moderated");
    },
    onError: () => toast.error("Couldn't moderate"),
  });
}

export function useBroadcasts() {
  return useQuery({ queryKey: ["broadcasts"], queryFn: () => withMock(() => adminApi.broadcasts(), () => MOCK_BROADCASTS) });
}
export function useCreateBroadcast() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Omit<Broadcast, "id" | "status" | "sentAt" | "recipientCount">) => adminApi.createBroadcast(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["broadcasts"] });
      toast.success("Broadcast created");
    },
    onError: () => toast.error("Couldn't create broadcast"),
  });
}
