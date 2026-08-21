import type { Config } from "tailwindcss";

/**
 * OFFCON design tokens.
 *
 * Every colour is driven by a CSS variable defined in globals.css, with one
 * value for the ink theme (:root / dark) and another for the paper theme
 * ([data-theme="light"]). Components reference these semantic tokens only —
 * never raw hex — so the theme switch flips the whole app for free.
 *
 * Two scales here do a disproportionate amount of the redesign's work, and are
 * worth understanding before changing anything:
 *
 *   borderRadius — the theme is square. Rather than editing `rounded-xl` out of
 *     a hundred files, the scale itself is redefined to near-zero. Every
 *     existing `rounded-xl` / `rounded-2xl` in the app squares off at once.
 *     `rounded-full` is untouched, so avatars and pills still round.
 *
 *   letterSpacing — `tracking-mega` is what makes the display type read as the
 *     marketing pages do. Archivo at -0.05em is the voice.
 */
const config: Config = {
  darkMode: ["class", '[data-theme="dark"]'],
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/providers/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // ---- Brand (theme-independent) ----
        brand: {
          purple: "#7C3AED",
          "purple-light": "#8B5CF6",
          "purple-dark": "#6D28D9",
          blue: "#2563EB",
          "blue-light": "#3B82F6",
          "blue-dark": "#1D4ED8",
        },
        // ---- Semantic tokens (flip with theme) ----
        bg: "rgb(var(--bg) / <alpha-value>)",
        "bg-elevated": "rgb(var(--bg-elevated) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        "surface-hover": "rgb(var(--surface-hover) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        "line-strong": "rgb(var(--line-strong) / <alpha-value>)",
        text: "rgb(var(--text) / <alpha-value>)",
        "text-dim": "rgb(var(--text-dim) / <alpha-value>)",
        "text-faint": "rgb(var(--text-faint) / <alpha-value>)",
        "text-ghost": "rgb(var(--text-ghost) / <alpha-value>)",
        "text-on-brand": "rgb(var(--text-on-brand) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
        "accent-soft": "rgb(var(--accent-soft) / <alpha-value>)",
        // ---- Status ----
        success: "rgb(var(--success) / <alpha-value>)",
        warning: "rgb(var(--warning) / <alpha-value>)",
        danger: "rgb(var(--danger) / <alpha-value>)",
        info: "rgb(var(--info) / <alpha-value>)",
      },
      letterSpacing: {
        mega: "-0.05em",
        wide: "0.18em",
        widest: "0.32em",
      },
      fontFamily: {
        display: ["var(--font-display)", "sans-serif"],
        sans: ["var(--font-body)", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      backgroundImage: {
        /**
         * These two utilities appear ~70 times across 25 files — on avatars,
         * icon tiles, rank chips and tinted panels. Redefining them here is how
         * all of that changes at once, the same lever as the radius scale.
         *
         * `brand-gradient` is deliberately a *fixed* dark chip rather than a
         * theme token. Almost every call site pairs it with `text-white`, and a
         * theme-aware version would go pale on the paper theme and take the
         * white type down with it. A near-black chip with white type is good
         * drafting-sheet language on both grounds, so it stays put.
         */
        "brand-gradient": "linear-gradient(140deg, #1E1E24 0%, #0A0A0C 100%)",
        /* Theme-aware and chroma-free: a barely-there lift for tinted panels. */
        "brand-gradient-soft":
          "linear-gradient(140deg, rgb(var(--text) / 0.06), rgb(var(--text) / 0.02))",
      },
      boxShadow: {
        /* The violet bloom is gone. Depth in this design is a hairline, so the
           glow utilities resolve to an inset edge — the eleven call sites keep
           working and stop glowing. */
        glow: "inset 0 0 0 1px rgb(255 255 255 / 0.06)",
        "glow-lg": "inset 0 0 0 1px rgb(255 255 255 / 0.09)",
        card: "var(--shadow-card)",
        "card-lg": "var(--shadow-card-lg)",
      },
      borderRadius: {
        /* See the note above: redefining the scale squares the whole app. */
        DEFAULT: "2px",
        sm: "1px",
        md: "2px",
        lg: "2px",
        xl: "3px",
        "2xl": "4px",
        "3xl": "6px",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(16px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "pulse-dot": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.35" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
        blink: {
          "50%": { opacity: "0" },
        },
        "scan-line": {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100%)" },
        },
        "slide-in-left": {
          from: { transform: "translateX(-100%)" },
          to: { transform: "translateX(0)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.6s cubic-bezier(0.2,0.7,0.3,1) both",
        "fade-in": "fade-in 0.5s ease both",
        "pulse-dot": "pulse-dot 2s ease-in-out infinite",
        shimmer: "shimmer 1.6s infinite",
        blink: "blink 1.1s steps(1) infinite",
        "scan-line": "scan-line 7s linear infinite",
        "slide-in-left": "slide-in-left 0.22s cubic-bezier(0.2,0.7,0.3,1) both",
      },
    },
  },
  plugins: [],
};

export default config;
