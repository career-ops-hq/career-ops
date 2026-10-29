"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, FileText, Loader2, RotateCcw, Undo2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { arrange, renderBlocks, type BlockTree } from "@/lib/cv-studio/html-blocks.mjs";
import { applyRecordedEdit, emptyEdits, isStudioUndoKey, resolveStudio, studioReducer, type StudioAction, type StudioDoc, type StudioEdits } from "@/lib/cv-studio/studio.mjs";
import { editSaveStatus, inflightEdits, postWroteEdits, shouldSendEdits } from "@/lib/cv-studio/put-order.mjs";
import { SectionCard } from "./section-card";
import { CvPreview } from "./cv-preview";
import { CoverageMeter } from "./coverage-meter";

type Loaded = { ok: true; reportNum: string; company: string; file: string; tree: BlockTree; doc: StudioDoc; edits: StudioEdits; stale: boolean; hasBase: boolean };
type LoadState = { kind: "loading" } | { kind: "error"; reason: string } | { kind: "ready"; data: Loaded };
type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; pdf: string; indexed: boolean; warnings: string[] }
  | { kind: "outdated"; pdf: string }
  | { kind: "failed"; error: string };

const REASONS: Record<string, { title: string; body: string }> = {
  "no-tailored-cv": { title: "No tailored CV yet", body: "Generate a tailored CV from the report page first. The Studio opens it for review once it exists." },
  "unreadable-layout": { title: "This CV layout is not supported yet", body: "The Studio reads CVs built from the career-ops templates. Open the PDF from the report page instead." },
  "no-report": { title: "Report not found", body: "There is no evaluation report with this number." },
};

const STALE = "This CV was regenerated in another tab. Reload the Studio.";
const KEEPALIVE_BYTES = 60_000;
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
      <Link href={`/pipeline/${n}`} className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-brand-text">
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
  const [edits, dispatchEdit] = useReducer((e: StudioEdits, a: StudioAction) => studioReducer(e, a, doc), data.edits);
  const history = useRef<StudioEdits[]>([]);
  const editsRef = useRef(edits);
  const [canUndo, setCanUndo] = useState(false);
  // Handlers set these before dispatch. This effect stores the committed
  // objects. A discarded render must not write them, or a save can send an edit that was undone.
  const latestEdits = useRef(edits);
  useLayoutEffect(() => {
    latestEdits.current = edits;
    editsRef.current = edits;
  }, [edits]);
  const recordEdit = useCallback((action: StudioAction) => {
    const applied = applyRecordedEdit(latestEdits.current, action, doc, history.current);
    if (!applied.recorded) return;
    history.current = applied.history;
    latestEdits.current = applied.edits;
    editsRef.current = applied.edits;
    setCanUndo(true);
    dispatchEdit(action);
  }, [doc]);
  const undo = useCallback(() => {
    const prev = history.current.pop();
    setCanUndo(history.current.length > 0);
    if (!prev) return;
    latestEdits.current = prev;
    editsRef.current = prev;
    dispatchEdit({ type: "replace", edits: prev });
  }, []);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [autosaveError, setAutosaveError] = useState<string | null>(null);
  const resolved = useMemo(() => resolveStudio(doc, edits), [doc, edits]);
  const html = useMemo(() => renderBlocks(tree, resolved.view, { added: resolved.added }), [tree, resolved]);
  const tailoredPresent = useMemo(() => resolveStudio(doc, emptyEdits(doc.sourceHash)).coverage.present, [doc]);
  const dropped = tailoredPresent.filter((k) => resolved.coverage.missing.includes(k));

  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const send = useCallback(
    (method: "PUT" | "POST", body: object, keepalive = false) => {
      const payload = JSON.stringify(body);
      const bytes = new TextEncoder().encode(payload).length;
      const start = () =>
        fetch(`/api/cv-studio/${encodeURIComponent(n)}`, {
          method,
          headers: { "Content-Type": "application/json" },
          body: payload,
          keepalive: keepalive && bytes < KEEPALIVE_BYTES,
        });
      // A keepalive request is the page-exit flush. It starts now: queued
      // behind an autosave, it might never start before the page is gone.
      // The server drops it if an older PUT from this tab lands after it.
      const sent = keepalive ? start() : queue.current.then(start);
      queue.current = Promise.all([queue.current, sent]).catch(() => {});
      return sent;
    },
    [n],
  );

  const savedJsonRef = useRef(JSON.stringify(data.edits));
  const savingJsonRef = useRef<string | null>(null);
  const postingJsonRef = useRef<string | null>(null);
  const tabRef = useRef(Math.random().toString(36).slice(2, 12));
  const revRef = useRef(0);
  const [, rerender] = useState(0);
  const showStatus = useCallback(() => rerender((n) => n + 1), []);

  const putEdits = useCallback(
    (payload: StudioEdits, keepalive: boolean) => {
      const serialized = JSON.stringify(payload);
      const inflight = inflightEdits(savingJsonRef.current, postingJsonRef.current, serialized);
      if (!shouldSendEdits(savedJsonRef.current, serialized, inflight, keepalive)) return;
      savingJsonRef.current = serialized;
      showStatus();
      revRef.current += 1;
      send("PUT", { edits: payload, tab: tabRef.current, rev: revRef.current }, keepalive)
        .then((r) => {
          if (savingJsonRef.current !== serialized) return;
          savingJsonRef.current = null;
          if (!r.ok) {
            setAutosaveError(r.status === 409 ? STALE : "Autosave failed. Your latest changes are not saved yet.");
            showStatus();
            return;
          }
          // The server now holds this payload. If the edits moved on, even back
          // to what was saved before it, send them.
          const latest = JSON.stringify(editsRef.current);
          setAutosaveError(null);
          savedJsonRef.current = serialized;
          if (latest !== serialized) putEdits(editsRef.current, keepalive);
          showStatus();
        })
        .catch(() => {
          if (savingJsonRef.current === serialized) savingJsonRef.current = null;
          setAutosaveError("Autosave failed. Is the dashboard still running?");
          showStatus();
        });
    },
    [showStatus, send],
  );

  useEffect(() => {
    const flush = () => putEdits(editsRef.current, true);
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [putEdits]);

  useEffect(() => {
    const serialized = JSON.stringify(edits);
    if (serialized === savedJsonRef.current || serialized === savingJsonRef.current || serialized === postingJsonRef.current) return;
    setSave((s) => (s.kind === "saved" || s.kind === "outdated" ? { kind: "idle" } : s));
    const timer = setTimeout(() => putEdits(edits, false), 500);
    return () => clearTimeout(timer);
  }, [edits, putEdits]);

  const editsJson = JSON.stringify(edits);
  const editStatus = editSaveStatus(savedJsonRef.current, editsJson, savingJsonRef.current, postingJsonRef.current);

  const saveForApply = useCallback(async () => {
    setSave({ kind: "saving" });
    const sent = edits;
    const serialized = JSON.stringify(sent);
    // Save for apply writes this payload before it renders. Undo can put the
    // screen back while the request is still out, and the page-exit flush has
    // to see that payload or it will skip the restored edits.
    postingJsonRef.current = serialized;
    try {
      revRef.current += 1;
      const r = await send("POST", { op: "save", edits: sent, tab: tabRef.current, rev: revRef.current });
      const body = (await r.json()) as { pdf?: string; indexed?: boolean; warnings?: string[]; error?: string; superseded?: boolean };
      const wrote = postWroteEdits(r.status, body.superseded === true);
      if (postingJsonRef.current === serialized) postingJsonRef.current = null;
      if (wrote) {
        savedJsonRef.current = serialized;
        if (JSON.stringify(editsRef.current) !== serialized) putEdits(editsRef.current, false);
      }
      if (body.superseded) {
        setSave({ kind: "failed", error: "A newer edit was saved while this one was sending. Save again to export the latest." });
        return;
      }
      if (!r.ok || !body.pdf) {
        setSave({ kind: "failed", error: SAVE_ERRORS[body.error ?? ""] ?? body.error ?? "Saving failed." });
      } else if (latestEdits.current !== sent) {
        setSave({ kind: "outdated", pdf: body.pdf });
      } else {
        setSave({ kind: "saved", pdf: body.pdf, indexed: body.indexed === true, warnings: body.warnings ?? [] });
      }
    } catch {
      // The response never arrived. The server may already have stored this
      // payload. Send the screen while that payload is still in flight, or an
      // undo back to the saved CV is skipped on the way out of the page.
      const latest = editsRef.current;
      if (JSON.stringify(latest) !== serialized) putEdits(latest, true);
      if (postingJsonRef.current === serialized) postingJsonRef.current = null;
      setSave({ kind: "failed", error: "Saving failed. Is the dashboard still running?" });
    }
  }, [edits, putEdits, send]);

  useEffect(() => {
    const undoShortcut = (event: KeyboardEvent) => {
      if (!isStudioUndoKey(event)) return;
      const target = event.target;
      if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement || (target instanceof HTMLElement && target.isContentEditable)) return;
      event.preventDefault();
      undo();
    };
    window.addEventListener("keydown", undoShortcut);
    return () => window.removeEventListener("keydown", undoShortcut);
  }, [undo]);

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
          <Segmented label="Length" value={edits.preset.length} options={[["full", "Full"], ["one-page", "One page"]]} onChange={(v) => recordEdit({ type: "preset", preset: { length: v as "full" | "one-page" } })} />
          <Segmented label="Tone" value={edits.preset.tone} options={[["tailored", "Tailored"], ["conservative", "Conservative"]]} onChange={(v) => recordEdit({ type: "preset", preset: { tone: v as "tailored" | "conservative" } })} />
          <button type="button" onClick={undo} disabled={!canUndo} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:border-brand/40 hover:text-brand-text disabled:opacity-40">
            <Undo2 className="size-3.5" /> Undo
          </button>
          <button onClick={() => recordEdit({ type: "reset" })} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:border-brand/40 hover:text-brand-text">
            <RotateCcw className="size-3.5" /> Reset
          </button>
          <p role="status" className="text-xs text-muted">{editStatus}</p>
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
      {save.kind === "outdated" && (
        <Notice tone="warn">Saved {save.pdf} from the CV as it was when you clicked Save. You changed it since, so Save for apply again before you apply.</Notice>
      )}
      {save.kind === "failed" && <Notice tone="error">{save.error}</Notice>}
      {autosaveError && <Notice tone="error">{autosaveError}</Notice>}

      <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
        <div className="space-y-4">
          <CoverageMeter coverage={resolved.coverage} dropped={dropped} />
          {arrange(doc.sections, edits.order.root).map((s, k, all) => (
            <SectionCard key={s.id} n={n} section={s} edits={edits} hidden={resolved.view.hidden} dispatch={recordEdit} siblings={all.map((x) => x.id)} first={k === 0} last={k === all.length - 1} />
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
          className={cn("rounded-full px-3 py-1 text-xs transition-colors", value === v ? "bg-brand-soft font-medium text-brand-text" : "text-muted hover:text-foreground")}
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
