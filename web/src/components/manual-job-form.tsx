"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useJobs } from "@/components/jobs/job-store";

type Fields = { url: string; company: string; title: string; location: string; compensation: string; description: string };
type Preview = { job: Fields & { source: "manual-job" }; duplicate: null | { type: string; applicationId: string; company: string; title: string } };
const initial: Fields = { url: "", company: "", title: "", location: "", compensation: "", description: "" };

export function ManualJobForm() {
  const [fields, setFields] = useState(initial);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { startJob } = useJobs();
  const router = useRouter();
  const update = (field: keyof Fields, value: string) => { setFields((current) => ({ ...current, [field]: value })); setPreview(null); setError(""); };

  async function validate() {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/jobs/manual/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not validate the posting.");
      setPreview(body);
      if (!body.duplicate) launch(body.job);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not validate the posting."); }
    finally { setLoading(false); }
  }

  function launch(job: Preview["job"]) {
    const id = startJob({ title: job.title || job.company || "Manual job evaluation", subtitle: job.company || job.url, kind: "evaluate", input: JSON.stringify(job), page: "/jobs/add" });
    if (id) router.push(`/jobs/${id}`);
  }

  const inputClass = "mt-1 w-full rounded-lg border border-border bg-surface/60 px-3 py-2 text-sm outline-none placeholder:text-faint focus:border-brand/50 focus-visible:ring-2 focus-visible:ring-brand/30";
  return <div className="mt-7 space-y-5">
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="text-sm text-muted sm:col-span-2">Job URL <span className="text-faint">(optional)</span><input value={fields.url} onChange={(e) => update("url", e.target.value)} placeholder="https://company.com/jobs/123" className={inputClass} /></label>
      <label className="text-sm text-muted">Company<input value={fields.company} onChange={(e) => update("company", e.target.value)} className={inputClass} /></label>
      <label className="text-sm text-muted">Job Title<input value={fields.title} onChange={(e) => update("title", e.target.value)} className={inputClass} /></label>
      <label className="text-sm text-muted">Location <span className="text-faint">(optional)</span><input value={fields.location} onChange={(e) => update("location", e.target.value)} className={inputClass} /></label>
      <label className="text-sm text-muted">Salary / Compensation <span className="text-faint">(optional)</span><input value={fields.compensation} onChange={(e) => update("compensation", e.target.value)} className={inputClass} /></label>
      <label className="text-sm text-muted sm:col-span-2">Job Description <span className="text-faint">(optional with URL)</span><textarea value={fields.description} onChange={(e) => update("description", e.target.value)} rows={14} maxLength={60000} className={inputClass} placeholder="Paste the complete posting here. It is treated as untrusted job data." /><span className="mt-1 block text-right text-xs tabular-nums text-faint">{fields.description.length.toLocaleString()} / 60,000</span></label>
    </div>
    {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</div>}
    {preview?.duplicate && <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
      <div className="flex gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" /><div><p className="font-medium">Possible duplicate application #{preview.duplicate.applicationId}</p><p className="mt-1 text-muted">{preview.duplicate.company} — {preview.duplicate.title}. Nothing will be overwritten.</p></div></div>
      <div className="mt-3 flex gap-2"><button onClick={() => setPreview(null)} className="rounded-md border border-border px-3 py-1.5 text-xs">Cancel</button><button onClick={() => launch(preview.job)} className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white">Evaluate Anyway</button></div>
    </div>}
    <button type="button" onClick={validate} disabled={loading} className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{loading && <Loader2 className="size-4 animate-spin" />} Evaluate Job</button>
    <p className="text-xs text-faint">Career-Ops evaluates and prepares documents only. It never submits or contacts an employer.</p>
  </div>;
}
