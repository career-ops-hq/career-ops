"use client";

import { useEffect, useState } from "react";
import { Clock3, Copy, Check } from "lucide-react";
import { quietModel, checkRan } from "@/lib/quiet-companies.mjs";
import type { QuietModel, QuietCompany } from "@/lib/quiet-companies.mjs";

// Companies still in Interview whose silence has passed the courtesy threshold,
// from the core's rejection-latency.mjs via /api/quiet-companies.
//
// On Follow-ups because that is the page about chasing, and this is the far end
// of it: the point where chasing stops being worth it. It sits BELOW the due
// list, since a follow-up you can still send outranks a company that has
// already stopped replying.
//
// The copy stays on the observation. The core measures elapsed time and ships
// the sentence bounding the claim; a heading like "companies that ghosted you"
// would turn a day count into an accusation about a named third party, in a tool
// whose output people paste into messages.
export function QuietCompanies() {
  const [model, setModel] = useState<QuietModel | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/quiet-companies")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => alive && setModel(quietModel(d)))
      .catch(() => alive && setModel(quietModel(null)));
    return () => {
      alive = false;
    };
  }, []);

  if (!model) {
    return <div className="mt-8 h-24 w-full animate-pulse rounded-2xl bg-muted/25" aria-hidden />;
  }

  // A failed check is SHOWN, not hidden. Returning null here made the panel
  // disappear after the loading state, which on a page about chasing reads as
  // "nobody has gone quiet" — the reassuring answer, given for the one reason
  // that cannot support it. The whole point of this panel is that silence and
  // not-knowing look different.
  if (!checkRan(model)) {
    return (
      <section className="mt-8 rounded-2xl border border-dashed border-border bg-surface/30 px-5 py-4">
        <Header courtesyDays={null} />
        <p className="mt-2 text-sm text-muted">
          This check didn&apos;t run, so nothing here says whether anyone has gone quiet.
        </p>
      </section>
    );
  }

  if (model.companies.length === 0) {
    return (
      <section className="mt-8 rounded-2xl border border-border bg-surface/30 px-5 py-4">
        <Header courtesyDays={model.courtesyDays} />
        <p className="mt-2 text-sm text-muted">
          Nothing has gone quiet past the threshold{model.checked > 0 ? ` across ${model.checked} compan${model.checked === 1 ? "y" : "ies"}` : ""}.
        </p>
        {/* The caveats belong here MORE than on the populated panel, not less: an
            "all clear" drawn from a partial check is the reading most likely to
            be believed, and the core's warnings are what say the check was
            partial. */}
        <Caveats warnings={model.warnings} disclaimer={model.disclaimer} />
      </section>
    );
  }

  return (
    <section className="mt-8 rounded-2xl border border-border bg-surface/40 px-5 py-4">
      <Header courtesyDays={model.courtesyDays} />

      <div className="mt-3 grid gap-2.5">
        {model.companies.map((c) => (
          <Row key={`${c.company}-${c.lastDate ?? ""}`} c={c} />
        ))}
      </div>

      <Caveats warnings={model.warnings} disclaimer={model.disclaimer} />
    </section>
  );
}

/**
 * The core's warnings and its disclaimer, shared by the populated and empty
 * panels so neither can quietly drop them.
 */
function Caveats({ warnings, disclaimer }: { warnings: string[]; disclaimer: string | null }) {
  return (
    <>
      {warnings.map((w, i) => (
        <p key={i} className="mt-3 text-xs text-muted">
          {w}
        </p>
      ))}
      {disclaimer && (
        // Straight from the payload. Not styled as fine print: it is the
        // sentence that keeps a day count from reading as a verdict.
        <p className="mt-4 border-t border-border pt-3 text-xs text-faint">{disclaimer}</p>
      )}
    </>
  );
}

function Header({ courtesyDays }: { courtesyDays: number | null }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Clock3 className="size-4 text-brand" />
      <h2 className="font-display text-base text-landing">No reply since your last round</h2>
      {courtesyDays !== null && <span className="text-xs text-faint">past {courtesyDays} days</span>}
    </div>
  );
}

function Row({ c }: { c: QuietCompany }) {
  const [copied, setCopied] = useState(false);
  // Shown when the clipboard is unavailable — a denied permission, a
  // non-secure origin, an older browser. The row is the whole point of the
  // button, so failing silently leaves the user with no way to get it; this
  // puts it on screen as selectable text instead.
  const [fallback, setFallback] = useState<string | null>(null);

  const copy = async () => {
    if (!c.blacklistRow) return;
    try {
      await navigator.clipboard.writeText(c.blacklistRow);
      setCopied(true);
      setFallback(null);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setFallback(c.blacklistRow);
    }
  };

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-surface/40 px-3.5 py-2.5">
      <div className="min-w-0 flex-[1_1_60%]">
        <p className="truncate text-sm">
          <span className="font-medium text-foreground">{c.company}</span>
          {c.role && <span className="text-muted"> · {c.role}</span>}
        </p>
        <p className="text-xs text-faint">
          {c.days} day{c.days === 1 ? "" : "s"} since {c.lastDate ?? "the last round"}
          {c.trackerNums.length > 0 && <span> · #{c.trackerNums.join(", #")}</span>}
        </p>
      </div>
      {c.blacklistRow && (
        // Copy, never apply. data/blacklist.md is opt-in and never
        // auto-populated (AGENTS.md); putting a company on it stays a decision
        // the user makes in their own file.
        <button
          type="button"
          onClick={copy}
          title={c.blacklistRow}
          className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted transition hover:border-brand/40 hover:text-foreground"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy blacklist row"}
        </button>
      )}
      {fallback && (
        <div className="w-full">
          <p className="text-xs text-muted">Couldn&apos;t reach the clipboard — select and copy:</p>
          <code className="mt-1 block w-full select-all overflow-x-auto rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[11px] text-foreground">
            {fallback}
          </code>
        </div>
      )}
    </div>
  );
}
