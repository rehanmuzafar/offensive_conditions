"use client";

import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock, FileText, Loader2, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";
import { ctfApi } from "@/lib/community-api";

/**
 * The captain's writeup for one event.
 *
 * Two states with a hard line between them. A **draft** is the captain's to
 * change: replace it, delete it, upload again — mistakes are found late and
 * re-doing one should not need an organiser. **Turning it in** is the act the
 * deadline measures, and after it nothing can be swapped, because a file that
 * can still change makes a deadline meaningless.
 *
 * The deadline matters enough to sit on screen the whole time: missing it does
 * not lose marks, it eliminates the team from the board.
 */
export function WriteupSubmitDialog({ slug, onClose }: { slug: string; onClose: () => void }) {
  const qc = useQueryClient();
  const key = ["ctf-my-writeup", slug];
  const fileInput = useRef<HTMLInputElement>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data, isLoading, isError } = useQuery({ queryKey: key, queryFn: () => ctfApi.myWriteup(slug) });
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  const upload = useMutation({
    mutationFn: (file: File) => ctfApi.uploadWriteup(slug, file),
    onSuccess: () => {
      toast.success("Writeup uploaded.");
      refresh();
    },
    onError: (e: unknown) => toast.error(msg(e, "Could not upload that file.")),
  });

  const remove = useMutation({
    mutationFn: () => ctfApi.deleteWriteup(slug),
    onSuccess: () => {
      toast.success("Draft removed.");
      setConfirmDelete(false);
      refresh();
    },
    onError: (e: unknown) => toast.error(msg(e, "Could not remove the draft.")),
  });

  const turnIn = useMutation({
    mutationFn: () => ctfApi.turnInWriteup(slug),
    onSuccess: () => {
      toast.success("Writeup turned in.");
      refresh();
    },
    onError: (e: unknown) => toast.error(msg(e, "Could not turn it in.")),
  });

  const writeup = data?.writeup ?? null;
  const submitted = writeup?.status === "submitted";
  const deadline = data?.deadline ? new Date(data.deadline) : null;
  const overdue = Boolean(deadline && Date.now() > deadline.getTime());
  const allowed = data?.allowedExtensions ?? [".pdf", ".docx", ".md", ".txt"];

  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Submit writeup"
      onClick={onClose}
    >
      <div
        className="glass-strong edge-iridescent w-full max-w-[520px]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="font-display text-[16px] font-bold tracking-mega">Team writeup</h2>
            <p className="mt-0.5 text-[12px] text-text-dim">
              {data?.requiredTopN
                ? `Required from the top ${data.requiredTopN} teams.`
                : "Optional for this event."}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 shrink-0 place-items-center border border-line text-text-faint transition-colors hover:border-line-strong hover:text-text"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {deadline && (
          <p
            className={cn(
              "flex items-center gap-2 border-b border-line px-5 py-3 text-[12.5px]",
              overdue ? "bg-danger/8 text-danger" : "text-text-dim",
            )}
          >
            <Clock className="h-3.5 w-3.5 shrink-0" />
            {overdue ? "The deadline passed on " : "Due by "}
            <b className={overdue ? "" : "text-text"}>{formatDate(deadline.toISOString())}</b>
            {overdue && !submitted && " — teams that owed one are out of the standings."}
          </p>
        )}

        <div className="p-5">
          {isLoading && (
            <p className="flex items-center justify-center gap-2 py-8 text-[13px] text-text-faint">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </p>
          )}
          {isError && (
            <p className="py-8 text-center text-[13px] text-danger">
              Only a registered captain can manage the team writeup.
            </p>
          )}

          {!isLoading && !isError && (
            <>
              {writeup ? (
                <div
                  className={cn(
                    "flex items-center gap-3 border px-4 py-3.5",
                    submitted ? "border-success/40 bg-success/5" : "border-line",
                  )}
                >
                  <FileText className="h-5 w-5 shrink-0 text-text-faint" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] text-text">{writeup.filename}</span>
                    <span className="text-[11.5px] text-text-faint">
                      {(writeup.sizeBytes / 1024).toFixed(0)} KB ·{" "}
                      {submitted ? (
                        <span className="text-success">
                          turned in {writeup.submittedAt ? formatDate(writeup.submittedAt) : ""}
                        </span>
                      ) : (
                        "draft — not turned in yet"
                      )}
                    </span>
                  </span>
                  {submitted && <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />}
                </div>
              ) : (
                <p className="border border-dashed border-line px-4 py-8 text-center text-[13px] text-text-dim">
                  No writeup uploaded yet.
                </p>
              )}

              <p className="mt-3 text-[11.5px] text-text-faint">
                Accepted: {allowed.join(", ")} · up to 25 MB
              </p>

              {/* A turned-in writeup is final — the controls go away rather than
                  sitting there disabled, so there is nothing to argue with. */}
              {!submitted && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <input
                    ref={fileInput}
                    type="file"
                    accept={allowed.join(",")}
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) upload.mutate(file);
                      e.target.value = "";
                    }}
                  />
                  <Button loading={upload.isPending} onClick={() => fileInput.current?.click()}>
                    <Upload className="h-4 w-4" /> {writeup ? "Replace" : "Upload"}
                  </Button>

                  {writeup && (
                    <>
                      <Button
                        variant="ghost"
                        loading={remove.isPending}
                        onClick={() => {
                          if (!confirmDelete) return setConfirmDelete(true);
                          remove.mutate();
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                        {confirmDelete ? "Remove it?" : "Remove"}
                      </Button>
                      <Button
                        className="ml-auto"
                        loading={turnIn.isPending}
                        disabled={overdue}
                        onClick={() => turnIn.mutate()}
                      >
                        <CheckCircle2 className="h-4 w-4" /> Turn in
                      </Button>
                    </>
                  )}
                </div>
              )}

              {writeup && !submitted && (
                <p className="mt-3 text-[11.5px] text-text-faint">
                  Turning in is final — you cannot replace it afterwards.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function msg(e: unknown, fallback: string): string {
  const m = (e as { message?: string } | null)?.message;
  return m && m.length < 200 ? m : fallback;
}
