"use client";

import { useApply } from "@/components/apply/apply-provider";
import { ApplyBackdrop } from "@/components/apply/apply-backdrop";

// Mounts the full-viewport apply wallpaper at the PAGE level (a sibling before
// the content) so it sits behind everything — header + questions scroll over the
// blurred form. Active only once a session is opening/processing/ready.
export function ApplyBackdropMount() {
  const a = useApply();
  if (a.status === "idle" || a.status === "error") return null;
  const intense = a.status === "opening" || a.status === "prefilling" || a.status === "filling";
  return <ApplyBackdrop image={a.shots[0]} intense={intense} />;
}
