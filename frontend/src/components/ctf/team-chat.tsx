"use client";

/**
 * Team chat panel.
 *
 * Messages arrive over the team websocket channel; this only refetches when
 * told to, so there is no polling loop behind an open panel.
 */

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, MessageSquare, Send, Trash2, X } from "lucide-react";

import { chatApi } from "@/lib/chat-api";
import { useAuthStore } from "@/stores/auth-store";
import { cn } from "@/lib/cn";

/**
 * Chat without the floating-window chrome, for the arena's right rail.
 * The widget below wraps this; both share one query cache.
 */
export function InlineTeamChat({ eventId, enabled = true }: { eventId: string; enabled?: boolean }) {
  const open = enabled;
  const meId = useAuthStore((s) => s.user?.id ?? "");
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const bottom = useRef<HTMLDivElement>(null);

  const { data: messages, isLoading, error } = useQuery({
    queryKey: ["ctf-chat", eventId],
    queryFn: () => chatApi.list(eventId),
    enabled: open,
  });

  const send = useMutation({
    mutationFn: (body: string) => chatApi.send(eventId, body),
    onSuccess: () => {
      setDraft("");
      qc.invalidateQueries({ queryKey: ["ctf-chat", eventId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Message not sent"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => chatApi.remove(eventId, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ctf-chat", eventId] }),
  });

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {error ? (
          <p className="text-[13px] text-text-dim">
            {error instanceof Error ? error.message : "Chat unavailable."}
          </p>
        ) : isLoading ? (
          <p className="text-[13px] text-text-faint">Loading…</p>
        ) : (messages ?? []).length === 0 ? (
          <p className="text-[13px] text-text-faint">
            No messages yet. Say what you&apos;re working on so nobody doubles up.
          </p>
        ) : (
          (messages ?? []).map((m) => {
            const mine = m.user_id === meId;
            return (
              <div key={m.id} className={cn("flex flex-col", mine && "items-end")}>
                <div className="flex items-center gap-1.5">
                  <span className="text-[12px] font-semibold text-text-dim">{m.username}</span>
                  <span className="text-[11px] text-text-faint">
                    {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  {mine && !m.deleted && (
                    <button
                      onClick={() => remove.mutate(m.id)}
                      className="text-text-faint hover:text-danger"
                      aria-label="Delete message"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
                <p
                  className={cn(
                    "mt-0.5 max-w-[85%] rounded-xl px-3 py-2 text-[13.5px]",
                    m.deleted
                      ? "bg-surface-hover italic text-text-faint"
                      : mine
                        ? "bg-accent/12 text-text"
                        : "bg-bg-elevated text-text",
                  )}
                >
                  {m.deleted ? "message deleted" : m.body}
                  {m.edited && !m.deleted && (
                    <span className="ml-1.5 text-[11px] text-text-faint">edited</span>
                  )}
                </p>
              </div>
            );
          })
        )}
        <div ref={bottom} />
      </div>

      <form
        className="flex items-center gap-2 border-t border-line px-3 py-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          const text = draft.trim();
          if (text) send.mutate(text);
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Message your team…"
          maxLength={2000}
          className="h-9 flex-1 rounded-xl border border-line-strong bg-bg-elevated px-3 text-[13.5px] text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          disabled={send.isPending || !draft.trim()}
          className="grid h-9 w-9 place-items-center rounded-xl bg-brand-gradient text-text-on-brand disabled:opacity-40"
          aria-label="Send"
        >
          {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </form>
    </div>
  );
}

/** The floating widget, for pages that are not the arena. */
export function TeamChat({ eventId }: { eventId: string }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full bg-brand-gradient px-4 py-3 text-[14px] font-semibold text-text-on-brand shadow-glow"
      >
        <MessageSquare className="h-4 w-4" /> Team chat
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-40 flex h-[460px] w-[min(92vw,360px)] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card-lg">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <span className="flex items-center gap-2 font-display text-[15px] font-bold">
          <MessageSquare className="h-4 w-4 text-accent" /> Team chat
        </span>
        <button
          onClick={() => setOpen(false)}
          className="text-text-faint hover:text-text"
          aria-label="Close chat"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <InlineTeamChat eventId={eventId} />
      </div>
    </div>
  );
}
