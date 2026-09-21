/**
 * Featured lists — what the marketing surfaces show, curated in the admin panel.
 *
 * The GET is anonymous (the public pages read it, server-side and client-side);
 * the PUT is staff-only and replaces the whole ordered list for one surface.
 */

import { api } from "@/lib/api";

export type FeaturedSurface = "landing_machines" | "labs_page" | "ctf_page";

export interface FeaturedItem {
  item_type: string;
  item_id: string;
  rank: number;
}

export interface FeaturedList {
  surface: string;
  items: FeaturedItem[];
}

export const featuredApi = {
  get: (surface: FeaturedSurface) =>
    api.get<FeaturedList>("/v1/content/featured", { params: { surface }, anonymous: true }),
  set: (surface: FeaturedSurface, itemType: string, items: string[]) =>
    api.put<FeaturedList>("/v1/content/featured", {
      params: { surface },
      body: { item_type: itemType, items },
    }),
};
