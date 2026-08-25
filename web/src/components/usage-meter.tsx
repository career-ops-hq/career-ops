"use client";

import { useEffect, useState } from "react";
import { Gauge } from "lucide-react";
import { cn } from "@/lib/cn";

type Usage = { window5h: { tokens: number }; window7d: { tokens: number } };

// Soft budgets (tunable via localStorage `career-ops:usage-budget`). The bar
// colour is the "brake" signal — set these to your plan's real limits.
const DEFAULT_BUDGET = { w5: 140_000_000, w7: 1_000_000_000 };

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return `${n}`;
}
function tone(pct: number): string {
  if (pct >= 85) return "bg-red-400";
  if (pct >= 60) return "bg-amber-400";
  return "bg-emerald-400";
}

export function UsageMeter() {
  const [data, setData] = useState<Usage | null>(null);
  const [cli, setCli] = useState<string | null>(null);
  const [budget, setBudget] = useState(DEFAULT_BUDGET);

  useEffect(() => {
    try {
      const cfg = localStorage.getItem("career-ops:config");
      setCli(cfg ? JSON.parse(cfg).cliId || null : null);
      const b = localStorage.getItem("career-ops:usage-budget");
      if (b) setBudget({ ...DEFAULT_BUDGET, ...JSON.parse(b) });
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/usage")
        .then((r) => r.json())
        .then((d) => {
          if (alive) setData(d);
        })
        .catch(() => {});
    load();
    const id = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // The usage source is Claude's local logs; only meaningful when Claude is the CLI.
  if (cli && cli !== "claude") return null;
  if (!data) return null;

  const rows = [
    { label: "5h", tokens: data.window5h?.tokens ?? 0, budget: budget.w5 },
    { label: "7d", tokens: data.window7d?.tokens ?? 0, budget: budget.w7 },
  ];

  return (
    <div className="border-t border-border pt-3">
      <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-faint">
        <Gauge className="size-3" /> Usage
      </div>
      <div className="space-y-2 px-1">
        {rows.map((r) => {
          const pct = Math.min(100, Math.round((r.tokens / r.budget) * 100));
          return (
            <div key={r.label} title={`${r.tokens.toLocaleString()} tokens in the last ${r.label}`}>
              <div className="flex items-center justify-between text-[10px] text-faint">
                <span>{r.label}</span>
                <span className="tabular-nums">
                  {fmt(r.tokens)} · {pct}%
                </span>
              </div>
              <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-surface-hover">
                <div
                  className={cn("h-full rounded-full transition-all", tone(pct))}
                  style={{ width: `${Math.max(pct, 2)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
