"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

type PlanRow = { label: string; percent: number; resets: string | null };
type Usage = { window5h?: { tokens: number }; window7d?: { tokens: number }; plan?: { rows: PlanRow[] } | null };

function tone(pct: number): string {
  if (pct >= 85) return "bg-red-400";
  if (pct >= 60) return "bg-amber-400";
  return "bg-emerald-400";
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return `${n}`;
}

// "Current week (all models)" -> "This week (all models)"
function label(l: string): string {
  return l.replace(/^Current session/i, "5-hour session").replace(/^Current week/i, "This week");
}

/** Real plan limits from `claude /usage` (via /api/usage, which the sidebar meter also uses). */
export function PlanLimits() {
  const [data, setData] = useState<Usage | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/usage")
        .then((r) => r.json())
        .then((d) => alive && setData(d))
        .catch(() => alive && setFailed(true));
    load();
    // The plan lookup can miss on the first poll (the CLI starts slowly); poll again soon.
    const first = setTimeout(load, 8_000);
    const id = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);

  const rows = data?.plan?.rows ?? [];
  if (!data && !failed) return <p className="mt-4 text-xs text-muted">Asking Claude for your plan limits…</p>;
  if (!rows.length) {
    return (
      <div className="mt-4 text-xs leading-5 text-muted">
        Plan limits are not available right now (the Claude CLI did not answer <code className="font-mono">/usage</code>).
        {data ? (
          <> Activity across all your Claude Code projects: <span className="tabular-nums text-foreground">{fmt(data.window5h?.tokens ?? 0)}</span> tokens in the last 5 hours, <span className="tabular-nums text-foreground">{fmt(data.window7d?.tokens ?? 0)}</span> in the last 7 days.</>
        ) : null}
      </div>
    );
  }
  return (
    <div className="mt-5 space-y-4">
      {rows.map((r) => {
        const pct = Math.min(100, Math.max(0, r.percent));
        return (
          <div key={r.label}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-muted">{label(r.label)}</span>
              <span className="font-mono tabular-nums text-foreground">
                {Math.round(r.percent)}%{r.resets ? <span className="ml-2 text-xs text-faint">resets {r.resets}</span> : null}
              </span>
            </div>
            <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-surface-hover" role="img" aria-label={`${label(r.label)}: ${Math.round(r.percent)} percent used`}>
              <div className={cn("h-full rounded-full transition-[width] duration-500", tone(pct))} style={{ width: `${Math.max(pct, 1.5)}%` }} />
            </div>
          </div>
        );
      })}
      <p className="text-[11px] leading-5 text-faint">From your Claude subscription. It counts everything on the account, not only career-ops.</p>
    </div>
  );
}
