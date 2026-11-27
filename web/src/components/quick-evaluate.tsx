"use client";

import { useState } from "react";
import { Loader2, Plus, Sparkles } from "lucide-react";
import { useJobs } from "@/components/jobs/job-store";
import { CostBadge } from "@/components/cost/cost-badge";
import { EvaluationOptions, useEvaluationOptions } from "@/components/evaluation-options";
import { FULL_EVALUATION } from "@/lib/evaluation-options.mjs";

const URL_HINT = "Paste a full job-posting URL (https://…).";

// Auto-pipeline, one click: paste a job URL → fire a real evaluation worker
// (the same kind:"evaluate" that runs modes/oferta.md + writes the A–F report +
// tracker row). The worker pills + assistant cards show progress.
//
// "Add to pipeline" is the other answer to a pasted URL: record it in the Inbox
// (data/pipeline.md, plus jds/ when a JD is pasted) through the core's
// capture-jd.mjs and do nothing else — no worker, no tokens. It never calls
// startJob; Evaluate stays a separate, deliberate click.
export function QuickEvaluate() {
  const { startJob } = useJobs();
  const [url, setUrl] = useState("");
  const [jdText, setJdText] = useState("");
  const [hint, setHint] = useState("");
  const [hintLink, setHintLink] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const { sections, setSections } = useEvaluationOptions();

  function say(text: string, link = false) {
    setHint(text);
    setHintLink(link);
  }

  function run() {
    const u = url.trim();
    if (!/^https?:\/\//i.test(u)) {
      say(URL_HINT);
      return;
    }
    startJob({ title: "Evaluate · pasted URL", subtitle: u, kind: "evaluate", input: u, page: "/", evaluationSections: sections });
    setUrl("");
    say("Evaluating — watch it in the Workers tray.");
  }

  async function capture() {
    const u = url.trim();
    if (!/^https?:\/\//i.test(u)) {
      say(URL_HINT);
      return;
    }
    setCapturing(true);
    try {
      const res = await fetch("/api/pipeline/capture", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: u, text: jdText }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok: true; appended: boolean; duplicate: boolean; hasText: boolean }
        | { ok: false; error?: string }
        | null;
      if (!data || !data.ok) {
        say((data && !data.ok && data.error) || "Could not add it to the pipeline.");
        return;
      }
      setUrl("");
      setJdText("");
      if (data.duplicate) say("Already in your pipeline — nothing changed.", true);
      else say(`Added to pipeline — not evaluated${data.hasText ? ", job description saved" : ""}.`, true);
    } catch {
      say("Could not reach career-ops to add it to the pipeline.");
    } finally {
      setCapturing(false);
    }
  }

  return (
    <div className="mt-7">
      <div className="flex max-w-xl items-center gap-2 rounded-full border border-border bg-surface/70 py-1.5 pl-4 pr-1.5 shadow-sm focus-within:border-brand/50">
        <Sparkles className="size-4 shrink-0 text-brand-text/70" />
        <input
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            if (hint) say("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !capturing) run();
          }}
          placeholder="Paste a job URL to evaluate…"
          aria-label="Job posting URL"
          // Read-only while a capture is in flight: its success clears both
          // fields, which would otherwise erase a posting typed meanwhile.
          readOnly={capturing}
          className="min-w-0 flex-1 bg-transparent py-1.5 text-sm outline-none placeholder:text-faint"
        />
        <button
          type="button"
          onClick={capture}
          disabled={capturing}
          title="Saves the posting to your Inbox. No evaluation, no tokens. Evaluate it later from the Pipeline."
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:border-brand/40 hover:text-brand-text disabled:opacity-60"
        >
          {capturing ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
          <span className="max-sm:sr-only">Add to pipeline</span>
        </button>
        <button
          type="button"
          onClick={run}
          disabled={capturing}
          className="shrink-0 rounded-full bg-brand px-4 py-1.5 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-200 disabled:opacity-60"
        >
          Evaluate
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <CostBadge kind="spend" size="xs" />
        <span className="text-xs text-faint">Evaluation runs on your own AI — your key, your machine.</span>
        <span className="text-xs text-faint">Add to pipeline only saves it: no evaluation, no tokens.</span>
      </div>
      {hint && (
        <p className="mt-1 text-xs text-faint" role="status">
          {hint}
          {hintLink && (
            <>
              {" "}
              <a href="/pipeline" className="text-brand-text hover:underline">Open the pipeline</a>
            </>
          )}
        </p>
      )}
      <details className="mt-3 max-w-xl">
        <summary className="cursor-pointer text-xs text-brand-text">Paste the job description (optional, for Add to pipeline)</summary>
        <textarea
          value={jdText}
          onChange={(e) => setJdText(e.target.value)}
          rows={5}
          placeholder="Saved with the posting so a later evaluation can reuse it without opening a browser."
          aria-label="Job description text"
          readOnly={capturing}
          className="mt-2 w-full rounded-lg border border-border bg-surface/70 p-2 text-xs outline-none focus:border-brand/50"
        />
      </details>
      <details className="mt-3 max-w-xl">
        <summary className="cursor-pointer text-xs text-brand-text">Evaluation options · {sections.length === FULL_EVALUATION.length ? "full evaluation" : `${sections.length} optional sections`}</summary>
        <div className="mt-3"><EvaluationOptions sections={sections} onChange={setSections} /></div>
      </details>
    </div>
  );
}
