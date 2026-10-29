"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { PageFrame } from "@/components/page-frame";
import { MarkPdfReadyButton } from "@/components/mark-pdf-ready-button";
import { saveStatus } from "@/lib/pipeline-status.mjs";

type CopyItem = { label: string; text: string };
type PdfFile = { relativePath: string; downloadHref: string } | null;
type Tip = { portal: string; tip: string };

const PILL =
  "inline-flex items-center justify-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-medium text-muted transition-colors hover:border-brand/40 hover:text-brand-text max-sm:min-h-[44px] disabled:cursor-not-allowed disabled:opacity-60";

export function ApplyChecklist({
  company,
  role,
  backHref,
  reportHref,
  postingUrl,
  resume,
  cover,
  answers,
  work,
  education,
  cvMissing,
  tips,
  trackerNum,
  reportNum,
  status,
  pdfReady,
}: {
  company: string;
  role: string;
  backHref: string;
  reportHref: string;
  postingUrl: string;
  resume: PdfFile;
  cover: PdfFile;
  answers: CopyItem[];
  work: CopyItem[];
  education: string;
  cvMissing: boolean;
  tips: Tip[];
  trackerNum: string | null;
  reportNum: number | null;
  status: string;
  pdfReady: boolean;
}) {
  return (
    <PageFrame className="max-w-3xl">
      <Link href={backHref} className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-brand-text">
        <ArrowLeft className="size-4" /> Pipeline
      </Link>
      <header className="mt-5">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-faint">Apply checklist</p>
        <h1 className="mt-2 font-display text-3xl tracking-tight text-landing">{company}</h1>
        {role && <p className="mt-1 text-muted">{role}</p>}
        <Link href={reportHref} className="mt-3 inline-flex text-sm text-brand-text hover:underline">
          Back to the report
        </Link>
      </header>

      <Section title="Posting">
        {postingUrl ? (
          <div className="flex flex-wrap items-center gap-2">
            <a href={postingUrl} target="_blank" rel="noreferrer" className={PILL}>
              Open <ExternalLink className="size-3.5" />
            </a>
            <CopyButton text={postingUrl} label="Copy URL" />
            <span className="min-w-0 break-all font-mono text-xs text-faint">{postingUrl}</span>
          </div>
        ) : (
          <Empty>No posting URL on this application.</Empty>
        )}
      </Section>

      <Section title="Resume and cover letter">
        <PdfRow label="Resume" file={resume} empty="No resume in the PDF index for this report." />
        <PdfRow label="Cover letter" file={cover} empty="No cover letter in the PDF index for this report." />
      </Section>

      <Section title="Application answers">
        {answers.length > 0 ? (
          <div className="grid gap-3">
            {answers.map((item) => (
              <CopyField key={`${item.label}:${item.text}`} item={item} />
            ))}
          </div>
        ) : (
          <Empty>No saved application answers on this report.</Empty>
        )}
      </Section>

      <Section title="Work history">
        {cvMissing ? (
          <Empty>cv.md is not in this workspace.</Empty>
        ) : work.length > 0 ? (
          <div className="grid gap-3">
            {work.map((item) => (
              <CopyField key={`${item.label}:${item.text}`} item={item} />
            ))}
          </div>
        ) : (
          <Empty>No work history in cv.md.</Empty>
        )}
      </Section>

      <Section title="Education">
        {cvMissing ? (
          <Empty>cv.md is not in this workspace.</Empty>
        ) : education ? (
          <CopyField item={{ label: "Education", text: education }} />
        ) : (
          <Empty>No education section in cv.md.</Empty>
        )}
      </Section>

      <Section title="Portal tips">
        <table className="w-full text-sm">
          <caption className="sr-only">Portal tips</caption>
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-faint">
              <th className="py-2 pr-4 font-medium">Portal</th>
              <th className="py-2 font-medium">Tip</th>
            </tr>
          </thead>
          <tbody>
            {tips.map((tip) => (
              <tr key={tip.portal} className="border-t border-border">
                <td className="py-2 pr-4 align-top font-medium">{tip.portal}</td>
                <td className="py-2 text-muted">{tip.tip}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="After you submit">
        <div className="flex flex-wrap items-start gap-2">
          <AppliedButton trackerNum={trackerNum} status={status} />
          <SeedButton trackerNum={trackerNum} />
          <MarkPdfReadyButton reportNum={reportNum} ready={pdfReady} />
        </div>
        {!trackerNum && <p className="mt-2 text-xs text-faint">Applied and seed follow-up need a tracker row.</p>}
      </Section>
    </PageFrame>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted">{children}</p>;
}

function CopyField({ item }: { item: CopyItem }) {
  return (
    <div className="rounded-xl border border-border bg-surface/30 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">{item.label}</p>
        <CopyButton text={item.text} label="Copy" />
      </div>
      <pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-muted">{item.text}</pre>
    </div>
  );
}

function PdfRow({ label, file, empty }: { label: string; file: PdfFile; empty: string }) {
  if (!file) return <p className="mb-2 text-sm text-muted">{label}: {empty}</p>;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <span className="text-sm font-medium">{label}</span>
      <a href={file.downloadHref} target="_blank" rel="noreferrer" className={PILL}>
        Download
      </a>
      <CopyButton text={file.relativePath} label="Copy path" />
      <span className="font-mono text-xs text-faint">{file.relativePath}</span>
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <button
      type="button"
      className={PILL}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setState("copied");
        } catch {
          setState("failed");
        }
        window.setTimeout(() => setState("idle"), 1500);
      }}
    >
      {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : label}
    </button>
  );
}

function AppliedButton({ trackerNum, status }: { trackerNum: string | null; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const applied = status.trim().toLowerCase() === "applied";

  async function markApplied() {
    if (!trackerNum || busy || applied) return;
    setBusy(true);
    setError("");
    try {
      await saveStatus(trackerNum, status, "Applied");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not mark this Applied.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button type="button" className={PILL} disabled={!trackerNum || busy || applied} onClick={markApplied}>
        {busy ? "Saving…" : "Applied"}
      </button>
      {error && <span className="max-w-xs text-xs text-red-500">{error}</span>}
    </span>
  );
}

function SeedButton({ trackerNum }: { trackerNum: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  async function seed() {
    if (!trackerNum || busy) return;
    setBusy(true);
    setError("");
    setNote("");
    try {
      const res = await fetch("/api/followups/seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ n: trackerNum }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Could not seed the follow-up.");
        return;
      }
      setNote(body?.seeded !== false ? "Follow-up seeded." : body?.reason === "disabled" ? "Follow-ups are turned off in your profile, so nothing was seeded." : "Already seeded.");
      router.refresh();
    } catch {
      setError("Could not seed the follow-up.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button type="button" className={PILL} disabled={!trackerNum || busy} onClick={seed}>
        {busy ? "Saving…" : "Seed follow-up"}
      </button>
      {note && <span className="text-xs text-muted">{note}</span>}
      {error && <span className="max-w-xs text-xs text-red-500">{error}</span>}
    </span>
  );
}
