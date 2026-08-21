"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Clock, Droplet, FileText, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { Avatar } from "@/components/ui/identity";
import { cn } from "@/lib/cn";
import { formatDate, formatNumber } from "@/lib/format";
import { fetchBlob } from "@/lib/api";
import { ctfAdminApi, type AdminCtfWriteup } from "@/lib/ctf-admin-api";

/**
 * Reading the writeups for one event.
 *
 * Every row carries the standing it belongs to — rank, points, first bloods —
 * because a writeup is judged against a result, and making the organiser look
 * that up separately is how two tabs end up disagreeing.
 *
 * The file is read here, not downloaded. Text and markdown are rendered as
 * themselves, a PDF goes in an embed, and a .docx is unzipped to text by the
 * service because nothing in a browser reads one. All of it is fetched with the
 * organiser's token: the endpoint checks the role on every request rather than
 * handing out a link that would outlive the check.
 */
export function CtfWriteupsPanel({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  const [reading, setReading] = useState<AdminCtfWriteup | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-ctf-writeups", eventId],
    queryFn: () => ctfAdminApi.listWriteups(eventId),
  });

  const items = data?.items ?? [];
  const eliminated = data?.eliminated ?? [];

  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Event writeups"
      onClick={onClose}
    >
      <div
        className="glass-strong edge-iridescent flex max-h-[88vh] w-full max-w-[860px] flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="font-display text-[16px] font-bold tracking-mega">Writeups</h2>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[12px] text-text-dim">
              {data?.required_top_n
                ? `Required from the top ${data.required_top_n}`
                : "Not required for this event"}
              {data?.deadline && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" /> due {formatDate(data.deadline)}
                </span>
              )}
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

        <div className="flex-1 overflow-y-auto p-3">
          {isLoading && (
            <p className="flex items-center justify-center gap-2 py-12 text-[13px] text-text-faint">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading writeups…
            </p>
          )}
          {isError && (
            <p className="py-12 text-center text-[13px] text-danger">
              Only the organiser can read the writeups for this event.
            </p>
          )}

          {!isLoading && items.length === 0 && (
            <p className="py-12 text-center text-[13px] text-text-dim">
              Nothing has been uploaded yet.
            </p>
          )}

          {items.map((w) => (
            <div
              key={w.id}
              className={cn(
                "mb-2 flex flex-wrap items-center gap-3 border px-4 py-3 last:mb-0",
                w.status === "submitted" ? "border-line-strong" : "border-line opacity-80",
              )}
            >
              <Avatar username={w.standing?.display_name ?? w.filename} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-[13.5px] text-text">
                    {w.standing?.display_name ?? "Unknown entry"}
                  </span>
                  {w.standing && (
                    <span className="shrink-0 text-[11px] text-text-faint">#{w.standing.rank}</span>
                  )}
                  {w.status === "draft" && (
                    <span className="bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-warning">
                      draft
                    </span>
                  )}
                </span>
                <span className="flex flex-wrap items-center gap-x-3 text-[11.5px] text-text-faint">
                  <span className="truncate">{w.filename}</span>
                  {w.standing && (
                    <>
                      <span>{formatNumber(w.standing.points)} pts</span>
                      {w.standing.first_bloods > 0 && (
                        <span className="flex items-center gap-1 text-danger">
                          <Droplet className="h-3 w-3" /> {w.standing.first_bloods}
                        </span>
                      )}
                    </>
                  )}
                  {w.submitted_at && <span>turned in {formatDate(w.submitted_at)}</span>}
                </span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => setReading(w)}>
                <FileText className="h-3.5 w-3.5" /> Read
              </Button>
            </div>
          ))}

          {eliminated.length > 0 && (
            <div className="mt-4 border border-danger/30 p-3">
              <p className="flex items-center gap-2 text-[12.5px] font-semibold text-danger">
                <AlertTriangle className="h-3.5 w-3.5" />
                Eliminated — owed a writeup and did not turn one in
              </p>
              <ul className="mt-2 space-y-1">
                {eliminated.map((e) => (
                  <li
                    key={e.team_id ?? e.user_id ?? e.display_name}
                    className="flex items-center justify-between text-[12.5px] text-text-dim"
                  >
                    <span>
                      #{e.rank} {e.display_name}
                    </span>
                    <span className="tabular-nums">{formatNumber(e.points)} pts</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {reading && (
        <WriteupReader eventId={eventId} writeup={reading} onClose={() => setReading(null)} />
      )}
    </div>
  );
}

function WriteupReader({
  eventId,
  writeup,
  onClose,
}: {
  eventId: string;
  writeup: AdminCtfWriteup;
  onClose: () => void;
}) {
  const [state, setState] = useState<
    { status: "loading" } | { status: "error" } | { status: "ready"; kind: string; url?: string; text?: string }
  >({ status: "loading" });

  useEffect(() => {
    let objectUrl: string | undefined;
    let cancelled = false;

    fetchBlob(`/v1/ctf/events/${eventId}/writeups/${writeup.id}/content`)
      .then(async ({ blob, kind }) => {
        if (cancelled) return;
        if (kind === "pdf") {
          objectUrl = URL.createObjectURL(blob);
          setState({ status: "ready", kind, url: objectUrl });
        } else {
          setState({ status: "ready", kind, text: await blob.text() });
        }
      })
      .catch(() => !cancelled && setState({ status: "error" }));

    return () => {
      cancelled = true;
      // Object URLs hold the blob in memory until they are revoked.
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [eventId, writeup.id]);

  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-black/80 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={writeup.filename}
      onClick={onClose}
    >
      <div
        className="glass-strong edge-iridescent flex h-[86vh] w-full max-w-[900px] flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-3.5">
          <div className="min-w-0">
            <p className="truncate font-display text-[14.5px] font-bold text-text">
              {writeup.standing?.display_name ?? writeup.filename}
            </p>
            <p className="truncate text-[11.5px] text-text-faint">{writeup.filename}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 shrink-0 place-items-center border border-line text-text-faint transition-colors hover:border-line-strong hover:text-text"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {state.status === "loading" && (
            <p className="flex items-center justify-center gap-2 py-16 text-[13px] text-text-faint">
              <Loader2 className="h-4 w-4 animate-spin" /> Opening…
            </p>
          )}
          {state.status === "error" && (
            <p className="py-16 text-center text-[13px] text-danger">
              Could not open that file.
            </p>
          )}
          {state.status === "ready" && state.kind === "pdf" && (
            <iframe src={state.url} title={writeup.filename} className="h-full w-full border-0" />
          )}
          {state.status === "ready" && state.kind === "markdown" && (
            <div className="prose-reading p-6">
              <Markdown>{state.text ?? ""}</Markdown>
            </div>
          )}
          {state.status === "ready" && state.kind === "text" && (
            <pre className="whitespace-pre-wrap p-6 font-mono text-[12.5px] leading-relaxed text-text-dim">
              {state.text}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
