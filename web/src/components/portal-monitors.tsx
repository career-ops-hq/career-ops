"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { Bell, CheckCircle2, ExternalLink, Globe, Loader2, Pause, Pencil, Play, RefreshCw, Trash2, X } from "lucide-react";

type Listing = { title: string; company: string; url: string };
type Source = { id: string; name: string; url: string; provider: string; keywords: string[]; enabled: boolean; notifyDesktop: boolean; autoMonitor?: boolean;
  lastAttempt?: string; lastSuccess?: string; nextRunAt: string; lastError?: string; lastTotal?: number; lastMatching?: number; lastAdded: number; totalAdded: number };
type Notice = { id: string; name: string; count: number; at: string; read: boolean; jobs: Listing[] };
type Scheduler = { platform: string; task: { enabled: boolean; exists: boolean; lastRun: string | null } };
const inputClass = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand";
const buttonClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-surface-hover disabled:opacity-50";

async function request(action: string, data: Record<string, unknown> = {}) {
  const response = await fetch("/api/portals/monitors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...data, action }) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Could not complete the portal action.");
  window.dispatchEvent(new Event("portal-monitors-changed"));
  return body;
}
const when = (value?: string | null) => value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Not checked yet";

/** Website health and management; new URLs are added from Explore. */
export function PortalMonitors() {
  const [sources, setSources] = useState<Source[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [scheduler, setScheduler] = useState<Scheduler | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<Source | null>(null);
  const [name, setName] = useState("");
  const [keywords, setKeywords] = useState("");
  const [desktop, setDesktop] = useState(false);

  const load = useCallback(async () => {
    try {
      const [response, schedule] = await Promise.all([fetch("/api/portals/monitors", { cache: "no-store" }), fetch("/api/scheduler", { cache: "no-store" })]);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not read saved websites.");
      setSources(data.sources); setNotices(data.notices);
      if (schedule.ok) setScheduler(await schedule.json());
    } catch (e) { setError(e instanceof Error ? e.message : "Could not read saved websites."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    void load();
    const timer = setInterval(load, 60_000);
    window.addEventListener("portal-monitors-changed", load);
    return () => { clearInterval(timer); window.removeEventListener("portal-monitors-changed", load); };
  }, [load]);

  async function action(key: string, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(key); setError(null); setMessage(null);
    try { await fn(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not complete the action."); }
    finally { setBusy(null); await load(); }
  }
  function openEditor(source: Source) {
    setEditing(source); setName(source.name); setKeywords(source.keywords.join(", "));
    setDesktop(source.notifyDesktop); setError(null); setMessage(null);
  }
  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    await action("save", async () => {
      await request("update", { id: editing.id, name, ...(editing.autoMonitor !== false ? { keywords, notifyDesktop: desktop } : {}) });
      setEditing(null);
      setMessage("Website settings saved. Explore search filters are configured in Explore.");
    });
  }
  const unread = notices.filter(n => !n.read);
  const daily = sources.filter(s => s.enabled && s.autoMonitor !== false).length;

  return <section aria-labelledby="saved-websites-heading" className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 id="saved-websites-heading" className="text-lg font-semibold">Saved websites</h2><p className="mt-1 text-sm text-muted">View website health, manage saved sources, and control existing daily monitors.</p></div>
      <Link href="/explore" className={buttonClass}>Add URLs in Explore</Link></div>
    {error && <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">{error}</p>}
    {message && <p role="status" className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-800 dark:text-emerald-400" />{message}</p>}

    {editing && <form onSubmit={saveSettings} className="space-y-4 rounded-2xl border border-border bg-surface/40 p-5">
      <div className="flex items-center justify-between"><h3 className="font-semibold">Edit website</h3><button type="button" onClick={() => setEditing(null)} aria-label="Close website editor" className="p-2"><X className="size-4" /></button></div>
      <label className="block space-y-1.5 text-sm"><span>Website URL</span><input value={editing.url} disabled className={inputClass} /></label>
      <label className="block space-y-1.5 text-sm"><span>Name</span><input value={name} maxLength={160} disabled={!!busy} onChange={e => setName(e.target.value)} className={inputClass} /></label>
      {editing.autoMonitor !== false && <>
        <label className="block space-y-1.5 text-sm"><span>Daily monitor title keywords (optional)</span><input value={keywords} disabled={!!busy} onChange={e => setKeywords(e.target.value)} placeholder="AI, machine learning, robotics" className={inputClass} /></label>
        <p className="text-xs text-muted">These keywords apply to this website’s existing daily monitor. Explore searches use their own role and location filters.</p>
        {scheduler?.platform === "darwin" && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={desktop} disabled={!!busy} onChange={e => setDesktop(e.target.checked)} className="mt-1 accent-brand" /><span>Mac desktop notifications<span className="block text-xs text-muted">In-app notices are always saved.</span></span></label>}
      </>}
      <button type="submit" disabled={!!busy} className={`${buttonClass} border-brand bg-brand text-brand-foreground hover:bg-brand-200`}>{busy === "save" && <Loader2 className="size-4 animate-spin" />}Save changes</button>
    </form>}

    {!!daily && <div className="rounded-xl border border-border bg-surface/30 p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3"><p><span className={`mr-2 inline-block size-2 rounded-full ${scheduler?.task.enabled ? "bg-emerald-500" : "bg-amber-500"}`} />{scheduler?.task.enabled ? "Background checks enabled" : "Background checks are not enabled"}</p>
        {!scheduler?.task.enabled && <button disabled={!!busy} onClick={() => void action("install", async () => { const result = await request("install-schedule"); setScheduler(result.scheduler); setMessage("Background worker enabled."); })} className={buttonClass}>{busy === "install" && <Loader2 className="size-4 animate-spin" />}Enable background checks</button>}
      </div><p className="mt-2 text-xs text-muted">{daily} existing daily {daily === 1 ? "monitor" : "monitors"}. The worker checks what is due every 15 minutes. Additional searches are managed in <Link href="/scheduled-scans" className="underline underline-offset-2">Scheduled scans</Link>.</p>
      {scheduler?.task.lastRun && <p className="mt-1 text-xs text-faint">Last background worker check: {when(scheduler.task.lastRun)}</p>}
    </div>}

    {loading ? <p className="flex items-center gap-2 text-sm text-muted"><Loader2 className="size-4 animate-spin" />Loading websites…</p> : sources.length === 0 ? <div className="rounded-2xl border border-dashed border-border p-7 text-center"><Globe className="mx-auto mb-3 size-7 text-faint" /><p className="text-sm font-medium">No websites added yet</p><p className="mt-1 text-xs text-muted">Add a careers board or individual job in Explore.</p><Link href="/explore" className="mt-3 inline-block text-sm text-brand-text underline underline-offset-2">Open Explore</Link></div> : <ul className="space-y-3">{sources.map(source => {
      const isDaily = source.autoMonitor !== false;
      const status = !source.enabled ? "Paused" : source.lastError ? "Check failed" : !isDaily ? "Ready for searches" : !scheduler?.task.enabled ? "Waiting for background worker" : "Daily";
      return <li key={source.id} className="space-y-3 rounded-2xl border border-border bg-surface/30 p-4">
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="flex flex-wrap items-center gap-2 font-medium"><Globe className="size-4 shrink-0 text-brand-text" />{source.name}<span className={`rounded px-2 py-0.5 text-[10px] ${!source.enabled ? "bg-surface-hover text-muted" : source.lastError ? "bg-red-500/10 text-red-800 dark:text-red-400" : "bg-emerald-500/10 text-emerald-800 dark:text-emerald-400"}`}>{status}</span></h3><a href={source.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex max-w-full items-center gap-1 truncate text-xs text-muted hover:text-brand-text">{source.url}<ExternalLink className="size-3 shrink-0" /></a></div>
          <div className="flex shrink-0 gap-1"><button title={`Edit ${source.name}`} aria-label={`Edit ${source.name}`} disabled={!!busy} onClick={() => openEditor(source)} className="rounded-lg p-2 hover:bg-surface-hover"><Pencil className="size-4" /></button><button aria-label={`${source.enabled ? "Pause" : "Resume"} ${source.name}`} disabled={!!busy} onClick={() => void action(source.id, async () => { await request("update", { id: source.id, enabled: !source.enabled }); })} className="rounded-lg p-2 hover:bg-surface-hover">{source.enabled ? <Pause className="size-4" /> : <Play className="size-4" />}</button><button aria-label={`Remove ${source.name}`} disabled={!!busy} onClick={() => { if (confirm(`Remove ${source.name}? Scheduled searches using it will need updating. Jobs already in your inbox will be kept.`)) void action(source.id, async () => { await request("remove", { id: source.id }); }); }} className="rounded-lg p-2 text-muted hover:bg-red-500/10 hover:text-red-800 dark:text-red-400"><Trash2 className="size-4" /></button></div>
        </div>
        <p className="text-xs text-muted">{isDaily ? `${source.keywords.length ? `Daily monitor keywords: ${source.keywords.join(", ")}` : "Daily monitor: all listings"}${source.notifyDesktop ? " · Mac desktop alerts" : " · In-app alerts"}` : "Search this website using your Explore filters and scheduled searches."}</p>
        <div className="grid gap-2 text-xs sm:grid-cols-3"><p className="text-muted">Last successful check<span className="mt-1 block text-foreground">{when(source.lastSuccess)}</span></p><p className="text-muted">{isDaily ? "Next daily check due" : "Search schedule"}<span className="mt-1 block text-foreground">{!source.enabled ? "Paused" : isDaily ? when(source.nextRunAt) : <Link href="/scheduled-scans" className="underline underline-offset-2">View scheduled scans</Link>}</span></p><p className="text-muted">Last check / total added<span className="mt-1 block text-foreground">{source.lastAdded} / {source.totalAdded} jobs</span></p></div>
        {source.lastError && <p role="alert" className="rounded-lg bg-red-500/10 p-2 text-xs text-red-700 dark:text-red-400">{source.lastError} · Last attempt: {when(source.lastAttempt)}.{isDaily ? " Automatic checks retry after an hour." : ""}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-faint">{source.lastTotal !== undefined ? `${source.lastMatching} matching titles / ${source.lastTotal} listings on last check` : `Website: ${source.provider}`}</span><button disabled={!!busy} onClick={() => void action(source.id, async () => {
          if (isDaily) { const result = await request("check", { id: source.id }); setMessage(result.baseline ? `Baseline recorded: ${result.matching} existing listings. Future discoveries will appear in your inbox.` : `Check complete: ${result.added} new jobs added to your inbox.`); }
          else { const result = await request("preview", { url: source.url, name: source.name, keywords: [] }); setMessage(`${source.name} answered with ${result.total} listings${result.partial ? " on its first page" : ""}.`); }
        })} className={buttonClass}>{busy === source.id ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}{isDaily ? "Check now" : "Test website"}</button></div>
      </li>;
    })}</ul>}

    {!!unread.length && <div className="space-y-3 rounded-2xl border border-brand/25 bg-brand-soft p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="flex items-center gap-2 text-sm font-semibold"><Bell className="size-4" />New jobs found</h3><button disabled={!!busy} className="text-xs underline underline-offset-4" onClick={() => void action("read", async () => { await request("read", { ids: unread.map(n => n.id) }); })}>Mark notifications read</button></div>{unread.slice(0, 5).map(n => <div key={n.id} className="text-sm"><p>{n.name} · {n.count} newly found · <span className="text-xs text-muted">{when(n.at)}</span></p><ul className="mt-1 space-y-1 text-xs text-muted">{n.jobs.slice(0, 3).map(job => <li key={job.url}>{job.title} · {job.company}</li>)}</ul></div>)}<Link href="/pipeline?tab=INBOX" className="inline-block text-sm font-medium underline underline-offset-4">Open jobs in inbox →</Link></div>}
  </section>;
}
