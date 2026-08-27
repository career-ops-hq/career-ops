"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, X } from "lucide-react";
import { useJobs } from "@/components/jobs/job-store";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { DocumentApplication } from "@/lib/document-library";

type Plan = { targetRole: string; roleSlug: string; positioning: string; supportedFocusAreas: string[]; unsupportedFocusAreas: string[]; sections: string[]; version: string };

export function CreateResumeView({ applications }: { applications: DocumentApplication[] }) {
  const { startJob } = useJobs();
  const [mode, setMode] = useState<"general" | "application">("general");
  const [targetRole, setTargetRole] = useState("");
  const [options, setOptions] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [custom, setCustom] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState("");
  const [application, setApplication] = useState(applications[0]?.number || "");
  useEffect(() => { fetch("/api/documents/role-resumes/plan").then((r) => r.json()).then((b) => setOptions(b.focusAreas || [])).catch(() => {}); }, []);
  const current = applications.find((app) => app.number === application);
  const currentResume = current?.documents.find((d) => d.kind === "resume")?.selectedVersion || "None";
  const focuses = useMemo(() => [...selected, ...custom.split(",").map((v) => v.trim()).filter(Boolean)], [selected, custom]);

  async function preview() {
    setError(""); setPlan(null);
    const response = await fetch("/api/documents/role-resumes/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetRole, focusAreas: focuses }) });
    const body = await response.json();
    if (!response.ok) setError(body.error || "Could not prepare preview."); else setPlan(body);
  }
  function generateGeneral() {
    if (!plan) return;
    const approvedPlan = { targetRole: plan.targetRole, roleSlug: plan.roleSlug, positioning: plan.positioning, supportedFocusAreas: plan.supportedFocusAreas, unsupportedFocusAreas: plan.unsupportedFocusAreas, version: plan.version, approved: true };
    startJob({ title: `${plan.targetRole} resume`, subtitle: plan.version, kind: "role-resume", input: JSON.stringify(approvedPlan), page: "/documents" });
  }
  function generateApplication() {
    if (!current) return;
    startJob({ title: `${current.company} resume`, subtitle: `New version after ${currentResume}`, kind: "pdf", input: String(Number(current.number)), page: "/documents" });
  }

  return <div>
    <Link href="/documents" className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"><ArrowLeft className="size-4" />Documents</Link>
    <h1 className="mt-5 font-display text-2xl text-landing">Create Resume</h1>
    <p className="mt-1 text-sm text-muted">Use the existing Career-Ops tailoring, fact-gate, and PDF workflow.</p>
    <div className="mt-6 grid gap-3 sm:grid-cols-2">
      {[["general", "General Role Resume", "Reusable resume for a role family."], ["application", "Existing Application Resume", "A new version for a tracked job."]].map(([value, title, desc]) => <button key={value} onClick={() => { setMode(value as typeof mode); setPlan(null); }} className={cn("rounded-xl border p-4 text-left", mode === value ? "border-brand bg-brand-soft" : "border-border bg-surface")}><span className="font-medium text-foreground">{title}</span><span className="mt-1 block text-xs text-muted">{desc}</span></button>)}
    </div>

    {mode === "general" ? <section className="mt-6 rounded-xl border border-border bg-surface p-5">
      {!plan ? <>
        <label className="block text-sm font-medium text-foreground">Target Role<input value={targetRole} onChange={(e) => setTargetRole(e.target.value)} placeholder="Application Developer" className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-foreground" /></label>
        <fieldset className="mt-5"><legend className="text-sm font-medium text-foreground">Optional focus areas</legend><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{options.map((option) => <label key={option} className="flex items-center gap-2 text-sm text-muted"><input type="checkbox" checked={selected.includes(option)} onChange={() => setSelected((old) => old.includes(option) ? old.filter((v) => v !== option) : [...old, option])} />{option}</label>)}</div></fieldset>
        <label className="mt-5 block text-sm font-medium text-foreground">Custom focus areas<input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Comma-separated" className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-foreground" /></label>
        {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
        <button onClick={() => void preview()} className={cn(buttonVariants({ variant: "primary" }), "mt-5")}>Review Resume Plan</button>
      </> : <div data-testid="resume-preview">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-text">Pre-generation review</p>
        <h2 className="mt-2 font-display text-xl text-landing">Target: {plan.targetRole}</h2>
        <p className="mt-1 text-sm text-muted">Proposed positioning: {plan.positioning}</p>
        <h3 className="mt-5 text-sm font-medium text-foreground">Skills Career-Ops plans to emphasize</h3>
        <ul className="mt-2 space-y-1 text-sm text-muted">{plan.supportedFocusAreas.map((v) => <li key={v}><Check className="mr-2 inline size-4 text-success" />{v}</li>)}</ul>
        {!!plan.unsupportedFocusAreas.length && <><h3 className="mt-5 text-sm font-medium text-foreground">Excluded because unsupported by master CV</h3><ul className="mt-2 space-y-1 text-sm text-muted">{plan.unsupportedFocusAreas.map((v) => <li key={v}><X className="mr-2 inline size-4 text-danger" />{v}</li>)}</ul></>}
        <h3 className="mt-5 text-sm font-medium text-foreground">Sections to emphasize</h3><p className="mt-2 text-sm text-muted">{plan.sections.join(" · ")}</p>
        <div className="mt-6 flex gap-2"><button onClick={generateGeneral} className={cn(buttonVariants({ variant: "primary" }))}>Approve &amp; Generate</button><button onClick={() => setPlan(null)} className={cn(buttonVariants({ variant: "outline" }))}>Edit</button></div>
      </div>}
    </section> : <section className="mt-6 rounded-xl border border-border bg-surface p-5">
      <label className="block text-sm font-medium text-foreground">Application<select value={application} onChange={(e) => setApplication(e.target.value)} className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-foreground">{applications.map((app) => <option key={app.number} value={app.number}>{app.number} - {app.company} - {app.role}</option>)}</select></label>
      <p className="mt-4 text-sm text-muted">Current Resume: <span className="font-medium text-foreground">{currentResume}</span></p>
      <p className="mt-2 text-xs text-muted">Career-Ops will use the application report and current job description, create the next version, and preserve the application-specific cover-letter workflow.</p>
      <button disabled={!current} onClick={generateApplication} className={cn(buttonVariants({ variant: "primary" }), "mt-5")}>Generate New Version</button>
    </section>}
  </div>;
}
