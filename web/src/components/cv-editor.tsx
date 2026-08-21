"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Award, Check, ChevronDown, ChevronUp, Copy, Download, FileText, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";

import { evaluateCvAts } from "@/lib/ats-scorer";

export function CvEditor() {
  const [content, setContent] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [exists, setExists] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showAtsDetails, setShowAtsDetails] = useState(true);

  const ats = evaluateCvAts(content);

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
    a.download = "cv.md";
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
            Edit <code className="text-foreground">cv.md</code> with live preview and genuine ATS score verification.
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

      {/* Genuine Real-Time ATS Score Card */}
      {loaded && (
        <div className="mt-6 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex size-12 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400 font-display text-xl font-bold border border-emerald-500/20">
                {ats.totalScore}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-emerald-400">ATS Score: {ats.totalScore} / 100</span>
                  <span className="rounded-md bg-emerald-500/20 px-2 py-0.5 text-xs font-bold text-emerald-300">Grade: {ats.grade}</span>
                  <span className="rounded-md border border-border bg-surface px-2 py-0.5 text-xs text-muted">{ats.rating}</span>
                </div>
                <p className="text-xs text-muted mt-0.5">
                  Calculated in real-time for Workday, Greenhouse, Lever, Ashby, Taleo & iCIMS.
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
            <div
              className="h-full rounded-full bg-emerald-500 transition-all duration-500"
              style={{ width: `${ats.totalScore}%` }}
            />
          </div>

          {/* Audit Details */}
          {showAtsDetails && (
            <div className="mt-5 space-y-4 border-t border-emerald-500/20 pt-4 text-xs">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div className="rounded-xl border border-border/80 bg-surface/50 p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-muted">Structure & Hierarchy</span>
                    <span className="font-mono font-bold text-emerald-400">{ats.breakdown.structure.score} / {ats.breakdown.structure.max}</span>
                  </div>
                  <p className="mt-1 text-faint">{ats.breakdown.structure.details}</p>
                </div>
                <div className="rounded-xl border border-border/80 bg-surface/50 p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-muted">Contact & Work Rights</span>
                    <span className="font-mono font-bold text-emerald-400">{ats.breakdown.contact.score} / {ats.breakdown.contact.max}</span>
                  </div>
                  <p className="mt-1 text-faint">{ats.breakdown.contact.details}</p>
                </div>
                <div className="rounded-xl border border-border/80 bg-surface/50 p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-muted">Keyword Density</span>
                    <span className="font-mono font-bold text-emerald-400">{ats.breakdown.keywords.score} / {ats.breakdown.keywords.max}</span>
                  </div>
                  <p className="mt-1 text-faint">{ats.breakdown.keywords.details}</p>
                </div>
                <div className="rounded-xl border border-border/80 bg-surface/50 p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-muted">Action Verbs</span>
                    <span className="font-mono font-bold text-emerald-400">{ats.breakdown.actionVerbs.score} / {ats.breakdown.actionVerbs.max}</span>
                  </div>
                  <p className="mt-1 text-faint">{ats.breakdown.actionVerbs.details}</p>
                </div>
                <div className="rounded-xl border border-border/80 bg-surface/50 p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-muted">Quantified Metrics</span>
                    <span className="font-mono font-bold text-emerald-400">{ats.breakdown.metrics.score} / {ats.breakdown.metrics.max}</span>
                  </div>
                  <p className="mt-1 text-faint">{ats.breakdown.metrics.details}</p>
                </div>
                <div className="rounded-xl border border-border/80 bg-surface/50 p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-muted">Typography & Layout</span>
                    <span className="font-mono font-bold text-emerald-400">{ats.breakdown.layout.score} / {ats.breakdown.layout.max}</span>
                  </div>
                  <p className="mt-1 text-faint">{ats.breakdown.layout.details}</p>
                </div>
              </div>

              {/* Role Match Readiness */}
              <div className="rounded-xl border border-border bg-surface/40 p-3">
                <span className="font-semibold text-muted">Target Role Match Readiness:</span>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4 font-mono text-xs">
                  <div className="rounded-lg bg-background/60 p-2 text-center">
                    <span className="text-faint text-[10px] block">IT Support</span>
                    <span className="font-bold text-emerald-400">{ats.roleMatches.itSupport}%</span>
                  </div>
                  <div className="rounded-lg bg-background/60 p-2 text-center">
                    <span className="text-faint text-[10px] block">Helpdesk</span>
                    <span className="font-bold text-emerald-400">{ats.roleMatches.helpdesk}%</span>
                  </div>
                  <div className="rounded-lg bg-background/60 p-2 text-center">
                    <span className="text-faint text-[10px] block">SysAdmin</span>
                    <span className="font-bold text-emerald-400">{ats.roleMatches.sysAdmin}%</span>
                  </div>
                  <div className="rounded-lg bg-background/60 p-2 text-center">
                    <span className="text-faint text-[10px] block">Cloud Support</span>
                    <span className="font-bold text-emerald-400">{ats.roleMatches.cloudSupport}%</span>
                  </div>
                </div>
              </div>

              {/* Suggestions if any */}
              {ats.suggestions.length > 0 && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
                  <span className="font-semibold text-amber-400">Optimization Suggestions:</span>
                  <ul className="mt-1 list-disc list-inside space-y-0.5 text-muted">
                    {ats.suggestions.map((s, idx) => (
                      <li key={idx}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}
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
