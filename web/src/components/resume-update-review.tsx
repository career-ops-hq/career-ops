"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Check, RefreshCw } from "lucide-react";
import { useJobs } from "@/components/jobs/job-store";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { DocumentApplication, ProfileState, RoleResume } from "@/lib/document-library";

type Selection = { family: "general-role" | "application"; identifier: string; name: string; version: string; createdAt?: string; profileVersion?: number };
type Preview = Selection & { nextVersion: string; currentProfileVersion: number; changes: Array<{ section: string; description: string }>; unchangedSections: string[]; meaningful: boolean; run: { kind: "role-resume" | "pdf"; input: string } };

export function ResumeUpdateReview({ applications, roleResumes, profileState }: { applications: DocumentApplication[]; roleResumes: RoleResume[]; profileState: ProfileState }) {
  const { startJob } = useJobs();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const selections: Selection[] = [
    ...roleResumes.filter((role) => role.freshness === "stale").map((role) => ({ family: "general-role" as const, identifier: role.slug, name: role.targetRole, version: role.latest.version, createdAt: role.latest.metadata.createdAt, profileVersion: role.latest.metadata.profileVersion })),
    ...applications.flatMap((app) => { const resume = app.documents.find((doc) => doc.kind === "resume"); return resume?.freshness === "stale" && resume.versions[0] ? [{ family: "application" as const, identifier: app.number, name: `${app.company} — ${app.role}`, version: resume.versions[0].version, createdAt: resume.versions[0].metadata?.createdAt, profileVersion: resume.versions[0].metadata?.profileVersion }] : []; }),
  ];

  async function load(item: Selection) {
    setBusy(`${item.family}:${item.identifier}`); setError(""); setPreview(null);
    const response = await fetch("/api/documents/update-preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ family: item.family, identifier: item.identifier }) });
    const body = await response.json(); setBusy("");
    if (!response.ok) setError(body.error || "Could not preview changes."); else setPreview({ ...item, ...body });
  }
  function approve(force = false) {
    if (!preview || (!preview.meaningful && !force)) return;
    startJob({ title: `${preview.name} resume update`, subtitle: preview.nextVersion, kind: preview.run.kind, input: preview.run.input, page: "/documents" });
    setPreview(null);
  }

  return <div className="mx-auto max-w-4xl px-6 py-8">
    <Link href="/documents" className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"><ArrowLeft className="size-4" />Documents</Link>
    <h1 className="mt-5 font-display text-2xl text-landing">Review Resume Updates</h1>
    <p className="mt-1 text-sm text-muted">Current Career Profile version: {profileState.version}. Preview relevance before creating any new resume version.</p>
    {error && <p role="alert" className="mt-4 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{error}</p>}
    <div className="mt-6 space-y-4">{selections.filter((item) => !skipped.includes(`${item.family}:${item.identifier}`)).map((item) => <article key={`${item.family}:${item.identifier}`} className="rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-brand-text">{item.family === "general-role" ? "General Role Resume" : "Application Resume"}</p><h2 className="mt-1 font-display text-lg text-landing">{item.name}</h2><p className="mt-1 text-xs text-muted">Latest {item.version} · Generated {item.createdAt ? new Date(item.createdAt).toLocaleDateString() : "date unknown"} · Profile version used: {item.profileVersion ?? "unknown"} · Current: {profileState.version}</p></div><span className="rounded-full border border-brand/30 bg-brand-soft px-2 py-1 text-xs text-brand-text">Update available</span></div>
      <div className="mt-4 flex gap-2"><button disabled={!!busy} onClick={() => void load(item)} className={cn(buttonVariants({ variant: "primary", size: "sm" }))}><RefreshCw className="size-3.5" />{busy === `${item.family}:${item.identifier}` ? "Preparing…" : "Preview Changes"}</button><button onClick={() => setSkipped((old) => [...old, `${item.family}:${item.identifier}`])} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>Skip for Now</button></div>
    </article>)}</div>
    {preview && <section className="mt-6 rounded-xl border border-brand/30 bg-brand-soft p-5"><p className="text-xs font-semibold uppercase tracking-wide text-brand-text">Proposed changes · {preview.nextVersion}</p><h2 className="mt-2 font-display text-xl text-landing">{preview.name}</h2>
      {preview.meaningful ? <div className="mt-4 space-y-3">{preview.changes.map((change, index) => <div key={`${change.section}-${index}`}><p className="text-sm font-medium text-foreground">{change.section}</p><p className="text-sm text-muted">+ {change.description}</p></div>)}{!preview.changes.length && <p className="text-sm text-muted">Career-Ops will reassess the current CV against the saved role targeting before rendering.</p>}</div> : <p className="mt-4 text-sm text-muted">Your Career Profile is newer, but no relevant resume changes were identified.</p>}
      {!!preview.unchangedSections.length && <div className="mt-4"><p className="text-sm font-medium text-foreground">Unchanged sections</p>{preview.unchangedSections.map((section) => <p key={section} className="text-sm text-muted">- {section}</p>)}</div>}
      <div className="mt-5 flex flex-wrap gap-2"><button onClick={() => approve(false)} disabled={!preview.meaningful} className={cn(buttonVariants({ variant: "primary" }))}><Check className="size-4" />Approve &amp; Generate {preview.nextVersion}</button>{!preview.meaningful && <button onClick={() => approve(true)} className={cn(buttonVariants({ variant: "secondary" }))}>Regenerate Anyway</button>}<button onClick={() => setPreview(null)} className={cn(buttonVariants({ variant: "outline" }))}>Cancel</button></div>
    </section>}
    {!selections.length && <div className="mt-6 rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted">All latest resumes are current with your Career Profile.</div>}
  </div>;
}
