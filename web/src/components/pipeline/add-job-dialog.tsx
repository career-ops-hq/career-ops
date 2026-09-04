"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FileUp, Link2, Loader2, X } from "lucide-react";
import { useJobs } from "@/components/jobs/job-store";
import { CostBadge } from "@/components/cost/cost-badge";
import { cn } from "@/lib/cn";
import { parsePastedUrls, companyFromJobUrl, postingKey } from "@/lib/job-url.mjs";
import { MIN_JD_CHARS } from "@/lib/jd-source.mjs";

// "Add job" — the manual counterpart to discovery. Three ways to hand over the
// same thing, because a posting reaches a job seeker in three shapes: a link, a
// wall of text someone pasted into a message, and a file a recruiter attached.
// All three end at the SAME kind:"evaluate" worker the inbox shortlist uses,
// which is the real modes/oferta.md evaluation plus the canonical report and
// tracker row. Nothing about a pasted JD makes it a second-class evaluation.
//
// The link tab is unchanged. LinkedIn is the reason a URL is normalized rather
// than passed straight through: its /jobs/view page is an authwall for a headless
// agent, so job-url.mjs points the fetch at the public guest endpoint while the
// tracker keeps the clickable link.
//
// The paste and file tabs go through /api/jd first, which archives the JD under
// jds/ and hands back a `local:jds/{file}` reference. From that point on the
// reference IS the URL as far as this dialog and everything downstream is
// concerned, which is why both buttons work identically in all three tabs (see
// jd-source.mjs for why that reference form and not a new one).

type Mode = "link" | "paste" | "file";

const TABS: Array<{ id: Mode; label: string }> = [
  { id: "link", label: "Link" },
  { id: "paste", label: "Paste text" },
  { id: "file", label: "File" },
];

/** What the file picker offers. Everything jd-extract.mjs can actually read. */
const ACCEPT = ".pdf,.docx,.md,.markdown,.txt,.text";

/** Human file size for the picked-file line. */
function prettyBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function AddJobDialog({ inboxUrls, onClose }: { inboxUrls: string[]; onClose: () => void }) {
  const { jobs, startEvaluate } = useJobs();
  const [mode, setMode] = useState<Mode>("link");
  const [text, setText] = useState("");
  const [jdText, setJdText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { entries, errors } = useMemo(() => parsePastedUrls(text), [text]);

  // Already-seen check, free: the inbox URLs are already on this page and past
  // evaluate runs are already in localStorage. Warn, never block — re-scoring a
  // posting after it was edited is legitimate. Compared on postingKey, not the
  // raw string, so a pipeline row that still carries tracking noise (e.g. a
  // LinkedIn "?trk=..." link) still matches the canonical URL a fresh paste
  // normalizes to.
  //
  // Only the link tab can run this before the fact. A pasted JD's identity is a
  // hash of its own text, computed server-side, so its duplicate check happens
  // in /api/jd instead — writing is idempotent there, and re-submitting the same
  // JD reuses the same file rather than making a second one.
  const seen = useMemo(() => {
    const s = new Set(inboxUrls.map(postingKey));
    for (const j of jobs) if (j.kind === "evaluate" && j.input) s.add(postingKey(j.input));
    return s;
  }, [inboxUrls, jobs]);
  const dupes = entries.filter((e) => seen.has(postingKey(e.url)));

  const count = entries.length;
  const linkedInCount = entries.filter((e) => e.kind === "linkedin").length;
  const jdChars = jdText.trim().length;

  // Can the current tab act at all? Kept per-tab rather than as one combined
  // flag so a half-filled paste tab never enables the buttons because a URL is
  // still sitting in the link tab's box.
  const ready = mode === "link" ? count > 0 : mode === "paste" ? jdChars >= MIN_JD_CHARS : file !== null;

  /**
   * Archive the pasted text / uploaded file and return its `local:jds/…`
   * reference. Returns null after setting the inline error, so both callers read
   * as `const ref = await saveJd(); if (!ref) return;`.
   *
   * Free and reversible: this writes one file under jds/ and spends no tokens.
   */
  const saveJd = async (): Promise<string | null> => {
    let res: Response;
    try {
      if (mode === "file") {
        if (!file) return null;
        const form = new FormData();
        form.append("file", file);
        form.append("company", company);
        form.append("role", role);
        res = await fetch("/api/jd", { method: "POST", body: form });
      } else {
        res = await fetch("/api/jd", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: jdText, company, role }),
        });
      }
    } catch {
      setError("Could not save the job description.");
      return null;
    }
    const j = await res.json().catch(() => ({}) as { ref?: string; error?: string });
    if (!res.ok || !j.ref) {
      setError(typeof j.error === "string" ? j.error : "Could not save the job description.");
      return null;
    }
    return j.ref as string;
  };

  /** The label a JD-backed job and inbox row carry, since neither has a URL to
   *  derive one from. "?" is the repo's locale-invariant unknown-employer marker
   *  (AGENTS.md), not a placeholder we invented here. */
  const jdCompany = company.trim() || "?";
  const jdRole = role.trim() || (mode === "file" && file ? file.name : "Pasted job description");

  const evaluate = async () => {
    setBusy(true);
    setError(null);
    if (mode === "link") {
      const batchId = entries.length > 1 ? `paste-${Date.now()}` : undefined;
      for (const e of entries) {
        startEvaluate({ url: e.url, subtitle: e.url, page: "/pipeline", batchId });
      }
      onClose();
      return;
    }
    const ref = await saveJd();
    if (!ref) {
      setBusy(false);
      return;
    }
    startEvaluate({ url: ref, title: `Evaluate · ${jdCompany}`, subtitle: jdRole, page: "/pipeline" });
    onClose();
  };

  const addToInbox = async () => {
    setBusy(true);
    setError(null);

    let offers: Array<{ url: string; company: string; title: string; location: string; postedAt: string; ats: string; source: string }>;
    if (mode === "link") {
      offers = entries.map((e) => ({
        url: e.url,
        company: companyFromJobUrl(e.url),
        title: "Pasted link",
        location: "",
        postedAt: "",
        ats: "",
        source: "pasted",
      }));
    } else {
      const ref = await saveJd();
      if (!ref) {
        setBusy(false);
        return;
      }
      offers = [{ url: ref, company: jdCompany, title: jdRole, location: "", postedAt: "", ats: "", source: "pasted-jd" }];
    }

    try {
      const res = await fetch("/api/explore/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offers }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) {
        setError(typeof j.error === "string" ? j.error : "Could not add these to the inbox.");
        setBusy(false);
        return;
      }
      onClose();
    } catch {
      setError("Could not add these to the inbox.");
      setBusy(false);
    }
  };

  const pickFile = (f: File | null | undefined) => {
    if (!f) return;
    setFile(f);
    setError(null);
  };

  const fieldClass =
    "w-full rounded-lg border border-border bg-bg/60 px-3 py-2 text-sm outline-none transition-colors placeholder:text-faint focus:border-brand/50";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-[10vh]" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add job"
        className="w-full max-w-lg rounded-2xl border border-border bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-lg">Add job</h2>
            <p className="mt-1 text-sm text-muted">Hand over a posting and score it against your CV.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-faint transition-colors hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>

        <div role="tablist" aria-label="How to add the job" className="mt-4 flex gap-1 rounded-lg border border-border bg-bg/40 p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={mode === t.id}
              onClick={() => {
                setMode(t.id);
                setError(null);
              }}
              className={cn(
                "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors max-sm:min-h-[40px]",
                mode === t.id ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {mode === "link" && (
          <>
            <textarea
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              aria-label="Job posting links"
              placeholder="https://www.linkedin.com/jobs/view/4434693435/"
              className="mt-4 w-full resize-y rounded-lg border border-border bg-bg/60 px-3 py-2 font-mono text-xs outline-none transition-colors placeholder:text-faint focus:border-brand/50"
            />
            <p className="mt-1.5 text-xs text-faint">One per line to add several at once.</p>

            {linkedInCount > 0 && (
              <p className="mt-2 text-xs text-muted">
                LinkedIn detected. The public version of the posting is read, since the normal page blocks automated readers.
              </p>
            )}
            {dupes.length > 0 && (
              <p className="mt-2 text-xs text-muted">
                {dupes.length === 1 ? "This one is" : `${dupes.length} of these are`} already in your pipeline. Adding again re-scores it.
              </p>
            )}
            {errors.length > 0 && (
              <ul className="mt-2 space-y-1">
                {errors.map((e, i) => (
                  <li key={`${e.raw}-${i}`} className="text-xs text-rose-400">
                    {e.error}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {mode !== "link" && (
          <>
            {/* Company and role are optional but worth typing: they name the job
                card, the inbox row and the archived file. The evaluation itself
                reads both off the JD regardless, so a blank pair costs accuracy
                nothing, only legibility. */}
            <div className="mt-4 grid grid-cols-2 gap-2">
              <input
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                aria-label="Company"
                placeholder="Company (optional)"
                className={fieldClass}
              />
              <input value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role" placeholder="Role (optional)" className={fieldClass} />
            </div>

            {mode === "paste" ? (
              <>
                <textarea
                  autoFocus
                  value={jdText}
                  onChange={(e) => setJdText(e.target.value)}
                  rows={8}
                  aria-label="Job description text"
                  placeholder="Paste the whole job description here."
                  className="mt-2 w-full resize-y rounded-lg border border-border bg-bg/60 px-3 py-2 text-xs outline-none transition-colors placeholder:text-faint focus:border-brand/50"
                />
                <p className="mt-1.5 text-xs text-faint">
                  {jdChars === 0
                    ? `Paste the whole posting, at least ${MIN_JD_CHARS} characters.`
                    : jdChars < MIN_JD_CHARS
                      ? `${jdChars} characters. That is too short to score. Paste the whole posting.`
                      : `${jdChars.toLocaleString()} characters.`}
                </p>
              </>
            ) : (
              <>
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    pickFile(e.dataTransfer.files?.[0]);
                  }}
                  className={cn(
                    "mt-2 rounded-lg border border-dashed p-6 text-center transition-colors",
                    dragging ? "border-brand/60 bg-brand/5" : "border-border",
                  )}
                >
                  <FileUp className="mx-auto size-5 text-faint" />
                  <p className="mt-2 text-sm text-muted">
                    {file ? (
                      <>
                        <span className="font-medium text-foreground">{file.name}</span> <span className="text-faint">({prettyBytes(file.size)})</span>
                      </>
                    ) : (
                      "Drop the file here, or"
                    )}
                  </p>
                  <button
                    type="button"
                    onClick={() => fileInput.current?.click()}
                    className="mt-2 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-brand/40 hover:text-brand"
                  >
                    {file ? "Choose a different file" : "Choose a file"}
                  </button>
                  <input
                    ref={fileInput}
                    type="file"
                    accept={ACCEPT}
                    className="hidden"
                    onChange={(e) => pickFile(e.target.files?.[0])}
                  />
                </div>
                <p className="mt-1.5 text-xs text-faint">
                  PDF, DOCX, MD or TXT. A scanned PDF has no text in it to read, so paste those instead.
                </p>
              </>
            )}
          </>
        )}

        {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!ready || busy}
            onClick={evaluate}
            className="inline-flex items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-200 disabled:opacity-40 max-sm:min-h-[44px]"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
            {mode === "link" && count > 1 ? `Evaluate ${count} now` : "Evaluate now"}
          </button>
          <button
            type="button"
            disabled={!ready || busy}
            onClick={addToInbox}
            className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-medium text-muted transition-colors hover:border-brand/40 hover:text-brand disabled:opacity-40 max-sm:min-h-[44px]"
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            Add to inbox
          </button>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <CostBadge kind="spend" size="xs" />
          <span className="text-xs text-faint">Evaluating uses tokens. Adding to the inbox is free.</span>
        </div>
      </div>
    </div>
  );
}
