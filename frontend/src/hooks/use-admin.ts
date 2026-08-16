"use client";

/**
 * Admin hooks — live API with mock fallback (same pattern as other modules).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { adminApi } from "@/lib/admin-api";
import {
  MOCK_OVERVIEW,
  mockAdminMachines,
  mockReportQueue,
  mockAdminUsers,
  MOCK_FLAGGED,
  MOCK_BROADCASTS,
} from "@/lib/mock-admin";
import type { ReportState } from "@/types/bounty";
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

export function useReportQueue(state?: string) {
  return useQuery({ queryKey: ["admin-reports", state], queryFn: () => withMock(() => adminApi.reportQueue(state), mockReportQueue) });
}
export function useTransitionReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, toState, reason }: { id: string; toState: ReportState; reason?: string }) =>
      adminApi.transitionReport(id, toState, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-reports"] });
      toast.success("Report updated");
    },
    onError: () => toast.error("Couldn't update the report"),
  });
}
export function useAwardBounty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, amountCents }: { id: string; amountCents: number }) => adminApi.awardBounty(id, amountCents),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-reports"] });
      toast.success("Bounty awarded");
    },
    onError: () => toast.error("Couldn't award the bounty"),
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
