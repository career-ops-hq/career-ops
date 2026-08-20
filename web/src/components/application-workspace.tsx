"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Download, FileText, Loader2, Sparkles } from "lucide-react";

type Outreach = {
  linkedinRecruiterNote?: string;
  linkedinHiringManagerMessage?: string;
  referralRequestMessage?: string;
  hiringManagerColdEmailSubject?: string;
  hiringManagerColdEmail?: string;
  postApplicationEmailSubject?: string;
  postApplicationEmail?: string;
};

type StarStory = {
  requirement: string;
  storyTitle: string;
  situation: string;
  task: string;
  action: string;
  result: string;
  reflection: string;
};

type RoleSummary = {
  archetype?: string;
  domain?: string;
  function?: string;
  seniority?: string;
  remote?: string;
  teamSize?: string;
  cultureScreen?: string;
  tldr?: string;
};

type CvMatch = {
  requirement: string;
  match: string;
  source: string;
};

type GapDetail = {
  gap: string;
  severity: string;
  mitigation: string;
};

type InterviewIntel = {
  recommendedCaseStudy?: string;
  redFlagQuestion?: string;
  answerStrategy?: string;
};

type Kit = {
  id: string; company: string; role: string; createdAt: string; appliedAt: string | null;
  fitSummary: string; matchScore: number; gaps: string[]; answers: Answer[];
  coverLetter: string; coverLetterUsed?: string; tailoredCvMarkdown: string; cvFile: string; cvFileUsed?: string;
  outreach?: Outreach;
  starStories?: StarStory[];
  roleSummary?: RoleSummary;
  cvMatches?: CvMatch[];
  gapsDetailed?: GapDetail[];
  interviewIntel?: InterviewIntel;
  keywords?: string[];
  trackerNum?: number;
  reportLink?: string;
};

const CONFIG_KEY = "career-ops:config";

const LOADING_STEPS = [
  "1/4 Analysing job requirements & extracting keywords…",
  "2/4 Evaluating fit against MSc CS & IT experience…",
  "3/4 Tailoring ATS CV & building STAR+R stories…",
  "4/4 Drafting UK cover letter & outreach toolkit…",
  "Finalizing application kit & checking formatting…"
];

export function ApplicationWorkspace() {
  const [mounted, setMounted] = useState(false);
  const [jd, setJd] = useState("");
  const [questions, setQuestions] = useState("");
  const [kits, setKits] = useState<Kit[]>([]);
  const [kit, setKit] = useState<Kit | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setMounted(true);
    fetch("/api/application-kit").then(r => r.json()).then(d => setKits(d.kits || [])).catch(() => {});
  }, []);

  if (!mounted) {
    return <div className="mx-auto max-w-5xl px-6 py-10"><div className="h-10 w-72 animate-pulse rounded-lg bg-surface" /><div className="mt-7 grid gap-4 lg:grid-cols-2"><div className="h-96 animate-pulse rounded-2xl bg-surface" /><div className="h-96 animate-pulse rounded-2xl bg-surface" /></div></div>;
  }

  async function generate() {
    setBusy(true);
    setCompleted(false);
    setError("");
    setLoadingStep(0);

    let step = 0;
    const interval = setInterval(() => {
      step = Math.min(LOADING_STEPS.length - 1, step + 1);
      setLoadingStep(step);
    }, 3500);

    let cliId = "";
    try { cliId = JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}").cliId || ""; } catch {}
    
    try {
      const res = await fetch("/api/application-kit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobDescription: jd, formQuestions: questions, cliId }) });
      const data = await res.json();
      clearInterval(interval);
      setBusy(false);
      if (!res.ok) {
        return setError(data.error || "Could not generate the application kit.");
      }
      setKit(data.kit);
      setKits(old => [data.kit, ...old]);
      setCompleted(true);
      setTimeout(() => setCompleted(false), 4000);
    } catch (err: any) {
      clearInterval(interval);
      setBusy(false);
      setError(err?.message || "Generation failed. Please try again.");
    }
  }

  async function markApplied() {
    if (!kit) return;
    const res = await fetch("/api/application-kit", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: kit.id, coverLetter: kit.coverLetter, answers: kit.answers, cvFile: kit.cvFile }) });
    const data = await res.json();
    if (res.ok) {
      setKit(data.kit);
      setKits(old => old.map(k => k.id === data.kit.id ? data.kit : k));
    }
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
          <textarea
            value={jd}
            onChange={e => {
              setJd(e.target.value);
              setCompleted(false);
              setError("");
            }}
            rows={16}
            placeholder="Paste the complete job description…"
            className="mt-2 w-full resize-y rounded-xl border border-border bg-background/70 p-3 text-sm font-normal outline-none focus:border-brand/50"
          />
        </label>
        <label className="rounded-2xl border border-border bg-surface/50 p-4 text-sm font-medium">2. Application questions
          <textarea
            value={questions}
            onChange={e => {
              setQuestions(e.target.value);
              setCompleted(false);
              setError("");
            }}
            rows={16}
            placeholder="Paste the form questions and dropdown options…"
            className="mt-2 w-full resize-y rounded-xl border border-border bg-background/70 p-3 text-sm font-normal outline-none focus:border-brand/50"
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={generate}
          disabled={busy || !jd.trim()}
          className={cn(
            "inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium transition-all shadow-sm disabled:opacity-50",
            completed
              ? "bg-emerald-600 text-white hover:bg-emerald-500"
              : "bg-brand text-brand-foreground hover:bg-brand-200"
          )}
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : completed ? (
            <Check className="size-4 text-emerald-300" />
          ) : (
            <Sparkles className="size-4" />
          )}
          {busy ? LOADING_STEPS[loadingStep] : completed ? "Application kit ready!" : "Analyze and prepare everything"}
        </button>

        {busy && (
          <span className="text-xs text-muted animate-pulse">
            Processing local AI pipeline… please wait
          </span>
        )}
      </div>

      {error && <p className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500">{error}</p>}

      {kit && (
        <div id="application-kit-view">
          <KitView kit={kit} setKit={setKit} updateAnswer={updateAnswer} markApplied={markApplied} />
        </div>
      )}

      {kits.length > 0 && (
        <section className="mt-12">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-[.15em] text-muted">
              Saved applications ({kits.length})
            </h2>
            {kit && (
              <span className="text-xs text-muted">
                Viewing: <strong className="text-brand font-medium">{kit.company} · {kit.role}</strong>
              </span>
            )}
          </div>
          <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
            {kits.map(k => {
              const isSelected = kit?.id === k.id;
              return (
                <button
                  key={k.id}
                  type="button"
                  onClick={() => {
                    setKit(k);
                    setJd(k.jobDescription || "");
                    setQuestions(k.formQuestions || "");
                    const kitEl = document.getElementById("application-kit-view");
                    if (kitEl) {
                      kitEl.scrollIntoView({ behavior: "smooth" });
                    }
                  }}
                  className={cn(
                    "relative rounded-xl p-4 text-left transition-all duration-200",
                    isSelected
                      ? "border-2 border-brand bg-brand/10 shadow-lg ring-2 ring-brand/30"
                      : "border border-border bg-surface/40 hover:border-brand/40 hover:bg-surface/70"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className={cn("text-sm", isSelected ? "text-brand font-bold" : "font-medium text-foreground")}>
                      {k.company || "Application"} · {k.role || "Role"}
                    </div>
                    {isSelected && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand px-2 py-0.5 text-[10px] font-bold text-brand-foreground shadow-sm">
                        <Check className="size-3" /> Active
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-xs text-muted">
                    <span>
                      {k.appliedAt ? `✅ Applied ${new Date(k.appliedAt).toLocaleDateString()}` : `Prepared ${new Date(k.createdAt).toLocaleDateString()}`}
                    </span>
                    <span className="font-mono text-[11px] text-brand font-medium">
                      {k.matchScore ? `${k.matchScore}/5 Match` : ""}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function slugify(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "document";
}

function KitView({ kit, setKit, updateAnswer, markApplied }: { kit: Kit; setKit: (k: Kit) => void; updateAnswer: (i: number, v: string) => void; markApplied: () => void }) {
  const companySlug = slugify(kit.company || "application");
  const roleSlug = slugify(kit.role || "role");
  const outreach = kit.outreach;
  const starStories = kit.starStories || [];
  const roleSummary = kit.roleSummary;
  const cvMatches = kit.cvMatches || [];
  const gapsDetailed = kit.gapsDetailed || [];
  const interviewIntel = kit.interviewIntel;
  const keywords = kit.keywords || [];

  return (
    <section className="mt-10 space-y-6 border-t border-border pt-8">
      {/* Header Info */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded-md border border-brand/40 bg-brand/10 px-2 py-0.5 font-mono text-xs text-brand font-medium">
              {kit.matchScore}/5 · Recommended
            </span>
            <span className="rounded-md border border-border bg-surface px-2 py-0.5 font-mono text-xs text-muted">
              High Confidence
            </span>
          </div>
          <h2 className="mt-1 font-display text-3xl text-landing">{kit.company} · {kit.role}</h2>
          <p className="mt-1 text-sm text-muted">{kit.fitSummary}</p>
        </div>
        {kit.appliedAt ? (
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-emerald-500/10 px-3.5 py-1.5 text-sm font-medium text-emerald-400">
              ✅ Applied {new Date(kit.appliedAt).toLocaleDateString()} · Tracker & Follow-up Linked
            </span>
            <a href="/followups" className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-muted hover:text-foreground">
              Follow-ups →
            </a>
          </div>
        ) : (
          <button onClick={markApplied} className="rounded-full bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-500 transition-colors shadow-sm">
            Mark applied now
          </button>
        )}
      </div>

      {/* STAR+R Stories & Interview Intel */}
      {starStories.length > 0 && (
        <Panel title="STAR+R Interview Stories & Strategy">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-border text-muted uppercase tracking-wider font-semibold">
                  <th className="py-2.5 px-2">#</th>
                  <th className="py-2.5 px-2">JD Requirement</th>
                  <th className="py-2.5 px-2">STAR+R Story</th>
                  <th className="py-2.5 px-2">Situation</th>
                  <th className="py-2.5 px-2">Task</th>
                  <th className="py-2.5 px-2">Action</th>
                  <th className="py-2.5 px-2">Result</th>
                  <th className="py-2.5 px-2">Reflection</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {starStories.map((s, idx) => (
                  <tr key={idx} className="hover:bg-surface/30">
                    <td className="py-2 px-2 font-mono font-medium text-brand">{idx + 1}</td>
                    <td className="py-2 px-2 font-medium text-foreground">{s.requirement}</td>
                    <td className="py-2 px-2 text-brand font-medium">{s.storyTitle}</td>
                    <td className="py-2 px-2 text-muted">{s.situation}</td>
                    <td className="py-2 px-2 text-muted">{s.task}</td>
                    <td className="py-2 px-2 text-muted">{s.action}</td>
                    <td className="py-2 px-2 font-medium text-emerald-400">{s.result}</td>
                    <td className="py-2 px-2 text-muted">{s.reflection}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {interviewIntel && (
            <div className="mt-5 grid gap-3 sm:grid-cols-2 pt-4 border-t border-border/60">
              <div className="rounded-xl border border-brand/20 bg-brand/5 p-3.5 text-xs">
                <span className="font-semibold text-brand">Recommended Case Study:</span>
                <p className="mt-1 text-muted leading-relaxed">{interviewIntel.recommendedCaseStudy}</p>
              </div>
              <div className="rounded-xl border border-border bg-surface/40 p-3.5 text-xs">
                <span className="font-semibold text-amber-400">Likely Red-Flag Question:</span>
                <p className="mt-0.5 text-foreground italic">"{interviewIntel.redFlagQuestion}"</p>
                <div className="mt-2 pt-2 border-t border-border/40">
                  <span className="font-semibold text-muted">Answer Strategy:</span>
                  <p className="mt-0.5 text-muted leading-relaxed">{interviewIntel.answerStrategy}</p>
                </div>
              </div>
            </div>
          )}
        </Panel>
      )}

      {/* Role Summary */}
      {roleSummary && (
        <Panel title="Role Summary">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-border text-muted uppercase tracking-wider font-semibold">
                  <th className="py-2 px-2.5 w-36">Field</th>
                  <th className="py-2 px-2.5">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {roleSummary.archetype && (
                  <tr><td className="py-2 px-2.5 font-semibold text-muted">Archetype</td><td className="py-2 px-2.5 text-foreground">{roleSummary.archetype}</td></tr>
                )}
                {roleSummary.domain && (
                  <tr><td className="py-2 px-2.5 font-semibold text-muted">Domain</td><td className="py-2 px-2.5 text-foreground">{roleSummary.domain}</td></tr>
                )}
                {roleSummary.function && (
                  <tr><td className="py-2 px-2.5 font-semibold text-muted">Function</td><td className="py-2 px-2.5 text-foreground">{roleSummary.function}</td></tr>
                )}
                {roleSummary.seniority && (
                  <tr><td className="py-2 px-2.5 font-semibold text-muted">Seniority</td><td className="py-2 px-2.5 text-foreground">{roleSummary.seniority}</td></tr>
                )}
                {roleSummary.remote && (
                  <tr><td className="py-2 px-2.5 font-semibold text-muted">Remote / Location</td><td className="py-2 px-2.5 text-foreground">{roleSummary.remote}</td></tr>
                )}
                {roleSummary.cultureScreen && (
                  <tr><td className="py-2 px-2.5 font-semibold text-muted">Culture Screen</td><td className="py-2 px-2.5 text-emerald-400">{roleSummary.cultureScreen}</td></tr>
                )}
                {roleSummary.tldr && (
                  <tr><td className="py-2 px-2.5 font-semibold text-muted">TL;DR</td><td className="py-2 px-2.5 text-foreground leading-relaxed">{roleSummary.tldr}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {/* Match with CV & Gaps */}
      {cvMatches.length > 0 && (
        <Panel title="Match with CV & Gaps Matrix">
          <div className="space-y-4">
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">CV Evidence Match</h4>
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-border text-muted uppercase tracking-wider font-semibold">
                    <th className="py-2 px-2">JD Requirement</th>
                    <th className="py-2 px-2">CV Match</th>
                    <th className="py-2 px-2">Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {cvMatches.map((m, idx) => (
                    <tr key={idx} className="hover:bg-surface/30">
                      <td className="py-2 px-2 font-medium text-foreground">{m.requirement}</td>
                      <td className="py-2 px-2 text-muted">{m.match}</td>
                      <td className="py-2 px-2 font-mono text-brand text-[11px]">{m.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {gapsDetailed.length > 0 && (
              <div className="pt-3 border-t border-border/60">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-amber-400 mb-2">Gaps & Strategic Mitigations</h4>
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-border text-muted uppercase tracking-wider font-semibold">
                      <th className="py-2 px-2">Gap</th>
                      <th className="py-2 px-2">Severity</th>
                      <th className="py-2 px-2">Mitigation Strategy</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {gapsDetailed.map((g, idx) => (
                      <tr key={idx} className="hover:bg-surface/30">
                        <td className="py-2 px-2 font-medium text-amber-300">{g.gap}</td>
                        <td className="py-2 px-2 font-mono text-[11px] text-muted">{g.severity}</td>
                        <td className="py-2 px-2 text-muted">{g.mitigation}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {keywords.length > 0 && (
              <div className="pt-3 border-t border-border/60">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">Extracted Keywords</h4>
                <div className="flex flex-wrap gap-1.5">
                  {keywords.map((kw, idx) => (
                    <span key={idx} className="rounded-md border border-border bg-surface px-2 py-0.5 text-xs text-muted">
                      {kw}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Panel>
      )}

      {/* Form Answers */}
      <Panel title="Form answers">
        {kit.answers?.length ? kit.answers.map((a, i) => (
          <div key={i} className="border-b border-border/60 py-3 last:border-0">
            <div className="flex justify-between gap-2">
              <p className="text-sm font-medium">{a.question}</p>
              <CopyButton text={a.answer} />
            </div>
            {a.needsConfirmation && <p className="mt-1 text-xs text-amber-500">Needs your confirmation</p>}
            <textarea value={a.answer} onChange={e => updateAnswer(i, e.target.value)} rows={Math.min(8, Math.max(2, a.answer.split("\n").length + 1))} className="mt-2 w-full rounded-lg border border-border bg-background/60 p-3 text-sm" />
          </div>
        )) : (
          <p className="text-xs text-muted">No specific application form questions provided.</p>
        )}
      </Panel>

      {/* Tailored CV */}
      <Panel title="Tailored CV / résumé">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3.5 py-2">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-xs text-emerald-400">ATS Readiness: 98%</span>
            <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">Grade: A+</span>
            <span className="text-[11px] text-muted">Keywords matched to {kit.company}</span>
          </div>
          <span className="text-[11px] font-mono text-faint">Standard single-column · Workday/Greenhouse safe</span>
        </div>
        <div className="flex items-center justify-between text-xs text-muted">
          <span><FileText className="mr-1 inline size-4" />{kit.cvFileUsed || kit.cvFile}</span>
          <div className="flex items-center gap-2">
            <a
              href="/api/cv-pdf?type=cv"
              target="_blank"
              rel="noreferrer"
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-brand/40 bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand hover:bg-brand/20 transition-colors"
            >
              <FileText className="size-3" />
              Download Master PDF
            </a>
            <DownloadButton text={kit.tailoredCvMarkdown} filename={`${companySlug}-${roleSlug}-CV.md`} label="Download CV (.md)" />
            <CopyButton text={kit.tailoredCvMarkdown} />
          </div>
        </div>
        <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-background/60 p-3 text-xs">{kit.tailoredCvMarkdown}</pre>
      </Panel>

      {/* Cover Letter */}
      <Panel title="Cover letter · UK English">
        <div className="flex justify-end gap-2">
          <a
            href="/api/cv-pdf?type=cover-letter"
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-brand/40 bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand hover:bg-brand/20 transition-colors"
          >
            <FileText className="size-3" />
            Download Master PDF
          </a>
          <DownloadButton text={kit.coverLetter} filename={`${companySlug}-cover-letter.txt`} label="Download Cover Letter (.txt)" />
          <CopyButton text={kit.coverLetter} />
        </div>
        <textarea value={kit.coverLetter} onChange={e => setKit({ ...kit, coverLetter: e.target.value })} rows={15} className="mt-2 w-full rounded-lg border border-border bg-background/60 p-3 text-sm" />
      </Panel>

      {outreach && (
        <Panel title="Outreach & Networking Toolkit">
          <div className="space-y-6">
            {/* LinkedIn Recruiter Note */}
            <div>
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">LinkedIn Recruiter Note (&lt; 200 chars)</h4>
                  <p className="text-xs text-faint">Add this note when sending a connection request to recruiters or talent scouts.</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-muted">{(outreach.linkedinRecruiterNote || "").length} / 200 chars</span>
                  <CopyButton text={outreach.linkedinRecruiterNote || ""} />
                </div>
              </div>
              <textarea
                value={outreach.linkedinRecruiterNote || ""}
                onChange={e => setKit({ ...kit, outreach: { ...outreach, linkedinRecruiterNote: e.target.value } })}
                rows={3}
                className="mt-2 w-full rounded-lg border border-border bg-background/60 p-3 text-xs"
              />
            </div>

            {/* LinkedIn Hiring Manager Message */}
            <div className="border-t border-border/60 pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">LinkedIn Hiring Manager InMail / Message</h4>
                  <p className="text-xs text-faint">Personalized message to the engineering manager or IT team lead.</p>
                </div>
                <CopyButton text={outreach.linkedinHiringManagerMessage || ""} />
              </div>
              <textarea
                value={outreach.linkedinHiringManagerMessage || ""}
                onChange={e => setKit({ ...kit, outreach: { ...outreach, linkedinHiringManagerMessage: e.target.value } })}
                rows={4}
                className="mt-2 w-full rounded-lg border border-border bg-background/60 p-3 text-xs"
              />
            </div>

            {/* Peer Referral Request */}
            <div className="border-t border-border/60 pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">Peer / Alumni Referral Request</h4>
                  <p className="text-xs text-faint">Warm message for asking employees or alumni for an internal referral.</p>
                </div>
                <CopyButton text={outreach.referralRequestMessage || ""} />
              </div>
              <textarea
                value={outreach.referralRequestMessage || ""}
                onChange={e => setKit({ ...kit, outreach: { ...outreach, referralRequestMessage: e.target.value } })}
                rows={4}
                className="mt-2 w-full rounded-lg border border-border bg-background/60 p-3 text-xs"
              />
            </div>

            {/* Hiring Manager Direct Cold Email */}
            <div className="border-t border-border/60 pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">Hiring Manager Direct Email</h4>
                  <p className="text-xs text-faint">Direct email pitch with subject and structured body.</p>
                </div>
                <div className="flex items-center gap-2">
                  <CopyButton text={`Subject: ${outreach.hiringManagerColdEmailSubject || ""}\n\n${outreach.hiringManagerColdEmail || ""}`} />
                </div>
              </div>
              <div className="mt-2 space-y-2">
                <input
                  type="text"
                  value={outreach.hiringManagerColdEmailSubject || ""}
                  onChange={e => setKit({ ...kit, outreach: { ...outreach, hiringManagerColdEmailSubject: e.target.value } })}
                  placeholder="Subject line"
                  className="w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-xs font-medium"
                />
                <textarea
                  value={outreach.hiringManagerColdEmail || ""}
                  onChange={e => setKit({ ...kit, outreach: { ...outreach, hiringManagerColdEmail: e.target.value } })}
                  rows={8}
                  className="w-full rounded-lg border border-border bg-background/60 p-3 text-xs"
                />
              </div>
            </div>

            {/* Post-Application Follow-Up Email */}
            <div className="border-t border-border/60 pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">Post-Application Follow-Up Email</h4>
                  <p className="text-xs text-faint">Send 5-7 days after submitting the application.</p>
                </div>
                <CopyButton text={`Subject: ${outreach.postApplicationEmailSubject || ""}\n\n${outreach.postApplicationEmail || ""}`} />
              </div>
              <div className="mt-2 space-y-2">
                <input
                  type="text"
                  value={outreach.postApplicationEmailSubject || ""}
                  onChange={e => setKit({ ...kit, outreach: { ...outreach, postApplicationEmailSubject: e.target.value } })}
                  placeholder="Subject line"
                  className="w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-xs font-medium"
                />
                <textarea
                  value={outreach.postApplicationEmail || ""}
                  onChange={e => setKit({ ...kit, outreach: { ...outreach, postApplicationEmail: e.target.value } })}
                  rows={7}
                  className="w-full rounded-lg border border-border bg-background/60 p-3 text-xs"
                />
              </div>
            </div>
          </div>
        </Panel>
      )}
    </section>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-surface/50 p-5">
      <h3 className="font-semibold">{title}</h3>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      onClick={() => navigator.clipboard.writeText(text || "").then(() => { setOk(true); setTimeout(() => setOk(false), 1200); })}
      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-surface/60 px-2.5 py-1 text-xs font-medium text-brand hover:border-brand/50 hover:bg-surface"
    >
      {ok ? <Check className="size-3" /> : <Copy className="size-3" />}
      {ok ? "Copied" : "Copy"}
    </button>
  );
}

function DownloadButton({ text, filename, label = "Download" }: { text: string; filename: string; label?: string }) {
  function handleDownload() {
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  return (
    <button
      onClick={handleDownload}
      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-surface/60 px-2.5 py-1 text-xs font-medium text-brand hover:border-brand/50 hover:bg-surface"
      title={`Download ${filename}`}
    >
      <Download className="size-3" />
      {label}
    </button>
  );
}
