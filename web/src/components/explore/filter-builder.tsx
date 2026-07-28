"use client";

import { useState } from "react";
import { X, Ban, Clock, MapPin, ChevronDown, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/cn";
import { ATS_LABEL, ATS_SOURCES, cleanChips, type AtsSource, type ExploreFilters } from "@/lib/explore";

const RECENCY = [
  { label: "24h", days: 1 },
  { label: "3d", days: 3 },
  { label: "7d", days: 7 },
  { label: "14d", days: 14 },
  { label: "30d", days: 30 },
];

const STYLE = `
.co-fb__chip{display:inline-flex;align-items:center;gap:.3rem;border-radius:999px;padding:.2rem .5rem .2rem .6rem;font-size:12.5px;line-height:1.2;border:1px solid transparent}
.co-fb__chip button{display:inline-flex;opacity:.6;transition:opacity .15s}
.co-fb__chip button:hover{opacity:1}
.co-fb__chip.inc{color:hsl(26 78% 42%);background:hsl(26 73% 51% / .11);border-color:hsl(26 73% 51% / .26)}
html.dark .co-fb__chip.inc{color:hsl(26 86% 70%);background:hsl(26 80% 55% / .14);border-color:hsl(26 80% 55% / .28)}
.co-fb__field{display:flex;flex-wrap:wrap;gap:.4rem;align-items:center;min-height:2.6rem;padding:.45rem .55rem;border-radius:.7rem}
.co-fb__field input{flex:1;min-width:7rem;background:transparent;border:none;outline:none;font-size:13.5px;color:inherit}
.co-fb__field input::placeholder{color:var(--co-faint,hsl(0 0% 60%))}
@media (max-width:639px){.co-fb__chip button{min-width:44px;min-height:44px;justify-content:center}.co-fb__chip{min-height:44px}.co-fb__field{min-height:44px}.co-fb__field input{min-height:32px}}
`;

function KeywordField({
  values,
  tone,
  placeholder,
  onChange,
}: {
  values: string[];
  tone: "inc" | "exc";
  placeholder: string;
  onChange: (v: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  // Split only on UNAMBIGUOUS item separators (comma / newline / semicolon) — never
  // bare spaces, which are legitimate inside multi-word entries ("AI platform",
  // "New York", "Costa Rica"). A space-only paste stays one chip on purpose (#1147).
  const commit = (text: string) => {
    const parts = text.split(/[,\n;\t\r]+/);
    const next = cleanChips([...values, ...parts]);
    onChange(next);
    setDraft("");
  };
  return (
    <div className={cn("co-fb__field border border-border bg-surface/40 focus-within:border-brand/40 transition-colors")}>
      {values.map((v) => (
        <span key={v} className={cn("co-fb__chip", tone === "inc" ? "inc" : "border-border bg-surface-hover text-muted")}>
          {tone === "exc" && <Ban className="size-3 opacity-70" />}
          {v}
          <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}>
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => {
          const val = e.target.value;
          if (/[,\n;\t\r]$/.test(val)) commit(val);
          else setDraft(val);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && draft.trim()) {
            e.preventDefault();
            commit(draft);
          } else if (e.key === "Backspace" && !draft && values.length) {
            onChange(values.slice(0, -1));
          }
        }}
        onPaste={(e) => {
          e.preventDefault();
          const text = e.clipboardData.getData("text");
          const merged = draft + text;
          // Only commit to chips when the paste contains item separators.
          // A plain-text paste (e.g. pasting "-EMEA" after typing "Remote")
          // stays in the input field so the user can keep editing.
          if (/[,;\n\t\r]/.test(text)) commit(merged);
          else setDraft(merged);
        }}
        onBlur={() => draft.trim() && commit(draft)}
        placeholder={values.length ? "" : placeholder}
      />
    </div>
  );
}

function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between">
      <span className="text-[13px] font-medium text-foreground">{children}</span>
      {hint && <span className="text-[11px] text-faint">{hint}</span>}
    </div>
  );
}

export function FilterBuilder({
  filters,
  onChange,
  seededFrom = [],
}: {
  filters: ExploreFilters;
  onChange: (f: ExploreFilters) => void;
  seededFrom?: string[];
}) {
  const [advanced, setAdvanced] = useState(false);
  const set = (patch: Partial<ExploreFilters>) => onChange({ ...filters, ...patch });
  const toggleAts = (a: AtsSource) => {
    const has = filters.ats.includes(a);
    const next = has ? filters.ats.filter((x) => x !== a) : [...filters.ats, a];
    set({ ats: next.length ? next : filters.ats });
  };

  return (
    <div className="space-y-4">
      <style>{STYLE}</style>

      <div>
        <Label hint={filters.positive.length === 0 ? "empty = every fresh posting" : undefined}>Roles to find</Label>
        <KeywordField values={filters.positive} tone="inc" placeholder="AI platform, ML infrastructure, staff engineer…" onChange={(v) => set({ positive: v })} />
        {seededFrom.length > 0 && filters.positive.length > 0 && (
          <p className="mt-1 text-[11px] text-faint">Seeded from your {seededFrom.join(" + ")} — edit freely.</p>
        )}
      </div>

      <div>
        <Label>Exclude</Label>
        <KeywordField values={filters.negative} tone="exc" placeholder="manager, sales, contract…" onChange={(v) => set({ negative: v })} />
      </div>

      <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
        <div>
          <Label hint="postings published in this window">
            <span className="inline-flex items-center gap-1.5">
              <Clock className="size-3.5 text-muted" /> Posted within
            </span>
          </Label>
          <div className="inline-flex rounded-lg border border-border bg-surface/40 p-0.5">
            {RECENCY.map((r) => (
              <button
                key={r.days}
                type="button"
                onClick={() => set({ sinceDays: r.days })}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors max-sm:min-h-[44px]",
                  filters.sinceDays === r.days ? "bg-brand-soft text-brand" : "text-muted hover:text-foreground",
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label hint={filters.ats.length === 0 ? "pick at least one" : undefined}>Sources</Label>
          <div className="flex flex-wrap gap-1.5">
            {ATS_SOURCES.map((a) => {
              const on = filters.ats.includes(a);
              return (
                <button
                  key={a}
                  type="button"
                  onClick={() => toggleAts(a)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors max-sm:min-h-[44px]",
                    on ? "border-brand/40 bg-brand-soft text-brand" : "border-border text-muted hover:text-foreground",
                  )}
                >
                  {ATS_LABEL[a]}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setAdvanced((v) => !v)}
        className="inline-flex items-center gap-1.5 text-[12px] text-muted hover:text-foreground transition-colors max-sm:min-h-[44px]"
      >
        <SlidersHorizontal className="size-3.5" />
        Location &amp; scope
        <ChevronDown className={cn("size-3.5 transition-transform", advanced && "rotate-180")} />
      </button>

      {advanced && (
        <div className="space-y-3 rounded-xl border border-border bg-surface/30 p-3">
          <div className="flex items-center gap-1.5 text-[12px] text-muted">
            <MapPin className="size-3.5" /> Location
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label hint="rescues multi-loc posts">Always include</Label>
              <KeywordField values={filters.alwaysAllow} tone="inc" placeholder="London…" onChange={(v) => set({ alwaysAllow: v })} />
            </div>
            <div>
              <Label>Only in</Label>
              <KeywordField values={filters.allow} tone="inc" placeholder="Remote, EMEA…" onChange={(v) => set({ allow: v })} />
            </div>
            <div>
              <Label>Never in</Label>
              <KeywordField values={filters.block} tone="exc" placeholder="India…" onChange={(v) => set({ block: v })} />
            </div>
          </div>
          <div>
            <Label hint={`${filters.limitPerAts} companies / source`}>Scan depth</Label>
            <input
              type="range"
              min={50}
              max={500}
              step={50}
              value={filters.limitPerAts}
              onChange={(e) => set({ limitPerAts: Number(e.target.value) })}
              className="w-full accent-brand"
            />
          </div>
        </div>
      )}
    </div>
  );
}
