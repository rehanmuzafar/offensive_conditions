/**
 * Cross-surface links.
 *
 * The platform is served from four hostnames (see `middleware.ts`). A bare
 * `<Link href="/machines">` resolves against whichever host the visitor is on,
 * so on `ctf.offensiveconditions.org` it would try `ctf.…/machines` — which the
 * middleware rewrites to `/ctf/machines` and which does not exist.
 *
 * Any link that crosses from one surface to another must therefore be absolute.
 * Links *within* a surface stay relative and keep client-side navigation.
 *
 * In development everything is one host, so these all return plain paths and
 * navigation stays client-side there too.
 */

export type Surface = "landing" | "dashboard" | "ctf" | "bugbounty" | "app" | "admin";

/**
 * Root domain the four hosts hang off. Empty in development, which is what
 * collapses the four surfaces back into one origin.
 */
const ROOT = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "";

const HOSTS: Record<Surface, string> = {
  landing: ROOT,
  dashboard: ROOT && `dashboard.${ROOT}`,
  admin: ROOT && `admin.${ROOT}`,
  ctf: ROOT && `ctf.${ROOT}`,
  bugbounty: ROOT && `bugbounty.${ROOT}`,
  app: ROOT && `app.${ROOT}`,
};

/** Paths a surface owns, expressed as they appear on that surface's host. */
const STRIP: Record<Surface, string> = {
  landing: "",
  dashboard: "/dashboard",
  admin: "/admin",
  ctf: "/ctf",
  bugbounty: "/bounty",
  app: "",
};

/**
 * A link to `path` on `surface`.
 *
 * `path` is written the way the route tree has it — `/ctf/summer-2026`,
 * `/bounty/programs` — and the prefix is stripped when it becomes the root of
 * its own host.
 */
export function link(surface: Surface, path = "/"): string {
  const host = HOSTS[surface];
  const local = strip(surface, path);
  if (!host) return local || "/";
  const scheme = ROOT.startsWith("localhost") ? "http" : "https";
  return `${scheme}://${host}${local}`;
}

function strip(surface: Surface, path: string): string {
  const prefix = STRIP[surface];
  if (!prefix || !path.startsWith(prefix)) return path;
  const rest = path.slice(prefix.length);
  return rest.startsWith("/") ? rest : `/${rest}` === "/" ? "" : rest;
}

/** True when the four surfaces are collapsed onto one origin (development). */
export const singleOrigin = ROOT === "";

export const surfaceLinks = {
  landing: (path = "/") => link("landing", path),
  dashboard: (path = "/dashboard") => link("dashboard", path),
  admin: (path = "/admin") => link("admin", path),
  ctf: (path = "/ctf") => link("ctf", path),
  bugbounty: (path = "/bounty") => link("bugbounty", path),
  app: (path = "/machines") => link("app", path),
};
