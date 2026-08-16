/** Team chat for a CTF event (ctf-svc). */

import { api } from "@/lib/api";

export interface ChatMessage {
  id: string;
  user_id: string;
  username: string;
  body: string;
  edited: boolean;
  deleted: boolean;
  created_at: string;
}

export const chatApi = {
  /** Oldest-first, newest page. */
  list: (eventId: string, limit = 50) =>
    api.get<ChatMessage[]>(`/v1/ctf/events/${eventId}/chat`, { params: { limit } }),

  send: (eventId: string, body: string) =>
    api.post<ChatMessage>(`/v1/ctf/events/${eventId}/chat`, { body: { body } }),

  remove: (eventId: string, messageId: string) =>
    api.delete<ChatMessage>(`/v1/ctf/events/${eventId}/chat/${messageId}`),
};
