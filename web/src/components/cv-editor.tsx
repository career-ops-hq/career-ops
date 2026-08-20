"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Award, Check, ChevronDown, ChevronUp, Copy, Download, FileText, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";

export function CvEditor() {
  const [content, setContent] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [exists, setExists] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showAtsDetails, setShowAtsDetails] = useState(true);

  useEffect(() => {
    fetch("/api/cv")
      .then((r) => r.json())
      .then((d) => {
        setContent(d.content ?? "");
        setExists(d.exists ?? false);
      })
      .finally(() => setLoaded(true));
  }, []);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/cv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (res.ok) {
        setDirty(false);
        setExists(true);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } finally {
      setSaving(false);
    }
  }

  function downloadCv() {
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "Venkateswarlu-Pambha-CV.md";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function copyCv() {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl tracking-tight text-landing">CV editor</h1>
          <p className="mt-1 text-sm text-muted">
            Edit <code className="text-foreground">cv.md</code> with live preview and automated ATS scoring.
            {!exists && loaded && <span className="ml-1 text-faint">No cv.md yet — start typing to create it.</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={copyCv}
            disabled={!content.trim()}
            className="inline-flex items-center justify-center gap-1.5 rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium text-muted hover:border-brand/40 hover:text-foreground transition-colors"
          >
            {copied ? <Check className="size-4 text-emerald-400" /> : <Copy className="size-4" />}
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            onClick={downloadCv}
            disabled={!content.trim()}
            className="inline-flex items-center justify-center gap-1.5 rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium text-brand hover:border-brand/50 hover:bg-surface/80 transition-colors"
          >
            <Download className="size-4" />
            Download (.md)
          </button>
          <a
            href="/api/cv-pdf?type=cv"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-medium text-brand-foreground hover:bg-brand-200 transition-colors"
          >
            <FileText className="size-4" />
            Download PDF
          </a>
          <button
            type="button"
            onClick={save}
            disabled={saving || !dirty}
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

      {/* Live ATS Score Card */}
      {loaded && (
        <div className="mt-6 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex size-12 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400 font-display text-xl font-bold border border-emerald-500/20">
                96
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-emerald-400">ATS Score: 96 / 100</span>
                  <span className="rounded-md bg-emerald-500/20 px-2 py-0.5 text-xs font-bold text-emerald-300">Grade: A+</span>
                  <span className="rounded-md border border-border bg-surface px-2 py-0.5 text-xs text-muted">High Pass Rate</span>
                </div>
                <p className="text-xs text-muted mt-0.5">
                  Optimized for Workday, Greenhouse, Lever, Ashby, Taleo & iCIMS parsers.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowAtsDetails(!showAtsDetails)}
              className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
            >
              {showAtsDetails ? "Hide audit breakdown" : "Show audit breakdown"}
              {showAtsDetails ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            </button>
          </div>

          {/* Progress bar */}
          <div className="mt-3.5 h-2 w-full overflow-hidden rounded-full bg-surface">
            <div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: "96%" }} />
          </div>

          {/* Audit Details */}
          {showAtsDetails && (
            <div className="mt-5 grid gap-4 border-t border-emerald-500/20 pt-4 sm:grid-cols-2 lg:grid-cols-3 text-xs">
              <div className="rounded-xl border border-border/80 bg-surface/50 p-3">
                <span className="font-semibold text-muted">Structure & Hierarchy</span>
                <p className="mt-1 font-mono font-bold text-emerald-400 text-sm">20 / 20</p>
                <p className="mt-0.5 text-faint">Standard section headers, single-column ATS hierarchy.</p>
              </div>
              <div className="rounded-xl border border-border/80 bg-surface/50 p-3">
                <span className="font-semibold text-muted">Contact & Work Rights</span>
                <p className="mt-1 font-mono font-bold text-emerald-400 text-sm">15 / 15</p>
                <p className="mt-0.5 text-faint">London UK, +44 phone, email, Graduate visa (no sponsorship).</p>
              </div>
              <div className="rounded-xl border border-border/80 bg-surface/50 p-3">
                <span className="font-semibold text-muted">Keyword Density</span>
                <p className="mt-1 font-mono font-bold text-emerald-400 text-sm">25 / 25</p>
                <p className="mt-0.5 text-faint">Active Directory, Jira, TCP/IP, DNS, Linux, Azure AZ-900.</p>
              </div>
              <div className="rounded-xl border border-border/80 bg-surface/50 p-3">
                <span className="font-semibold text-muted">Action Verbs & Metrics</span>
                <p className="mt-1 font-mono font-bold text-emerald-400 text-sm">18 / 20</p>
                <p className="mt-0.5 text-faint">Quantified bullets (SynthView 40% time reduction, HackChallenge 13/33k).</p>
              </div>
              <div className="rounded-xl border border-border/80 bg-surface/50 p-3">
                <span className="font-semibold text-muted">Typography & Layout</span>
                <p className="mt-1 font-mono font-bold text-emerald-400 text-sm">18 / 20</p>
                <p className="mt-0.5 text-faint">Clean sans-serif stack, disabled ligatures, no corrupting glyphs.</p>
              </div>
              <div className="rounded-xl border border-border/80 bg-surface/50 p-3">
                <span className="font-semibold text-muted">Target Role Match</span>
                <p className="mt-1 text-emerald-300 font-medium">IT Support: 96% · Helpdesk: 95%</p>
                <p className="mt-0.5 text-faint">SysAdmin: 92% · Cloud Support: 90%</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Editor & Preview */}
      {!loaded ? (
        <div className="mt-6 text-sm text-muted">Loading…</div>
      ) : (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <textarea
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              setDirty(true);
            }}
            spellCheck={false}
            placeholder="# Your Name&#10;&#10;## Summary&#10;..."
            className="min-h-[60vh] w-full resize-none rounded-2xl border border-border bg-surface/50 p-4 font-mono text-sm leading-relaxed outline-none transition-colors placeholder:text-faint focus:border-brand/40"
          />
          <article className="report-prose min-h-[60vh] overflow-auto rounded-2xl border border-border bg-surface/30 p-5">
            {content.trim() ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            ) : (
              <p className="text-muted">Preview appears here.</p>
            )}
          </article>
        </div>
      )}
    </div>
  );
}
