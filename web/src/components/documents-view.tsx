"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, ExternalLink, FileText, Search } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { ApplicationDocument, DocumentApplication, ReadyDocument, RoleResume } from "@/lib/document-library";

const labelFor = (kind: ApplicationDocument["kind"]) => kind === "resume" ? "Resume" : "Cover Letter";
const fileUrl = (relativePath: string, download = false) => `/api/documents/file?path=${encodeURIComponent(relativePath)}${download ? "&download=1" : ""}`;

function DocumentRow({ document, company, applicantName, applicationNumber }: { document: ApplicationDocument; company: string; applicantName: string; applicationNumber: string }) {
  const router = useRouter();
  const [version, setVersion] = useState(document.selectedVersion);
  const [replace, setReplace] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const selected = document.versions.find((item) => item.version === version) ?? document.versions[0];

  if (!selected && document.workflow) {
    return (
      <div className="border-t border-border py-4 first:border-t-0 first:pt-0">
        <div className="flex flex-wrap items-center gap-3"><FileText className="size-4 text-brand" /><h4 className="font-medium text-foreground">Cover Letter</h4><span className="rounded-full border border-brand/30 bg-brand-soft px-2 py-0.5 text-xs text-brand-text">{document.workflow.status}</span></div>
        <p className="mt-2 text-xs text-muted">Prepared for resume {document.workflow.resumeVersion}; final PDF {document.workflow.targetVersion} remains approval-gated.</p>
        <a href={`/pipeline/${applicationNumber}?cover=review`} className={cn(buttonVariants({ variant: "primary", size: "sm" }), "mt-3")}>Review Cover Letter</a>
      </div>
    );
  }

  async function copy(replaceExisting = false) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/documents/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: selected.path, company, kind: document.kind, replace: replaceExisting }),
      });
      const body = await response.json();
      if (response.status === 409) {
        setReplace(true);
        setMessage(`${body.filename} already exists.`);
      } else if (!response.ok) {
        setMessage(body.error || "Copy failed.");
      } else {
        setReplace(false);
        setMessage(`Copied as ${body.filename}`);
        router.refresh();
      }
    } catch {
      setMessage("Copy failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-border py-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-3">
        <FileText className="size-4 text-brand" />
        <h4 className="font-medium text-foreground">{labelFor(document.kind)}</h4>
        <span className="rounded-full border border-border bg-surface-hover px-2 py-0.5 text-xs text-muted">{document.status}: {document.selectedVersion}</span>
        <label className="ml-auto flex items-center gap-2 text-xs text-muted">
          Version
          <select value={version} onChange={(event) => { setVersion(event.target.value); setReplace(false); setMessage(""); }} className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground">
            {document.versions.map((item) => <option key={item.version}>{item.version}</option>)}
          </select>
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <a href={fileUrl(selected.path)} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}><ExternalLink className="size-3.5" />View PDF</a>
        <a href={fileUrl(selected.path, true)} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}><Download className="size-3.5" />Download</a>
        {!replace ? (
          <button type="button" disabled={busy} onClick={() => void copy(false)} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>Copy to Ready-to-Apply</button>
        ) : (
          <button type="button" disabled={busy} onClick={() => void copy(true)} className={cn(buttonVariants({ variant: "primary", size: "sm" }))}>Replace existing copy</button>
        )}
      </div>
      {message && <p role="status" className="mt-2 text-xs text-muted">{message}</p>}
      {document.workflow?.status === "Review recommended - newer resume exists" && <div className="mt-3 rounded-md border border-brand/30 bg-brand-soft p-3 text-xs text-muted"><span className="font-medium text-brand-text">Review recommended:</span> a newer resume ({document.workflow.resumeVersion}) exists. The approved PDF is preserved. <a href={`/pipeline/${applicationNumber}?cover=prepare`} className="ml-1 font-medium text-brand-text underline">Prepare New Cover Letter</a></div>}
      <span className="sr-only">Copy filename uses {applicantName}</span>
    </div>
  );
}

export function DocumentsView({ applications, roleResumes, ready, applicantName }: { applications: DocumentApplication[]; roleResumes: RoleResume[]; ready: ReadyDocument[]; applicantName: string }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return applications;
    return applications.filter((app) => `${app.number} ${app.company} ${app.role} ${app.documents.map((d) => labelFor(d.kind)).join(" ")}`.toLowerCase().includes(q));
  }, [applications, query]);
  const filteredRoles = roleResumes.filter((role) => role.targetRole.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div className="space-y-8">
      <label className="relative block">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
        <span className="sr-only">Search applications and documents</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search applications/documents" className="w-full rounded-lg border border-border bg-surface py-2.5 pl-10 pr-3 text-sm text-foreground outline-none placeholder:text-faint focus:border-brand focus:ring-2 focus:ring-brand/20" />
      </label>

      <section>
        <h2 className="font-display text-xl text-landing">General Role Resumes</h2>
        <p className="mt-1 text-sm text-muted">Reusable, fact-gated resumes organized by role family.</p>
        <div className="mt-3 space-y-4">
          {filteredRoles.map((role) => <article key={role.slug} className="rounded-xl border border-border bg-surface p-5">
            <h3 className="font-display text-lg text-landing">{role.targetRole}</h3>
            <p className="mt-1 text-xs text-muted">General Role Resume · Latest {role.latest.version} · Fact Gate: {role.latest.metadata.factGate === "passed" ? "Passed" : "Unknown"}</p>
            {role.latest.metadata.createdAt && <p className="mt-1 text-xs text-faint">Created {new Date(role.latest.metadata.createdAt).toLocaleDateString()}</p>}
            <div className="mt-4 flex flex-wrap gap-2">
              <a href={fileUrl(role.latest.path)} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>View PDF</a>
              <a href={fileUrl(role.latest.path, true)} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}><Download className="size-3.5" />Download</a>
              <a href={`/documents/create?mode=general&role=${encodeURIComponent(role.targetRole)}`} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>Create New Version</a>
            </div>
          </article>)}
          {!filteredRoles.length && <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">No general role resumes{query ? " match your search" : " yet"}.</div>}
        </div>
      </section>

      <section className="space-y-4">
        <div><h2 className="font-display text-xl text-landing">Application Documents</h2><p className="mt-1 text-sm text-muted">Job-specific resumes and cover letters.</p></div>
        {filtered.map((app) => (
          <section key={app.directory} className="rounded-xl border border-border bg-surface p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-text">Application {app.number}</p>
            <h2 className="mt-1 font-display text-xl text-landing">{app.company}</h2>
            <p className="mt-0.5 text-sm text-muted">{app.role}</p>
            <div className="mt-5">{app.documents.map((document) => <DocumentRow key={document.kind} document={document} company={app.company} applicantName={applicantName} applicationNumber={app.number} />)}</div>
          </section>
        ))}
        {!filtered.length && <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted">No application documents match your search.</div>}
      </section>

      <section>
        <h2 className="font-display text-xl text-landing">Ready to Apply</h2>
        <p className="mt-1 text-sm text-muted">Convenience copies approved for manual upload.</p>
        <div className="mt-3 divide-y divide-border rounded-xl border border-border bg-surface">
          {ready.map((file) => (
            <div key={file.path} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <FileText className="size-4 text-brand" /><span className="min-w-0 flex-1 truncate text-sm text-foreground">{file.name}</span>
              <a href={fileUrl(file.path)} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>View</a>
              <a href={fileUrl(file.path, true)} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}><Download className="size-3.5" />Download</a>
            </div>
          ))}
          {!ready.length && <p className="px-4 py-6 text-center text-sm text-muted">No ready-to-apply PDFs yet.</p>}
        </div>
      </section>
    </div>
  );
}
