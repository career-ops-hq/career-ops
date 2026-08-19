"use client";

import { useEffect, useState } from "react";
import { Check, Copy, FileText, Loader2, Sparkles } from "lucide-react";

type Answer = { question: string; answer: string; needsConfirmation?: boolean };
type Kit = {
  id: string; company: string; role: string; createdAt: string; appliedAt: string | null;
  fitSummary: string; matchScore: number; gaps: string[]; answers: Answer[];
  coverLetter: string; coverLetterUsed?: string; tailoredCvMarkdown: string; cvFile: string; cvFileUsed?: string;
};

const CONFIG_KEY = "career-ops:config";

export function ApplicationWorkspace() {
  const [mounted, setMounted] = useState(false);
  const [jd, setJd] = useState("");
  const [questions, setQuestions] = useState("");
  const [kits, setKits] = useState<Kit[]>([]);
  const [kit, setKit] = useState<Kit | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setMounted(true);
    fetch("/api/application-kit").then(r => r.json()).then(d => setKits(d.kits || [])).catch(() => {});
  }, []);

  // Password managers and form-filling extensions inject attributes into
  // textareas before React hydrates server HTML. Rendering the controls after
  // mount gives React ownership first and avoids that false mismatch warning.
  if (!mounted) {
    return <div className="mx-auto max-w-5xl px-6 py-10"><div className="h-10 w-72 animate-pulse rounded-lg bg-surface" /><div className="mt-7 grid gap-4 lg:grid-cols-2"><div className="h-96 animate-pulse rounded-2xl bg-surface" /><div className="h-96 animate-pulse rounded-2xl bg-surface" /></div></div>;
  }

  async function generate() {
    setBusy(true); setError("");
    let cliId = "";
    try { cliId = JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}").cliId || ""; } catch {}
    const res = await fetch("/api/application-kit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobDescription: jd, formQuestions: questions, cliId }) });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) return setError(data.error || "Could not generate the application kit.");
    setKit(data.kit); setKits(old => [data.kit, ...old]);
  }

  async function markApplied() {
    if (!kit) return;
    const res = await fetch("/api/application-kit", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: kit.id, coverLetter: kit.coverLetter, answers: kit.answers, cvFile: kit.cvFile }) });
    const data = await res.json();
    if (res.ok) { setKit(data.kit); setKits(old => old.map(k => k.id === data.kit.id ? data.kit : k)); }
  }

  function updateAnswer(index: number, answer: string) {
    if (!kit) return;
    setKit({ ...kit, answers: kit.answers.map((a, i) => i === index ? { ...a, answer } : a) });
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-10 max-sm:pb-24">
      <div className="max-w-2xl">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-brand">one simple workflow</p>
        <h1 className="mt-2 font-display text-4xl text-landing">Prepare an application</h1>
        <p className="mt-2 text-sm text-muted">Paste the job and its questions. Everything stays on this machine.</p>
      </div>

      <div className="mt-7 grid gap-4 lg:grid-cols-2">
        <label className="rounded-2xl border border-border bg-surface/50 p-4 text-sm font-medium">1. Job description
          <textarea value={jd} onChange={e => setJd(e.target.value)} rows={16} placeholder="Paste the complete job description…" className="mt-2 w-full resize-y rounded-xl border border-border bg-background/70 p-3 text-sm font-normal outline-none focus:border-brand/50" />
        </label>
        <label className="rounded-2xl border border-border bg-surface/50 p-4 text-sm font-medium">2. Application questions
          <textarea value={questions} onChange={e => setQuestions(e.target.value)} rows={16} placeholder="Paste the form questions and dropdown options…" className="mt-2 w-full resize-y rounded-xl border border-border bg-background/70 p-3 text-sm font-normal outline-none focus:border-brand/50" />
        </label>
      </div>
      <button onClick={generate} disabled={busy || !jd.trim()} className="mt-4 inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-medium text-brand-foreground disabled:opacity-50">
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}{busy ? "Preparing everything…" : "Analyze and prepare everything"}
      </button>
      {error && <p className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500">{error}</p>}

      {kit && <KitView kit={kit} setKit={setKit} updateAnswer={updateAnswer} markApplied={markApplied} />}

      {kits.length > 0 && <section className="mt-12"><h2 className="text-sm font-semibold uppercase tracking-[.15em] text-muted">Saved locally</h2><div className="mt-3 grid gap-2 sm:grid-cols-2">{kits.map(k => <button key={k.id} onClick={() => setKit(k)} className="rounded-xl border border-border bg-surface/40 p-4 text-left hover:border-brand/40"><div className="font-medium">{k.company || "Application"} · {k.role || "Role"}</div><div className="mt-1 text-xs text-muted">{k.appliedAt ? `Applied ${new Date(k.appliedAt).toLocaleString()}` : `Prepared ${new Date(k.createdAt).toLocaleString()}`}</div></button>)}</div></section>}
    </div>
  );
}

function KitView({ kit, setKit, updateAnswer, markApplied }: { kit: Kit; setKit: (k: Kit) => void; updateAnswer: (i: number, v: string) => void; markApplied: () => void }) {
  return <section className="mt-10 space-y-5 border-t border-border pt-8">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-display text-3xl text-landing">{kit.company} · {kit.role}</h2><p className="mt-1 text-sm text-muted">Match {kit.matchScore}/5 · {kit.fitSummary}</p></div>{kit.appliedAt ? <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-sm text-emerald-500">Applied {new Date(kit.appliedAt).toLocaleString()}</span> : <button onClick={markApplied} className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white">Mark applied now</button>}</div>
    <Panel title="Form answers">{kit.answers?.map((a, i) => <div key={i} className="border-b border-border/60 py-3 last:border-0"><div className="flex justify-between gap-2"><p className="text-sm font-medium">{a.question}</p><CopyButton text={a.answer} /></div>{a.needsConfirmation && <p className="mt-1 text-xs text-amber-500">Needs your confirmation</p>}<textarea value={a.answer} onChange={e => updateAnswer(i, e.target.value)} rows={Math.min(8, Math.max(2, a.answer.split("\n").length + 1))} className="mt-2 w-full rounded-lg border border-border bg-background/60 p-3 text-sm" /></div>)}</Panel>
    <Panel title="Cover letter used"><div className="flex justify-end"><CopyButton text={kit.coverLetter} /></div><textarea value={kit.coverLetter} onChange={e => setKit({ ...kit, coverLetter: e.target.value })} rows={15} className="mt-2 w-full rounded-lg border border-border bg-background/60 p-3 text-sm" /></Panel>
    <Panel title="Tailored CV / résumé"><div className="flex items-center justify-between text-xs text-muted"><span><FileText className="mr-1 inline size-4" />{kit.cvFileUsed || kit.cvFile}</span><CopyButton text={kit.tailoredCvMarkdown} /></div><pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-background/60 p-3 text-xs">{kit.tailoredCvMarkdown}</pre></Panel>
  </section>;
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) { return <div className="rounded-2xl border border-border bg-surface/50 p-5"><h3 className="font-semibold">{title}</h3><div className="mt-2">{children}</div></div>; }
function CopyButton({ text }: { text: string }) { const [ok, setOk] = useState(false); return <button onClick={() => navigator.clipboard.writeText(text || "").then(() => { setOk(true); setTimeout(() => setOk(false), 1200); })} className="inline-flex shrink-0 items-center gap-1 text-xs text-brand">{ok ? <Check className="size-3" /> : <Copy className="size-3" />}{ok ? "Copied" : "Copy"}</button>; }
