"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Link2, Loader2, Plus, RefreshCw, X } from "lucide-react";
import { usePipeline } from "@/components/pipeline/pipeline-provider";
import { suggestPortalUrlKind } from "@/lib/portal-url-kind.mjs";

type Preview = { provider: string; total: number; matching: number; partial: boolean; jobs: { title: string; company: string; url: string }[] };
const inputClass = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand";
const buttonClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-surface-hover disabled:opacity-50";

async function portalAction(action: string, data: Record<string, unknown>) {
  const response = await fetch("/api/portals/monitors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...data, action }) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Could not complete the action.");
  window.dispatchEvent(new Event("portal-monitors-changed"));
  return body;
}

/** One URL entry point for a saved source or individual job links. */
export function AddUrl({ onWebsiteAdded }: { onWebsiteAdded: (id: string) => void }) {
  const router = useRouter();
  const { refetch } = usePipeline();
  const radioName = useId();
  const [open, setOpen] = useState(false);
  const [urls, setUrls] = useState("");
  const [kind, setKind] = useState<"website" | "job" | null>(null);
  const [name, setName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [company, setCompany] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<"preview" | "save" | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function run(action: "preview" | "save") {
    if (busy) return;
    setError(""); setMessage(""); setBusy(action);
    try {
      if (action === "preview") {
        setPreview(await portalAction("preview", { url: urls.trim(), name, keywords: [] }));
      } else if (kind === "job") {
        const result = await portalAction("add-jobs", { urls, title: jobTitle, company });
        if (result.added > 0) {
          // The pipeline also has a long-lived client snapshot. Refresh both it
          // and the server-rendered pages as the existing Explore add flow does.
          refetch();
          router.refresh();
          window.dispatchEvent(new CustomEvent("co-job-done", { detail: { kind: "explore-add" } }));
        }
        setMessage(`${result.added} ${result.added === 1 ? "job" : "jobs"} added to your inbox; ${result.alreadyKnown} already known.`);
        setOpen(false); setUrls(""); setJobTitle(""); setCompany(""); setKind(null);
      } else if (kind === "website" && preview) {
        // Adding a searchable source must not create a second daily monitor.
        // The user chooses cadence through Explore's Schedule action.
        const source = await portalAction("add", { url: urls.trim(), name, keywords: [], autoMonitor: false });
        onWebsiteAdded(source.id);
        setMessage(`${source.name} was added and selected. Use Schedule to check it regularly.`);
        setOpen(false); setUrls(""); setName(""); setKind(null); setPreview(null);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not complete the action."); }
    finally { setBusy(null); }
  }

  return <div className="space-y-3">
    <button type="button" onClick={() => { setOpen(v => !v); setError(""); setMessage(""); }} aria-expanded={open} className={buttonClass}>
      <Plus className="size-4" />Add URL
    </button>
    {message && <p role="status" className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-800 dark:text-emerald-400" />{message}</p>}
    {open && <div className="space-y-4 rounded-xl border border-border bg-surface/40 p-4">
      <div className="flex items-center justify-between gap-2"><h3 className="flex items-center gap-2 font-semibold"><Link2 className="size-4" />Add a job or website URL</h3><button type="button" onClick={() => setOpen(false)} aria-label="Close Add URL" className="rounded p-2 hover:bg-surface-hover"><X className="size-4" /></button></div>
      <label className="block space-y-1.5 text-sm"><span>URL</span><textarea value={urls} disabled={!!busy} onChange={e => { const value = e.target.value; setUrls(value); setKind(suggestPortalUrlKind(value)); setPreview(null); setError(""); }} rows={2} placeholder="https://boards.greenhouse.io/example-company" className={inputClass} /></label>
      <p className="text-xs text-muted">For several individual jobs, paste one URL per line. Website sources are added one at a time.</p>
      {urls.trim() && <fieldset className="space-y-2"><legend className="text-sm font-medium">What does this link point to?</legend><div className="flex flex-wrap gap-4 text-sm">
        <label className="inline-flex items-center gap-2"><input type="radio" name={radioName} checked={kind === "website"} onChange={() => { setKind("website"); setPreview(null); setError(""); }} />Job board or careers page</label>
        <label className="inline-flex items-center gap-2"><input type="radio" name={radioName} checked={kind === "job"} onChange={() => { setKind("job"); setPreview(null); setError(""); }} />Individual job</label>
      </div><p className="text-xs text-muted">We suggest a type based on the URL. Choose the other option if needed.</p></fieldset>}
      {kind === "website" && <>
        <label className="block space-y-1.5 text-sm"><span>Source name (optional)</span><input value={name} maxLength={160} disabled={!!busy} onChange={e => setName(e.target.value)} placeholder="Company careers" className={inputClass} /></label>
        <p className="text-xs text-muted">Test the website before adding it. Search filters and schedules are chosen in Explore; adding a source alone doesn’t create a daily check.</p>
        {preview && <div className="space-y-2 rounded-xl border border-brand/25 bg-brand-soft p-3 text-sm">
          <p className="font-medium">Found {preview.total} {preview.total === 1 ? "listing" : "listings"}{preview.partial ? " on the first page" : ""}.</p>
          {preview.partial && <p className="text-xs text-muted">This preview samples one page; a search checks the complete supported listing.</p>}
          {preview.total === 0 && <p className="text-xs text-muted">The source answered but currently has no listings.</p>}
          <ul className="space-y-1">{preview.jobs.map(job => <li key={job.url}><a href={job.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">{job.title}</a><span className="text-xs text-muted"> · {job.company}</span></li>)}</ul>
        </div>}
        <div className="flex flex-wrap gap-2"><button type="button" disabled={!!busy || !urls.trim()} onClick={() => void run("preview")} className={buttonClass}>{busy === "preview" ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}Test website</button>
          <button type="button" disabled={!!busy || !preview} onClick={() => void run("save")} className={`${buttonClass} border-brand bg-brand text-brand-foreground hover:bg-brand-200`}>{busy === "save" && <Loader2 className="size-4 animate-spin" />}Add source</button></div>
      </>}
      {kind === "job" && <>
        <p className="text-sm text-muted">Add individual LinkedIn or other job links to your inbox, even if no alert email arrived.</p>
        <div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1.5 text-sm"><span>Job title (optional, for one URL)</span><input value={jobTitle} disabled={!!busy} onChange={e => setJobTitle(e.target.value)} className={inputClass} /></label><label className="space-y-1.5 text-sm"><span>Company (optional, for one URL)</span><input value={company} disabled={!!busy} onChange={e => setCompany(e.target.value)} className={inputClass} /></label></div>
        <p className="text-xs text-muted">Duplicates are skipped. Saving a link does not evaluate the job or confirm it is still open.</p>
        <button type="button" disabled={!!busy || !urls.trim()} onClick={() => void run("save")} className={`${buttonClass} border-brand bg-brand text-brand-foreground hover:bg-brand-200`}>{busy === "save" ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}Add to inbox</button>
      </>}
      {error && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">{error}</p>}
    </div>}
  </div>;
}
