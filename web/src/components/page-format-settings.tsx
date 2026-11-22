"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

// Page format → config/profile.yml (page_format). Server-persisted (unlike the
// localStorage engine prefs on this page) because lib/page-format.mjs reads the
// same key, so the CLI and the web must render the same paper size. A profile can
// also say `auto` (the sheet follows the employer's country). That is shown, not
// guessed away, and nothing is rewritten until the user picks something else.

type State = { formats: string[]; default: string; override: string | null };

const LABELS: Record<string, string> = { a4: "A4", letter: "US Letter" };
const HINTS: Record<string, string> = {
  a4: "210 × 297 mm, Europe and most of the world",
  letter: "8.5 × 11 in, US and Canada",
};

export function PageFormatSettings() {
  const [state, setState] = useState<State | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // On a failed load, do NOT guess at the current value: showing the project
  // default as if it were the user's setting, then saving it, would write a
  // preference they never chose into config/profile.yml.
  const load = useCallback(() => {
    setLoadError(false);
    fetch("/api/page-format")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((d: State) => {
        setState(d);
        setChoice(d.override);
      })
      .catch(() => setLoadError(true));
  }, []);
  useEffect(load, [load]);

  const save = async () => {
    if (!state) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/page-format", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page_format: choice }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof j.error === "string" ? j.error : "Could not save.");
      } else {
        setState({ ...state, override: choice });
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch {
      setError("Could not save.");
    }
    setSaving(false);
  };

  const unchanged = state !== null && choice === state.override;

  const options: { value: string | null; label: string; hint: string }[] = [
    ...(state?.formats ?? []).map((f) => ({ value: f, label: LABELS[f] ?? f.toUpperCase(), hint: HINTS[f] ?? "" })),
    {
      value: null,
      label: "No preference",
      hint: `Use the project default (${LABELS[state?.default ?? ""] ?? state?.default ?? ""})`,
    },
  ];

  return (
    <div>
      <span id="page-format-label" className="mt-8 mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-muted">
        Page format
      </span>
      <div className="rounded-xl border border-border bg-surface/50 p-4">
        <p className="text-xs leading-relaxed text-faint">
          Paper size for your CV and cover-letter PDFs. Saved to{" "}
          <span className="font-mono text-muted">config/profile.yml</span>. The CLI uses the same
          value, and a <span className="font-mono text-muted">--format</span> flag still wins for a
          single render.
        </p>
        {loadError ? (
          <div className="mt-3 text-sm text-muted">
            <p className="text-red-500">
              Couldn&apos;t read your current page format. Not guessing, to avoid writing a
              preference you never chose into <span className="font-mono">config/profile.yml</span>.
            </p>
            <button
              type="button"
              onClick={load}
              className="mt-2 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium transition-colors hover:bg-surface-hover"
            >
              Retry
            </button>
          </div>
        ) : state === null ? (
          <div className="mt-3 flex items-center gap-2 text-sm text-muted">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            {state.override === "auto" && (
              <p className="mt-3 text-xs leading-relaxed text-muted">
                Your profile is set to <span className="font-mono">auto</span>: each PDF uses the
                sheet for the employer&apos;s country. It stays that way until you pick a size here.
              </p>
            )}
            <div role="group" aria-labelledby="page-format-label" className="mt-3 grid gap-2 sm:grid-cols-3">
              {options.map((o) => (
                <button
                  key={o.value ?? "unset"}
                  type="button"
                  onClick={() => {
                    setChoice(o.value);
                    setError(null);
                  }}
                  aria-pressed={choice === o.value}
                  className={cn(
                    "rounded-xl border px-4 py-2.5 text-left transition-colors max-sm:min-h-[44px]",
                    choice === o.value
                      ? "border-brand/50 bg-brand-soft text-foreground"
                      : "border-border bg-surface/50 text-muted hover:bg-surface-hover hover:text-foreground",
                  )}
                >
                  <span className="block text-sm font-medium">{o.label}</span>
                  <span className="mt-0.5 block text-xs text-faint">{o.hint}</span>
                </button>
              ))}
            </div>
            {error && <p role="alert" className="mt-3 text-xs text-red-500">{error}</p>}
            <button
              type="button"
              onClick={save}
              disabled={saving || unchanged}
              className={cn(
                "mt-4 inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium transition-colors hover:bg-surface-hover",
                "disabled:pointer-events-none disabled:opacity-60",
              )}
            >
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : saved ? <Check className="size-3.5 text-emerald-400" /> : null}
              {saved ? "Saved" : "Save page format"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
