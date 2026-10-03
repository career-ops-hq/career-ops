"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { GraduationCap, TriangleAlert } from "lucide-react";
import { skillGapModel, barPct } from "@/lib/skill-gaps.mjs";
import type { SkillGapModel } from "@/lib/skill-gaps.mjs";

// What keeps costing you roles, from the core's upskill.mjs via /api/upskill.
//
// On the CV page because this is the page for improving your candidacy, and the
// gaps are the difference between the CV as written and the roles being
// targeted. It is NOT a to-do list for the CV: upskill.mjs never adds a claim to
// cv.md, and neither does this — writing a skill you do not have into the
// document is the fabrication the project rules forbid.
//
// The weighting is the core's: a 2.1/5 report says more about a gap than a
// 4.5/5 one, so a skill that sinks low-fit roles outranks one mentioned often.
const TIER_CLASS: Record<string, string> = {
  High: "text-brand-text",
  Medium: "text-foreground",
  Low: "text-muted",
};

export function SkillGaps() {
  const [model, setModel] = useState<SkillGapModel | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/upskill")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => alive && setModel(skillGapModel(d)))
      .catch(() => alive && setModel(skillGapModel(null)));
    return () => {
      alive = false;
    };
  }, []);

  if (!model) {
    return (
      <section className="mt-8 rounded-2xl border border-border bg-surface/40 px-5 py-4">
        <div className="h-5 w-48 animate-pulse rounded bg-muted/25" aria-hidden />
        <div className="mt-3 h-24 w-full animate-pulse rounded bg-muted/25" aria-hidden />
      </section>
    );
  }

  // Silent when the script is absent — the CV editor is the page, and this is
  // context beside it.
  if (!model.available) return null;

  if (model.gaps.length === 0) {
    return (
      <section className="mt-8 rounded-2xl border border-border bg-surface/40 px-5 py-4">
        <Header />
        <p className="mt-2 text-sm text-muted">
          No recurring gaps yet. These are read from each report&apos;s Machine Summary and Gap table, so they appear
          once a few evaluations are in.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-8 rounded-2xl border border-border bg-surface/40 px-5 py-4">
      <Header />

      {model.caveats.map((c) => (
        <p key={c.kind} className="mt-2 flex items-start gap-2 text-xs text-muted">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-faint" aria-hidden />
          <span>{c.text}</span>
        </p>
      ))}

      <div className="mt-4 grid gap-2.5">
        {model.gaps.map((g) => (
          <div key={g.skill} className="flex items-center gap-3">
            <span className="w-36 shrink-0 truncate text-sm text-foreground" title={g.skill}>
              {g.skill}
            </span>
            <div className="h-3.5 flex-1 overflow-hidden rounded-full bg-surface">
              <div className="h-full rounded-full bg-brand/60" style={{ width: `${barPct(g, model.gaps)}%` }} />
            </div>
            <span className={`w-16 shrink-0 text-right text-xs tabular-nums ${TIER_CLASS[g.tier] ?? "text-muted"}`}>
              {g.tier ?? "—"}
            </span>
            <span className="w-24 shrink-0 text-right text-xs tabular-nums text-faint">
              {g.reports} report{g.reports === 1 ? "" : "s"}
            </span>
          </div>
        ))}
      </div>

      <p className="mt-4 text-xs text-faint">
        Weighted by fit — a low-scoring role says more about a gap than a high-scoring one. Nothing here is added to your
        CV; close the gap first, then write it.{" "}
        <Link href="/pipeline" className="text-muted underline-offset-2 hover:underline">
          See the reports
        </Link>
      </p>
    </section>
  );
}

function Header() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <GraduationCap className="size-4 text-brand" />
      <h2 className="font-display text-base text-landing">What keeps costing you roles</h2>
      <span className="text-xs text-faint">across your tracked evaluations</span>
    </div>
  );
}
