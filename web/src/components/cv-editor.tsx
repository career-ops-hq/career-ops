"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { SkillGaps } from "@/components/skill-gaps";
import remarkGfm from "remark-gfm";
import { Check, Loader2, Upload } from "lucide-react";
import { cn } from "@/lib/cn";
import { CvIngest } from "@/components/cv/cv-ingest";

export function CvEditor() {
  const [content, setContent] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [exists, setExists] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importSaving, setImportSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/cv")
      .then((r) => {
        if (!r.ok) throw new Error("Couldn't load cv.md. Reload the page to try again.");
        return r.json();
      })
      .then((d) => {
        setContent(d.content ?? "");
        setExists(d.exists ?? false);
      })
      .then(() => setLoaded(true))
      .catch((e) => setError(e.message));
  }, []);

  async function save() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/cv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        const result = await res.json().catch(() => ({}));
        throw new Error(result.error || "Couldn't save your CV. Try again.");
      }
      setDirty(false);
      setExists(true);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      // Refresh the skill gaps that read cv.md.
      window.dispatchEvent(new CustomEvent("co-cv-saved"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save your CV. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl tracking-tight text-landing">CV editor</h1>
          <p className="mt-1 text-sm text-muted">
            Edit <code className="text-foreground">cv.md</code> with live preview.
            {!exists && loaded && <span className="ml-1 text-faint">No cv.md yet — start typing to create it.</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!loaded || saving || importSaving}
            aria-expanded={importing}
            aria-controls="cv-import"
            onClick={() => {
              setSaved(false);
              setImporting(!importing);
            }}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-brand/40 hover:text-brand-text disabled:opacity-50 max-sm:min-h-[44px]"
          >
            <Upload className="size-4" /> {importing ? "Close upload" : "Upload PDF / TeX"}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || !dirty || importing}
            className={cn(
              "inline-flex items-center justify-center gap-2 rounded-full px-5 py-2 text-sm font-medium transition-colors max-sm:min-h-[44px]",
              dirty
                ? "bg-brand text-brand-foreground hover:bg-brand-200"
                : "border border-border bg-surface text-muted",
            )}
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : saved ? <Check className="size-4" /> : null}
            {saved ? "Saved" : "Save"}
          </button>
        </div>
      </div>

      {error && <p role="alert" className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {saved && <p role="status" className="mt-3 text-sm text-muted">cv.md updated.</p>}
      {importing && <section id="cv-import" aria-label="Import CV" className="mt-6">
        <p className="mb-3 text-sm text-muted">Upload your CV, review the conversion, then update cv.md.{dirty && " Your unsaved edits stay in the editor until you update."}</p>
        <CvIngest variant="editor" onSavingChange={setImportSaving} onSaved={(markdown) => {
          setContent(markdown);
          setDirty(false);
          setExists(true);
          setImporting(false);
          setImportSaving(false);
          setSaved(true);
          setError("");
          setTimeout(() => setSaved(false), 4000);
        }} />
      </section>}

      {!loaded ? (
        <div className="mt-6 text-sm text-muted">{error ? "Reload the page to load your CV." : "Loading…"}</div>
      ) : (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <textarea
            aria-label="CV Markdown"
            disabled={importing || saving}
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              setDirty(true);
              setSaved(false);
            }}
            spellCheck={false}
            placeholder="# Your Name&#10;&#10;## Summary&#10;..."
            className="min-h-[60vh] w-full resize-none rounded-2xl border border-border bg-surface/50 p-4 font-mono text-sm leading-relaxed outline-none transition-colors placeholder:text-faint focus:border-brand/40"
          />
          <article className="report-prose min-h-[60vh] [&_p]:whitespace-pre-line overflow-auto rounded-2xl border border-border bg-surface/30 p-5">
            {content.trim() ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
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
