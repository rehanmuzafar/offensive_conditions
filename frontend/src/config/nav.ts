/**
 * Central navigation + route map. Marketing nav, dashboard sidebar, and footer
 * all read from here so links stay consistent and are defined in one place.
 */

import type { LucideIcon } from "lucide-react";

import { link } from "@/lib/surfaces";
import {
  ShieldCheck,
  LayoutDashboard,
  Server,
  Flag,
  Route,
  Trophy,
  MessagesSquare,
  BookOpen,
  Target,
  Bell,
  CreditCard,
  Settings,
  ShieldAlert,
  Users,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon?: LucideIcon;
  /** requires authentication */
  auth?: boolean;
  /** requires one of these roles */
  roles?: string[];
  /** show a "new" pill */
  badge?: string;
}

/** Top marketing nav (logged-out landing/marketing pages). */
export const MARKETING_NAV: NavItem[] = [
  { label: "Machines", href: "/machines" },
  { label: "CTF", href: "/ctf" },
  { label: "Tracks", href: "/tracks" },
  { label: "Leaderboard", href: "/leaderboard" },
  { label: "Pricing", href: "/pricing" },
];

/** Authenticated app sidebar. */
/**
 * The signed-in sidebar.
 *
 * Entries that live on another surface are written with `link()` so they point
 * at that host directly. The middleware would redirect a bare `/ctf` to the CTF
 * host anyway, but making every sidebar click a redirect is a round trip the
 * user can feel — and `next/link` would prefetch a URL that only ever answers
 * with a 307.
 *
 * Settings, notifications and billing stay relative: they are shared across
 * every surface (see SHARED_PREFIXES in middleware.ts) and resolve wherever
 * you already are.
 */
export const APP_NAV: NavItem[] = [
  { label: "Dashboard", href: link("dashboard", "/dashboard"), icon: LayoutDashboard, auth: true },
  { label: "Machines", href: link("app", "/machines"), icon: Server, auth: true },
  { label: "CTF Arena", href: link("ctf", "/ctf"), icon: Flag, auth: true },
  { label: "Tracks", href: link("app", "/tracks"), icon: Route, auth: true },
  { label: "Teams", href: link("ctf", "/teams"), icon: Users, auth: true },
  { label: "Leaderboard", href: link("app", "/leaderboard"), icon: Trophy, auth: true },
  { label: "Forum", href: link("app", "/forum"), icon: MessagesSquare, auth: true },
  { label: "Writeups", href: link("app", "/writeups"), icon: BookOpen, auth: true },
  { label: "Bug Bounties", href: link("bugbounty", "/bounty"), icon: Target, auth: true },
  { label: "Notifications", href: "/notifications", icon: Bell, auth: true },
  { label: "Billing", href: "/billing", icon: CreditCard, auth: true },
  { label: "Settings", href: "/settings", icon: Settings, auth: true },
];

/** Admin sidebar — gated on privileged roles. */
export const ADMIN_NAV: NavItem[] = [
  { label: "Overview", href: "/admin", icon: LayoutDashboard, roles: ["admin", "moderator"] },
  { label: "Machines", href: "/admin/machines", icon: Server, roles: ["admin", "moderator"] },
  { label: "CTF", href: "/admin/ctf", icon: Flag, roles: ["admin", "ctf_organizer"] },
  { label: "Forum", href: "/admin/forum", icon: MessagesSquare, roles: ["admin", "moderator"] },
  { label: "Writeups", href: "/admin/writeups", icon: BookOpen, roles: ["admin", "moderator"] },
  { label: "Bounty triage", href: "/admin/bounty", icon: Target, roles: ["admin", "triager"] },
  { label: "Bounty programs", href: "/admin/bounty/programs", icon: ShieldCheck, roles: ["admin"] },
  { label: "Pricing", href: "/admin/pricing", icon: CreditCard, roles: ["admin"] },
  { label: "Teams", href: "/admin/teams", icon: Users, roles: ["admin", "moderator"] },
  { label: "Users", href: "/admin/users", icon: ShieldAlert, roles: ["admin"] },
  { label: "Broadcasts", href: "/admin/broadcast", icon: Bell, roles: ["admin", "moderator"] },
];

/** Footer link columns. */
export const FOOTER_LINKS: { heading: string; links: { label: string; href: string }[] }[] = [
  {
    heading: "Platform",
    links: [
      { label: "Machines", href: "/machines" },
      { label: "Challenges", href: "/challenges" },
      { label: "CTF events", href: "/ctf" },
      { label: "Tracks", href: "/tracks" },
      { label: "Leaderboard", href: "/leaderboard" },
    ],
  },
  {
    heading: "Community",
    links: [
      { label: "Forum", href: "/forum" },
      { label: "Writeups", href: "/writeups" },
      { label: "Bug bounties", href: "/bounty" },
      { label: "Discord", href: "/discord" },
      { label: "Hall of fame", href: "/leaderboard/hall-of-fame" },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Pricing", href: "/pricing" },
      { label: "Careers", href: "/careers" },
      { label: "Blog", href: "/blog" },
      { label: "Contact", href: "/contact" },
    ],
  },
];
