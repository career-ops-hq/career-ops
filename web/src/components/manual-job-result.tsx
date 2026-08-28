"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FileDown, FilePlus2, Loader2 } from "lucide-react";
import type { Job } from "@/components/jobs/job-store";
import { useJobs } from "@/components/jobs/job-store";
import { parseManualJobInput } from "@/lib/manual-jobs.mjs";

type Result = { application: { n: string; company: string; role: string; score: string; status: string; pdf: string }; report: string | null; reportUrl: string };

export function ManualJobResult({ job }: { job: Job }) {
  const manual = parseManualJobInput(job.input || "");
  const [result, setResult] = useState<Result | null>(null);
  const [lookupError, setLookupError] = useState("");
  const { startJob } = useJobs();
  useEffect(() => {
    if (!manual || job.status !== "done" || job.result?.score === 0) return;
    fetch("/api/jobs/manual/result", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(manual) })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error); return body; })
      .then(setResult).catch((error) => setLookupError(error.message || "Evaluation record not available yet."));
  }, [job.status, job.result?.score, job.input]);
  if (!manual) return null;
  const fetchFailure = job.steps.some((step) => step.label.includes("Career-Ops could not read this posting automatically"));
  if (fetchFailure) return <div className="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">Career-Ops could not read this posting automatically. Paste the job description below. <Link href="/jobs/add" className="ml-1 font-medium text-brand hover:underline">Return to Add Job Posting</Link></div>;
  if (job.status !== "done") return null;
  if (job.result?.score === 0) return <div className="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">Career-Ops could not read this posting automatically. Paste the job description below. <Link href="/jobs/add" className="ml-1 font-medium text-brand hover:underline">Return to Add Job Posting</Link></div>;
  if (!result) return <div className="mt-6 flex items-center gap-2 text-sm text-muted">{lookupError || <><Loader2 className="size-4 animate-spin" /> Loading the canonical evaluation…</>}</div>;
  const create = (cover: boolean) => startJob({ title: `CV PDF · ${result.application.company}`, subtitle: result.application.role, kind: "pdf", input: result.application.n, page: result.reportUrl, prepareCoverLetter: cover });
  return <section className="mt-7">
    <div className="rounded-2xl border border-border bg-surface/40 p-5">
      <p className="font-mono text-xs uppercase tracking-[0.16em] text-faint">Application #{result.application.n}</p>
      <h2 className="mt-2 font-display text-xl">{result.application.company}</h2><p className="text-sm text-muted">{result.application.role}</p>
      <div className="mt-3 flex flex-wrap gap-2 text-xs"><span className="rounded bg-brand-soft px-2 py-1 text-brand">{result.application.score}</span><span className="rounded bg-surface-hover px-2 py-1 text-muted">{result.application.status}</span></div>
      <div className="mt-4 flex flex-wrap gap-2"><Link href={result.reportUrl} className="rounded-md border border-border px-3 py-2 text-xs font-medium hover:text-brand">Full evaluation report</Link><button onClick={() => create(false)} className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-2 text-xs font-medium text-white"><FileDown className="size-3.5" /> Create Tailored Resume</button><button onClick={() => create(true)} className="inline-flex items-center gap-1.5 rounded-md border border-brand/40 px-3 py-2 text-xs font-medium text-brand"><FilePlus2 className="size-3.5" /> Create Resume + Cover Letter</button></div>
    </div>
    {result.report && <article className="report-prose mt-6 rounded-2xl border border-border bg-surface/30 p-5"><ReactMarkdown remarkPlugins={[remarkGfm]}>{result.report}</ReactMarkdown></article>}
  </section>;
}
