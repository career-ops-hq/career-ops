"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { PIPELINE_TABS, type PipelineTab } from "@/lib/pipeline-tabs.mjs";
import { cn } from "@/lib/cn";

// Which Pipeline tab opens by default → config/profile.yml (web.default_pipeline_tab).
// Server-persisted (unlike the localStorage engine prefs) because the Pipeline
// page is server-rendered: reading it there is what keeps the first paint from
// showing INBOX and then swapping tabs.

const LABELS: Partial<Record<PipelineTab, string>> = {
  INBOX: "Inbox (triage queue)",
  ALL: "All (everything tracked)",
};

export function DefaultTabSetting() {
  const [tab, setTab] = useState<PipelineTab | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // On a failed load do NOT preselect a value: a Save would then write a default
  // the user never chose over the one they already have.
  const load = useCallback(() => {
    setLoadError(false);
    fetch("/api/pipeline/default-tab")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((d) => setTab(d?.tab as PipelineTab))
      .catch(() => setLoadError(true));
  }, []);
  useEffect(load, [load]);

  const save = async () => {
    if (!tab) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/pipeline/default-tab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tab }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof j.error === "string" ? j.error : "Could not save.");
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch {
      setError("Could not save.");
    }
    setSaving(false);
  };

  return (
    <div>
      <label className="mt-8 mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-muted">
        Pipeline
      </label>
      <div className="rounded-xl border border-border bg-surface/50 p-4">
        <p className="text-sm font-medium text-foreground">Default tab</p>
        <p className="mt-0.5 text-xs leading-relaxed text-faint">
          Which tab the <span className="text-muted">Pipeline</span> page opens on. Saved to{" "}
          <span className="font-mono text-muted">config/profile.yml</span>.
        </p>
        {loadError ? (
          <div className="mt-3 text-sm text-muted">
            <p className="text-red-500">Couldn&apos;t read your current default tab.</p>
            <button
              type="button"
              onClick={load}
              className="mt-2 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium transition-colors hover:bg-surface-hover"
            >
              Retry
            </button>
          </div>
        ) : tab === null ? (
          <div className="mt-3 flex items-center gap-2 text-sm text-muted">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            <select
              aria-label="Default pipeline tab"
              value={tab}
              onChange={(e) => setTab(e.target.value as PipelineTab)}
              className="mt-3 rounded-md border border-border bg-surface/60 px-3 py-1.5 text-sm outline-none transition-colors focus:border-brand/50 focus-visible:ring-2 focus-visible:ring-brand/40 max-sm:min-h-[44px]"
            >
              {PIPELINE_TABS.map((t) => (
                <option key={t} value={t}>
                  {LABELS[t] ?? t}
                </option>
              ))}
            </select>
            {error && <p className="mt-3 text-xs text-red-500">{error}</p>}
            <div>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className={cn(
                  "mt-4 inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium transition-colors hover:bg-surface-hover",
                  "disabled:pointer-events-none disabled:opacity-60",
                )}
              >
                {saving ? <Loader2 className="size-3.5 animate-spin" /> : saved ? <Check className="size-3.5 text-emerald-400" /> : null}
                {saved ? "Saved" : "Save default tab"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
