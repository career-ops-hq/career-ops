"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, FileText, Loader2, RotateCcw } from "lucide-react";
import { cn } from "@/lib/cn";
import { arrange, renderBlocks, type BlockTree } from "@/lib/cv-studio/html-blocks.mjs";
import { emptyEdits, resolveStudio, studioReducer, type StudioAction, type StudioDoc, type StudioEdits } from "@/lib/cv-studio/studio.mjs";
import { SectionCard } from "./section-card";
import { CvPreview } from "./cv-preview";
import { CoverageMeter } from "./coverage-meter";

type Loaded = { ok: true; reportNum: string; company: string; file: string; tree: BlockTree; doc: StudioDoc; edits: StudioEdits; stale: boolean; hasBase: boolean };
type LoadState = { kind: "loading" } | { kind: "error"; reason: string } | { kind: "ready"; data: Loaded };
type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; pdf: string; indexed: boolean; warnings: string[] } | { kind: "failed"; error: string };

const REASONS: Record<string, { title: string; body: string }> = {
  "no-tailored-cv": { title: "No tailored CV yet", body: "Generate a tailored CV from the report page first. The Studio opens it for review once it exists." },
  "unreadable-layout": { title: "This CV layout is not supported yet", body: "The Studio reads CVs built from the career-ops templates. Open the PDF from the report page instead." },
  "no-report": { title: "Report not found", body: "There is no evaluation report with this number." },
};

const STALE = "This CV was regenerated in another tab. Reload the Studio.";
const SAVE_ERRORS: Record<string, string> = { stale: STALE, busy: "This CV is already being saved. Wait for that save to finish." };

export function CvStudio({ n }: { n: string }) {
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  useEffect(() => {
    let live = true;
    fetch(`/api/cv-studio/${encodeURIComponent(n)}`)
      .then(async (r) => (r.ok ? { kind: "ready" as const, data: (await r.json()) as Loaded } : { kind: "error" as const, reason: ((await r.json().catch(() => ({}))) as { error?: string }).error ?? "failed" }))
      .catch(() => ({ kind: "error" as const, reason: "failed" }))
      .then((s) => live && setLoad(s));
    return () => {
      live = false;
    };
  }, [n]);

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
      <Link href={`/pipeline/${n}`} className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-brand">
        <ArrowLeft className="size-4" /> Report #{n}
      </Link>
      {load.kind === "loading" && <div className="mt-6 h-[70vh] animate-pulse rounded-2xl bg-muted/15" aria-label="Loading the CV Studio" />}
      {load.kind === "error" && (
        <div className="mt-8 max-w-xl rounded-2xl border border-border bg-surface/40 px-6 py-5">
          <h1 className="font-display text-xl text-landing">{REASONS[load.reason]?.title ?? "The CV Studio could not open this CV"}</h1>
          <p className="mt-2 text-sm text-muted">{REASONS[load.reason]?.body ?? "Reload the page to try again."}</p>
        </div>
      )}
      {load.kind === "ready" && <Studio n={n} data={load.data} />}
    </div>
  );
}

function Studio({ n, data }: { n: string; data: Loaded }) {
  const { doc, tree } = data;
  const [edits, dispatch] = useReducer((e: StudioEdits, a: StudioAction) => studioReducer(e, a, doc), data.edits);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [autosaveError, setAutosaveError] = useState<string | null>(null);
  const resolved = useMemo(() => resolveStudio(doc, edits), [doc, edits]);
  const html = useMemo(() => renderBlocks(tree, resolved.view, { added: resolved.added }), [tree, resolved]);
  const tailoredPresent = useMemo(() => resolveStudio(doc, emptyEdits(doc.sourceHash)).coverage.present, [doc]);
  const dropped = tailoredPresent.filter((k) => resolved.coverage.missing.includes(k));

  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const send = useCallback(
    (method: "PUT" | "POST", body: object) => {
      const sent = queue.current.then(() => fetch(`/api/cv-studio/${encodeURIComponent(n)}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
      queue.current = sent.catch(() => {});
      return sent;
    },
    [n],
  );

  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setSave((s) => (s.kind === "saved" ? { kind: "idle" } : s));
    const t = setTimeout(() => {
      send("PUT", { edits })
        .then((r) => setAutosaveError(r.ok ? null : r.status === 409 ? STALE : "Autosave failed. Your latest changes are not saved yet."))
        .catch(() => setAutosaveError("Autosave failed. Is the dashboard still running?"));
    }, 500);
    return () => clearTimeout(t);
  }, [edits, send]);

  const saveForApply = useCallback(async () => {
    setSave({ kind: "saving" });
    try {
      const r = await send("POST", { op: "save", edits });
      const body = (await r.json()) as { pdf?: string; indexed?: boolean; warnings?: string[]; error?: string };
      setSave(r.ok && body.pdf ? { kind: "saved", pdf: body.pdf, indexed: body.indexed === true, warnings: body.warnings ?? [] } : { kind: "failed", error: SAVE_ERRORS[body.error ?? ""] ?? body.error ?? "Saving failed." });
    } catch {
      setSave({ kind: "failed", error: "Saving failed. Is the dashboard still running?" });
    }
  }, [edits, send]);

  const changed = doc.sections.flatMap((s) => s.items.flatMap((i) => i.bullets)).filter((b) => b.change !== "same").length;

  return (
    <>
      <header className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-faint">CV Studio</p>
          <h1 className="mt-1 font-display text-3xl tracking-tight text-landing">{data.company}</h1>
          <p className="mt-1 text-sm text-muted">
            {changed} {changed === 1 ? "change" : "changes"} from your base CV. Review each one, then save the version you will send.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented label="Length" value={edits.preset.length} options={[["full", "Full"], ["one-page", "One page"]]} onChange={(v) => dispatch({ type: "preset", preset: { length: v as "full" | "one-page" } })} />
          <Segmented label="Tone" value={edits.preset.tone} options={[["tailored", "Tailored"], ["conservative", "Conservative"]]} onChange={(v) => dispatch({ type: "preset", preset: { tone: v as "tailored" | "conservative" } })} />
          <button onClick={() => dispatch({ type: "reset" })} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:border-brand/40 hover:text-brand">
            <RotateCcw className="size-3.5" /> Reset
          </button>
          <button
            onClick={saveForApply}
            disabled={save.kind === "saving"}
            className="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-1.5 text-sm font-medium text-brand-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {save.kind === "saving" ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Save for apply
          </button>
        </div>
      </header>

      {data.stale && <Notice tone="warn">This CV was regenerated since your last visit, so earlier edits were cleared.</Notice>}
      {!data.hasBase && <Notice tone="warn">No cv.md found, so changes cannot be compared with your base CV.</Notice>}
      {save.kind === "saved" && (
        <Notice tone={save.indexed ? "ok" : "warn"}>
          {save.indexed ? (
            <>
              Saved. Apply now uploads this version.{" "}
              <a href={`/api/cv-pdf?n=${encodeURIComponent(data.reportNum)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium underline">
                <FileText className="size-3.5" /> Open {save.pdf}
              </a>
            </>
          ) : (
            <>Saved {save.pdf}, but data/pdf-index.tsv was not updated, so Apply still uploads the earlier PDF.</>
          )}
          {save.warnings.filter((w) => !/cv-facts\.json/.test(w)).map((w) => (
            <span key={w} className="mt-1 block text-xs opacity-80">{w}</span>
          ))}
        </Notice>
      )}
      {save.kind === "failed" && <Notice tone="error">{save.error}</Notice>}
      {autosaveError && <Notice tone="error">{autosaveError}</Notice>}

      <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
        <div className="space-y-4">
          <CoverageMeter coverage={resolved.coverage} dropped={dropped} />
          {arrange(doc.sections, edits.order.root).map((s, k, all) => (
            <SectionCard key={s.id} n={n} section={s} edits={edits} hidden={resolved.view.hidden} dispatch={dispatch} siblings={all.map((x) => x.id)} first={k === 0} last={k === all.length - 1} />
          ))}
        </div>
        <div className="lg:sticky lg:top-4 lg:self-start">
          <CvPreview html={html} />
        </div>
      </div>
    </>
  );
}

function Segmented({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-full border border-border p-0.5">
      {options.map(([v, text]) => (
        <button
          key={v}
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={cn("rounded-full px-3 py-1 text-xs transition-colors", value === v ? "bg-brand-soft font-medium text-brand" : "text-muted hover:text-foreground")}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function Notice({ tone, children }: { tone: "ok" | "warn" | "error"; children: React.ReactNode }) {
  const styles = {
    ok: "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
    warn: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300",
    error: "border-red-500/40 bg-red-500/10 text-red-800 dark:text-red-300",
  }[tone];
  return <div role={tone === "error" ? "alert" : "status"} className={cn("mt-4 rounded-xl border px-4 py-2.5 text-sm", styles)}>{children}</div>;
}
