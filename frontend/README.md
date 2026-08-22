# OFFCON Frontend

The web frontend for Offense Conditions — **Next.js 15 (App Router) + React 19 +
TypeScript + Tailwind**. Premium-dark aesthetic with a full **light/dark theme
system** baked in from day one.

> This is **Phase 13a — Foundation**. It ships the design system, theme engine,
> brand/logo system, API client, providers, the shared UI primitives, and a
> fully-working landing page that proves the whole stack end-to-end. Feature
> pages (dashboard, machines, CTF, forum, writeups, bounty, billing, admin) land
> in phases 13b–13f on top of this foundation.

## Stack

| Concern | Choice |
|---|---|
| Framework | Next.js 15 (App Router, RSC) |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS + CSS-variable theme tokens |
| Data fetching | TanStack Query (React Query) |
| Theme | next-themes (dark default, light toggle, no flash) |
| Icons | lucide-react |
| Flags | flag-icons (crisp SVG, leaderboard/hall-of-fame) |
| Toasts | sonner |
| Fonts | Sora (display) · Manrope (body) · JetBrains Mono (code) |

## Theme system (light + dark)

The whole app is driven by **semantic CSS tokens**, not hardcoded colors. Two
complete palettes live in `src/styles/globals.css`:

```
:root, [data-theme="dark"]  { --bg: 7 7 16;   --text: 237 235 250; ... }
[data-theme="light"]        { --bg: 251 250 255; --text: 22 19 31;  ... }
```

`next-themes` writes `data-theme` on `<html>` **before first paint** (no flash),
persists the choice, and can follow the OS. The toggle is `<ThemeToggle />` in
the nav. Because every component references tokens (`bg-bg`, `text-text-dim`,
`border-line`, …) the switch flips the entire UI **for free** — no per-component
work.

## 🔵 Changing the logo (read me)

The logo lives in **one place**: `src/config/brand.ts`.

```ts
export const BRAND = {
  logo:     null,   // ← set to "/logo.svg"       to use your real full logo
  logoMark: null,   // ← set to "/logo-mark.svg"  to use your real shield mark
  ...
}
```

1. Drop your files in `public/` (e.g. `public/logo.svg`, `public/logo-mark.svg`).
2. Set the two paths above.

Done — every logo across the site (nav, footer, auth, emails, loading) updates,
because they all render through `<Logo />` (`src/components/brand/logo.tsx`).
While the paths are `null`, `<Logo />` renders the built-in inline-SVG
placeholder (the approved shield + OFFCON wordmark) which looks crisp in both
themes.

## Structure

```
src/
├── app/
│   ├── layout.tsx              Root layout: fonts, metadata, providers
│   └── (marketing)/
│       ├── layout.tsx          Marketing shell: nav + footer + atmosphere
│       └── page.tsx            Landing page (built on the component system)
├── components/
│   ├── brand/                  Logo, ThemeToggle
│   ├── layout/                 MarketingNav, SiteFooter
│   └── ui/                     Button, Card, Badge, Stat, Flag, Skeleton
├── config/
│   ├── brand.ts                ⭐ logo + brand config (edit here)
│   └── nav.ts                  nav/route maps (marketing, app, admin, footer)
├── lib/
│   ├── api.ts                  typed gateway client + ApiError
│   ├── cn.ts                   tailwind class merge
│   └── format.ts               number/money/date/duration/flag helpers
├── providers/                  Theme, React Query, Toaster composition
├── styles/globals.css          ⭐ the dual-palette theme engine
└── types/                      shared domain types
```

## Develop

```bash
npm install
npm run dev          # http://localhost:3000
npm run typecheck
npm run lint
npm run build
```

The dev server proxies `/api/*` to the gateway (`NEXT_PUBLIC_API_BASE_URL`, see
`.env.example`) so the browser hits a single origin and avoids CORS in dev.

## What's mocked

The landing page's stats + leaderboard use small inline mock arrays. These get
swapped for live calls to scoring-svc/content-svc (via `src/lib/api.ts` +
React Query) when those feature pages are built.
