"use client";

/**
 * Live event feed over WebSocket.
 *
 * The socket does not hold state of its own — it tells React Query which
 * caches are stale, so one code path renders whether data arrived by poll or by
 * push. Scope is decided server-side from the caller's participation, so this
 * only ever receives what the viewer is entitled to.
 */

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useAuthStore } from "@/stores/auth-store";

type LiveMessage = {
  type: string;
  challenge_id?: string;
};

/** Same-origin ws:///wss:// URL — /api is proxied to the gateway. */
function socketUrl(eventId: string, token: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/v1/ctf/events/${eventId}/live?token=${encodeURIComponent(token)}`;
}

export function useEventLive(eventId: string | undefined, slug: string) {
  const qc = useQueryClient();
  const token = useAuthStore((s) => s.accessToken);
  const retry = useRef(0);
  const closed = useRef(false);

  useEffect(() => {
    if (!eventId || !token) return;
    closed.current = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (closed.current) return;
      ws = new WebSocket(socketUrl(eventId, token));

      ws.onopen = () => {
        retry.current = 0;
      };

      ws.onmessage = (ev) => {
        let msg: LiveMessage;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        switch (msg.type) {
          case "chat":
          case "chat.edited":
          case "chat.deleted":
            qc.invalidateQueries({ queryKey: ["ctf-chat", eventId] });
            break;
          case "progress":
            qc.invalidateQueries({ queryKey: ["ctf-progress", eventId] });
            break;
          case "solve":
            qc.invalidateQueries({ queryKey: ["ctf-scoreboard", slug] });
            qc.invalidateQueries({ queryKey: ["ctf-challenges", slug] });
            break;
          case "announcement":
          case "event.started":
          case "event.ended":
            qc.invalidateQueries({ queryKey: ["ctf-event", slug] });
            qc.invalidateQueries({ queryKey: ["ctf-challenges", slug] });
            break;
          default:
            // heartbeat / idle / pong — the connection is alive, nothing to do.
            break;
        }
      };

      ws.onclose = () => {
        if (closed.current) return;
        // Back off so a server restart does not turn into a reconnect storm.
        const delay = Math.min(30_000, 1000 * 2 ** retry.current++);
        reconnectTimer = setTimeout(connect, delay);
      };

      ws.onerror = () => ws?.close();
    };

    connect();

    return () => {
      closed.current = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [eventId, token, slug, qc]);
}
