/**
 * Display formatting helpers — numbers, currency, dates, durations.
 */

/** 142850 → "142,850" */
export function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

/** 128000 → "128K", 1500000 → "1.5M" (compact, for stats) */
export function formatCompact(n: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

/** cents + currency → localized money. 1499,"USD" → "$14.99" */
export function formatMoney(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

/** ISO string → "May 30, 2026" */
export function formatDate(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}

/** ISO string → relative "3 hours ago", "in 2 days" */
export function formatRelative(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const diffMs = d.getTime() - Date.now();
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31536000000],
    ["month", 2592000000],
    ["day", 86400000],
    ["hour", 3600000],
    ["minute", 60000],
    ["second", 1000],
  ];
  for (const [unit, ms] of units) {
    if (Math.abs(diffMs) >= ms || unit === "second") {
      return rtf.format(Math.round(diffMs / ms), unit);
    }
  }
  return "just now";
}

/** seconds → "1h 23m", "45s", "2d 4h" (for solve times, durations) */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Initials from a handle/name for avatar fallbacks. "sh4dowByte" → "SH" */
export function initials(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9 ]/g, "");
  const parts = cleaned.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  }
  return cleaned.slice(0, 2).toUpperCase();
}

/** ISO 3166-1 alpha-2 lowercased for the flag-icon CSS classes. "PK" → "pk" */
export function flagCode(country: string): string {
  return country.trim().toLowerCase().slice(0, 2);
}
