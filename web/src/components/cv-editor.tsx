"use client";

import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { SkillGaps } from "@/components/skill-gaps";
import remarkGfm from "remark-gfm";
import { Check, Loader2, Upload } from "lucide-react";
import { cn } from "@/lib/cn";
import { CvIngest } from "@/components/cv/cv-ingest";
import {
  cvSaveUsesKeepalive,
  draftChange,
  draftFromStore,
  editorReducer,
  editorStatus,
  initialEditor,
  followUpJob,
  saveFollowUp,
  shouldSave,
} from "@/lib/cv-editor-state.mjs";

const DRAFT_KEY = "career-ops.cv-draft";
const AUTOSAVE_MS = 600;

function readDraft() {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    return draftFromStore(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function CvEditor() {
  const [state, dispatch] = useReducer(editorReducer, initialEditor());
  const [importing, setImporting] = useState(false);
  const [importSaving, setImportSaving] = useState(false);
  const stateRef = useRef(state);
  const snapshotPriorRef = useRef(true);
  const runningRef = useRef(false);
  const pendingRef = useRef<{ text: string; keepalive: boolean } | null>(null);
  useLayoutEffect(() => {
    stateRef.current = state;
    if (state.snapshotPrior) snapshotPriorRef.current = true;
  }, [state]);

  const pump = useCallback((confirmed?: { content: string; exists: boolean }) => {
    if (runningRef.current) return;
    const job = pendingRef.current;
    const current = stateRef.current;
    const base = confirmed ?? { content: current.saved, exists: current.exists };
    if (!job || current.phase !== "ready" || job.text !== current.content || job.text === base.content) {
      pendingRef.current = null;
      return;
    }
    pendingRef.current = null;
    runningRef.current = true;
    const snapshot = job.text;
    const backup = snapshotPriorRef.current;
    const expected = { content: base.content, exists: base.exists };
    dispatch({ type: "save-start", content: snapshot });
    const payload = { content: snapshot, backup, expected };
    fetch("/api/cv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: cvSaveUsesKeepalive(job.keepalive, payload),
    })
      .then(async (res) => {
        runningRef.current = false;
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          dispatch({
            type: "save-failed",
            content: snapshot,
            error: body.error || "Could not save. Your text is still in this tab.",
            conflict: res.status === 409,
          });
          return;
        }
        if (backup) snapshotPriorRef.current = false;
        dispatch({ type: "save-ok", content: snapshot });
        window.dispatchEvent(new CustomEvent("co-cv-saved"));
        const follow = saveFollowUp(stateRef.current, snapshot);
        if (follow) {
          pendingRef.current = followUpJob(job, pendingRef.current, follow.text);
          pump(follow.expected);
        }
      })
      .catch(() => {
        runningRef.current = false;
        dispatch({
          type: "save-failed",
          content: snapshot,
          error: "Could not save. Your text is still in this tab.",
        });
      });
  }, []);

  const startSave = useCallback((keepalive = false) => {
    const current = stateRef.current;
    if (current.phase !== "ready" || current.content === current.saved) return;
    pendingRef.current = { text: current.content, keepalive };
    pump();
  }, [pump]);

  useEffect(() => {
    let live = true;
    fetch("/api/cv")
      .then(async (res) => {
        if (!res.ok) throw new Error("load failed");
        return res.json() as Promise<{ content?: unknown; exists?: unknown }>;
      })
      .then((data) => {
        if (!live) return;
        dispatch({
          type: "loaded",
          content: typeof data.content === "string" ? data.content : "",
          exists: data.exists === true,
          draft: readDraft(),
        });
      })
      .catch(() => {
        if (!live) return;
        dispatch({
          type: "load-failed",
          error: "The CV could not be loaded. Reload the page before editing, so an empty page cannot replace it.",
        });
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const draft = draftChange(state);
    if (draft === undefined) return;
    try {
      if (!draft) sessionStorage.removeItem(DRAFT_KEY);
      else sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch (error) {
      if (!(error instanceof DOMException)) throw error;
    }
  }, [state]);

  useEffect(() => {
    const flush = () => startSave(true);
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [startSave]);

  useEffect(() => {
    if (importing || !shouldSave(state)) return;
    const timer = setTimeout(() => startSave(false), AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [state, startSave, importing]);

  const status = editorStatus(state);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl tracking-tight text-landing">CV editor</h1>
          <p className="mt-1 text-sm text-muted">
            Edit <code className="text-foreground">cv.md</code> with live preview.
            {state.phase === "ready" && !state.exists && state.content === "" && (
              <span className="ml-1 text-faint">No cv.md yet — start typing to create it.</span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={state.phase !== "ready" || importSaving || state.inflight !== null || state.conflict}
            aria-expanded={importing}
            aria-controls="cv-import"
            onClick={() => setImporting(!importing)}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-brand/40 hover:text-brand-text disabled:opacity-50 max-sm:min-h-[44px]"
          >
            <Upload className="size-4" /> {importing ? "Close upload" : "Upload PDF / TeX"}
          </button>
          <p role="status" className="text-sm text-muted">
            {status.label}
          </p>
          <button
            type="button"
            onClick={() => startSave(false)}
            disabled={!status.canSave || importing}
            className={cn(
              "inline-flex items-center justify-center gap-2 rounded-full px-5 py-2 text-sm font-medium transition-colors max-sm:min-h-[44px]",
              status.canSave && !importing
                ? "bg-brand text-brand-foreground hover:bg-brand-200"
                : "border border-border bg-surface text-muted",
            )}
          >
            {status.label === "Saving" ? <Loader2 className="size-4 animate-spin" /> : status.label === "Saved" ? <Check className="size-4" /> : null}
            Save
          </button>
        </div>
      </div>

      {state.error && (
        <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">
          {state.error}
          {state.conflict && " Reloading drops this text, because the file changed."}
        </p>
      )}

      {importing && state.phase === "ready" && !state.conflict && (
        <section id="cv-import" aria-label="Import CV" className="mt-6">
          <p className="mb-3 text-sm text-muted">
            Upload your CV, review the conversion, then update cv.md.
            {state.content !== state.saved && " Your unsaved edits stay in the editor until you update."}
          </p>
          <CvIngest
            variant="editor"
            onSavingChange={setImportSaving}
            onSaved={(markdown) => {
              if (stateRef.current.conflict) return;
              dispatch({ type: "imported", content: markdown });
              setImporting(false);
              setImportSaving(false);
            }}
          />
        </section>
      )}

      {state.phase === "loading" ? (
        <div className="mt-6 text-sm text-muted">Loading…</div>
      ) : state.phase === "load-error" ? null : (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <textarea
            aria-label="CV Markdown"
            disabled={importing}
            value={state.content}
            onChange={(e) => dispatch({ type: "edit", content: e.target.value })}
            spellCheck={false}
            placeholder="# Your Name&#10;&#10;## Summary&#10;..."
            className="min-h-[60vh] w-full resize-none rounded-2xl border border-border bg-surface/50 p-4 font-mono text-sm leading-relaxed outline-none transition-colors placeholder:text-faint focus:border-brand/40"
          />
          <article className="report-prose min-h-[60vh] [&_p]:whitespace-pre-line overflow-auto rounded-2xl border border-border bg-surface/30 p-5">
            {state.content.trim() ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{state.content}</ReactMarkdown>
            ) : (
              <p className="text-muted">Preview appears here.</p>
            )}
          </article>
        </div>
      )}

      {/* Below the editor: the gaps are context for what to write next, and they
          belong after the document rather than competing with it. */}
      <SkillGaps />
    </div>
  );
}
