/** Shared input styling for the team forms (create dialog + settings tab). */
export const field =
  "h-10 w-full rounded-xl border border-line-strong bg-bg-elevated px-3.5 text-[14px] text-text placeholder:text-text-faint focus:border-accent focus:outline-none";

export const label = "mb-1.5 block text-[12px] font-semibold uppercase tracking-wide text-text-dim";

/** user-svc requires 3–32 chars of [a-z0-9-]. */
export function slugifyTeam(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}
