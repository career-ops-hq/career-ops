import { cn } from "@/lib/cn";

// Score / status pill. No brand tone — orange is reserved for "active/selected"
// (active tab, nav, focus ring), never for a score. Grades route through the
// good/warn/bad scale so the table stays legible.
export function Badge({
  className,
  tone = "muted",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  tone?: "good" | "warn" | "bad" | "muted";
}) {
  const tones = {
    good: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    warn: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    bad: "bg-red-500/15 text-red-700 dark:text-red-400",
    muted: "bg-surface-hover text-muted",
  } as const;
  return (
    <span
      className={cn(
        "inline-block rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
