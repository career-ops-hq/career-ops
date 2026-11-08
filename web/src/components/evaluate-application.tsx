"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Sparkles } from "lucide-react";
import { useJobs } from "@/components/jobs/job-store";
import { EvaluationOptions, useEvaluationOptions } from "@/components/evaluation-options";
import { FULL_EVALUATION } from "@/lib/evaluation-options.mjs";
import { postingHref } from "@/lib/posting-url.mjs";

export type EvaluationState = { kind: "none" | "partial" | "full" | "missing"; sections: string[] };

/** Evaluation belongs to a job, independently of its workflow status. */
export function EvaluateApplication({ n, company, role, url, evaluation = { kind: "none", sections: [] } }: {
  n: string; company: string; role: string; url: string; evaluation?: EvaluationState;
}) {
  const router = useRouter();
  const { jobs, startJob } = useJobs();
  const { sections, setSections } = useEvaluationOptions();
  const [chosen, setChosen] = useState<string[]>([]);
  const [posting, setPosting] = useState(url);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const observed = useRef<string | null>(null);
  const id = useId();
  const target = String(Number(n));
  const running = jobs.find(job => job.kind === "evaluate" && job.status === "running" &&
    (job.targetApplication === target || (postingHref(url) && job.input === url)));
  const previous = jobs.find(job => job.kind === "evaluate" && job.targetApplication === target);
  const partial = evaluation.kind === "partial";
  const label = partial ? "Complete full evaluation" : evaluation.kind === "none" ? "Evaluate" : "Re-evaluate";
  const stateLabel = { none: "Not evaluated", partial: "Partial evaluation", full: "Full evaluation", missing: "Report unavailable" }[evaluation.kind];

  useEffect(() => {
    if (running) { observed.current = running.id; return; }
    if (observed.current && jobs.some(job => job.id === observed.current && job.status !== "running")) {
      observed.current = null;
      router.refresh();
    }
  }, [jobs, running, router]);

  function open() {
    setPosting(url);
    setChosen(evaluation.kind === "none" ? [...sections] : [...FULL_EVALUATION]);
    setError("");
    dialog.current?.showModal();
  }

  function run(event: React.FormEvent) {
    event.preventDefault();
    if (running) return;
    const href = postingHref(posting);
    if (!href) { setError("Add the original job URL before evaluating."); return; }
    // Completing a partial report explicitly requests the entire assessment.
    const requested = partial ? [...FULL_EVALUATION] : chosen;
    const job = startJob({ title: `${partial ? "Complete evaluation" : "Evaluate"} · ${company}`, subtitle: role,
      kind: "evaluate", input: href, page: `/pipeline/${target}`, targetApplication: target, evaluationSections: requested });
    if (job) {
      observed.current = job;
      if (!partial) setSections(requested);
      dialog.current?.close();
    }
  }

  return <div className="mt-1 flex min-w-32 flex-col items-start gap-1">
    <span className="text-[11px] text-muted">{stateLabel}</span>
    {running ? <Link href={`/jobs/${running.id}`} className="inline-flex items-center gap-1 text-xs text-brand-text"><Loader2 className="size-3 animate-spin" /> Evaluating…</Link> :
      <button type="button" onClick={open} className="inline-flex items-center gap-1 rounded-full border border-brand/30 px-2.5 py-1 text-xs text-brand-text hover:bg-brand-soft max-sm:min-h-11"><Sparkles className="size-3" />{label}</button>}
    {!running && previous?.status === "error" && <Link href={`/jobs/${previous.id}`} className="text-xs text-rose-600 dark:text-rose-400">Evaluation failed · view details</Link>}
    <dialog ref={dialog} aria-labelledby={`${id}-title`} className="fixed inset-0 m-auto max-h-[85vh] w-[90vw] max-w-2xl overflow-y-auto rounded-2xl border border-border bg-background p-5 text-foreground shadow-2xl backdrop:bg-black/50">
      <form onSubmit={run} className="space-y-4">
        <h2 id={`${id}-title`} className="text-lg font-semibold">{label}</h2>
        <p className="text-sm text-muted">{company} · {role}</p>
        <p className="text-sm text-muted">{partial ? "Runs a full assessment and saves a new report version. Your earlier report is kept." : "Saves the assessment on this job. Existing reports are kept as earlier versions."} Your status and notes are preserved.</p>
        <div><label htmlFor={`${id}-url`} className="mb-1 block text-sm">Job URL</label>
          <input id={`${id}-url`} type="url" value={posting} readOnly={!!url} onChange={event => setPosting(event.target.value)} required placeholder="https://…" className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm" /></div>
        {partial ? <p className="rounded-xl border border-border bg-surface p-3 text-sm">All evaluation sections are included. This runs on your AI and uses tokens.</p> : <EvaluationOptions sections={chosen} onChange={setChosen} />}
        {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => dialog.current?.close()} className="rounded-full border border-border px-4 py-2 text-sm">Cancel</button>
          <button type="submit" disabled={!!running} className="rounded-full bg-brand px-4 py-2 text-sm text-brand-foreground disabled:opacity-50">{partial ? "Start full evaluation" : "Start evaluation"}</button>
        </div>
      </form>
    </dialog>
  </div>;
}
