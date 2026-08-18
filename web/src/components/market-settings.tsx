"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Globe, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

export function MarketSettings() {
  const [modesDir, setModesDir] = useState<string>("modes/");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/profile");
      if (res.ok) {
        const data = await res.json();
        if (typeof data.modesDir === "string") {
          setModesDir(data.modesDir);
        }
      }
    } catch {
      setError("Failed to load market settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modesDir })
      });
      if (!res.ok) {
        setError("Could not save market setting.");
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch {
      setError("Could not save market setting.");
    }
    setSaving(false);
  };

  return (
    <div className="mt-8">
      <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-muted">
        Market & Evaluation Rules
      </label>
      <div className="rounded-xl border border-border bg-surface/50 p-4">
        <p className="text-xs leading-relaxed text-faint mb-4">
          Select which market's vocabulary and evaluation rules the AI should use when reviewing job descriptions.
        </p>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </div>
        ) : (
          <div className="space-y-4">
            <label className="block">
              <span className="block text-sm font-medium text-foreground flex items-center gap-1.5">
                <Globe className="size-3.5 text-muted" /> Market Mode
              </span>
              <span className="mt-0.5 block text-xs text-faint">
                One config switch per evaluation. Changes how the AI understands local job terms (e.g., benefits, notice periods).
              </span>
              <select
                value={modesDir}
                onChange={(e) => setModesDir(e.target.value)}
                className="mt-1.5 w-full max-w-sm rounded-md border border-border bg-surface/60 px-3 py-1.5 text-sm outline-none transition-colors focus:border-brand/50 focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                <option value="modes/">Global / US (Default)</option>
                <option value="modes/hi/">India</option>
                <option value="modes/ar/">UAE / Middle East</option>
                <option value="modes/de/">Germany / DACH</option>
                <option value="modes/fr/">France / Francophone</option>
                <option value="modes/ja/">Japan</option>
                <option value="modes/tr/">Turkey</option>
              </select>
            </label>

            {error && <p className="text-xs text-red-500">{error}</p>}
            
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className={cn(
                "mt-2 inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium transition-colors hover:bg-surface-hover",
                "disabled:pointer-events-none disabled:opacity-60",
              )}
            >
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : saved ? <Check className="size-3.5 text-emerald-400" /> : null}
              {saved ? "Saved" : "Save market setting"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
