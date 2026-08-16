import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind classes with conflict resolution.
 * `cn("px-2", condition && "px-4")` → later wins, no duplicates.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
