import { cn } from "@/lib/cn";
import { coverageBand } from "@/lib/keyword-coverage.mjs";

export function CoverageMeter({ coverage, dropped }: { coverage: { present: string[]; missing: string[]; pct: number | null }; dropped: string[] }) {
  const total = coverage.present.length + coverage.missing.length;
  if (!total) {
    return <p className="rounded-2xl border border-border bg-surface/40 px-5 py-3 text-sm text-muted">This report has no extracted keywords, so coverage is not measured.</p>;
  }
  const band = coverageBand(coverage.pct);
  const bar = { high: "bg-emerald-500", mid: "bg-amber-500", low: "bg-red-400", unknown: "bg-muted" }[band];
  return (
    <section aria-label="Keyword coverage" className="rounded-2xl border border-border bg-surface/40 px-5 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium text-foreground">Job keyword coverage</h2>
        <p className="font-mono text-sm text-foreground" data-testid="coverage-count">
          {coverage.present.length}/{total} · {coverage.pct}%
        </p>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted/20" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={coverage.pct ?? 0}>
        <div className={cn("h-full rounded-full transition-[width] duration-300", bar)} style={{ width: `${coverage.pct ?? 0}%` }} />
      </div>
      {dropped.length > 0 && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-300" role="status">
          Your edits removed {dropped.join(", ")}, which the tailored CV covered.
        </p>
      )}
      {coverage.missing.length > 0 && (
        <p className="mt-2 text-xs text-muted">
          Missing: {coverage.missing.join(", ")}. Add one only if it is true for you.
        </p>
      )}
    </section>
  );
}
