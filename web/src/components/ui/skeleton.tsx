import { cn } from "@/lib/cn";
import type { CSSProperties } from "react";

/**
 * Theme-aware shimmer placeholder used by route `loading.tsx` files.
 * Callers provide the size and shape; the shared `.skeleton` class supplies
 * the muted surface and sweeping sheen.
 */
export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div className={cn("skeleton rounded-xl", className)} style={style} aria-hidden="true" />;
}
