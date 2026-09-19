import type { Config } from "tailwindcss";

/**
 * OFFCON design tokens.
 *
 * Every color is driven by a CSS variable defined in globals.css, with one
 * value set for dark mode (:root) and another for light mode ([data-theme]).
 * Components ONLY reference these semantic tokens (bg, surface, text, etc.) —
 * never raw hex — so the light/dark switch flips the whole app for free.
 *
 * The raw brand gradient stops (purple -> blue) are also exposed for the few
 * places that need the literal brand color regardless of theme (the logo,
 * gradient CTAs, etc).
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
        "text-on-brand": "rgb(var(--text-on-brand) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
        "accent-soft": "rgb(var(--accent-soft) / <alpha-value>)",
        // ---- Status ----
        success: "rgb(var(--success) / <alpha-value>)",
        warning: "rgb(var(--warning) / <alpha-value>)",
        danger: "rgb(var(--danger) / <alpha-value>)",
        info: "rgb(var(--info) / <alpha-value>)",
      },
      fontFamily: {
        display: ["var(--font-display)", "sans-serif"],
        sans: ["var(--font-body)", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      backgroundImage: {
        "brand-gradient":
          "linear-gradient(120deg, #7C3AED 0%, #5B36E0 45%, #2563EB 100%)",
        "brand-gradient-soft":
          "linear-gradient(120deg, rgba(124,58,237,0.16), rgba(37,99,235,0.16))",
      },
      boxShadow: {
        glow: "0 8px 28px -8px rgba(109,40,217,0.55)",
        "glow-lg": "0 20px 60px -16px rgba(109,40,217,0.45)",
        card: "var(--shadow-card)",
        "card-lg": "var(--shadow-card-lg)",
      },
      borderRadius: {
        xl: "16px",
        "2xl": "20px",
        "3xl": "26px",
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
        "slide-in-left": "slide-in-left 0.22s cubic-bezier(0.2,0.7,0.3,1) both",
      },
    },
  },
  plugins: [],
};

export default config;
