import { api } from "@/lib/api";

/**
 * Upload an avatar (team or profile) and get back its URL.
 *
 * Separate from `uploadBanner` because that route is gated on the
 * content_creator role — a team captain is an ordinary player.
 */
export async function uploadAvatar(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  // rawBody so the browser sets the multipart boundary itself.
  const res = await api.post<{ url: string }>("/v1/media/avatar", { rawBody: form });
  return res.url;
}
