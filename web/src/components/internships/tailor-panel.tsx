"use client";

import { useEffect, useState } from "react";
import { X, Target, BookOpen, Zap, AlertTriangle, CheckCircle, ChevronRight, GraduationCap, Briefcase, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";

type TailorData = {
  internship: {
    company: string;
    role: string;
    track?: string;
    requirements?: string;
    notes?: string;
    deadline?: string;
    workAuth?: string;
    gradEligibility?: string;
  };
  fit: {
    level: "strong" | "moderate" | "stretch";
    skillCoverage: number;
    matchedSkills: string[];
    gapSkills: string[];
  };
  rankedExperience: {
    title: string;
    company: string;
    bullets: string[];
    score: number;
  }[];
  rankedProjects: {
    name: string;
    tech: string[];
    bullets: string[];
    score: number;
  }[];
  tailoredBullets: { source: string; bullet: string }[];
  prep: string[];
  leadProject: string;
  resume: {
    name: string;
    education: { school: string; degree: string; expected: string };
    certifications: string[];
    skills: Record<string, string[]>;
  };
};

const FIT_CONFIG = {
  strong: { label: "Strong Fit", tone: "good" as const, color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/10" },
  moderate: { label: "Moderate Fit", tone: "warn" as const, color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-500/10" },
  stretch: { label: "Stretch", tone: "bad" as const, color: "text-red-600 dark:text-red-400", bg: "bg-red-500/10" },
};

const TRACK_COLORS: Record<string, string> = {
  DS: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
  DA: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  BIE: "bg-teal-500/15 text-teal-700 dark:text-teal-400",
  SWE: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
};

export function TailorPanel({ internshipId, onClose }: { internshipId: string; onClose: () => void }) {
  const [data, setData] = useState<TailorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"fit" | "resume" | "prep">("fit");

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        // Always re-parse from the latest uploaded resume so swapping resumes takes effect immediately
        const parseRes = await fetch("/api/resume-profile", { method: "POST" });
        if (!parseRes.ok && parseRes.status !== 404) {
          const body = await parseRes.json().catch(() => null);
          setError(body?.error ?? "Could not parse resume — upload a resume first");
          return;
        }
        if (parseRes.status === 404) {
          setError("No resume uploaded yet — upload one on the Uploads page first");
          return;
        }

        const res = await fetch(`/api/internships/${internshipId}/tailor`);
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          setError(body?.error ?? "Failed to load tailoring data");
          return;
        }
        setData(await res.json());
      } catch {
        setError("Network error");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [internshipId]);

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="w-full max-w-3xl rounded-2xl border border-border bg-background p-8 shadow-xl text-center">
          <div className="animate-pulse text-muted">Analyzing fit...</div>
          <button onClick={onClose} className="mt-4 text-xs text-muted hover:text-foreground transition-colors">Cancel</button>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="w-full max-w-3xl rounded-2xl border border-border bg-background p-8 shadow-xl">
          <p className="text-red-500">{error ?? "Unknown error"}</p>
          <Button variant="outline" onClick={onClose} className="mt-4">Close</Button>
        </div>
      </div>
    );
  }

  const { internship, fit, rankedExperience, rankedProjects, tailoredBullets, prep, leadProject } = data;
  const fitCfg = FIT_CONFIG[fit.level];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex h-[90vh] w-full max-w-4xl flex-col rounded-2xl border border-border bg-background shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold truncate">{internship.company}</h2>
              {internship.track && (
                <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold", TRACK_COLORS[internship.track] ?? "bg-zinc-500/15 text-zinc-500")}>
                  {internship.track}
                </span>
              )}
              <Badge tone={fitCfg.tone}>{fitCfg.label}</Badge>
            </div>
            <p className="text-sm text-muted truncate">{internship.role}</p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-muted hover:bg-surface-hover transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border px-6">
          {([
            ["fit", "Fit Analysis", Target],
            ["resume", "Tailored Resume", Briefcase],
            ["prep", "Prep Dashboard", BookOpen],
          ] as const).map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={cn(
                "flex items-center gap-1.5 border-b-2 px-4 py-3 text-sm transition-colors",
                activeTab === key
                  ? "border-brand text-foreground font-medium"
                  : "border-transparent text-muted hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {activeTab === "fit" && (
            <FitTab fit={fit} fitCfg={fitCfg} internship={internship} leadProject={leadProject} />
          )}
          {activeTab === "resume" && (
            <ResumeTab
              rankedExperience={rankedExperience}
              rankedProjects={rankedProjects}
              tailoredBullets={tailoredBullets}
              resume={data.resume}
              internship={internship}
            />
          )}
          {activeTab === "prep" && (
            <PrepTab prep={prep} fit={fit} internship={internship} />
          )}
        </div>
      </div>
    </div>
  );
}

function FitTab({
  fit,
  fitCfg,
  internship,
  leadProject,
}: {
  fit: TailorData["fit"];
  fitCfg: (typeof FIT_CONFIG)[keyof typeof FIT_CONFIG];
  internship: TailorData["internship"];
  leadProject: string;
}) {
  return (
    <>
      {/* Fit score */}
      <Card className={cn("p-5", fitCfg.bg)}>
        <div className="flex items-center justify-between">
          <div>
            <div className={cn("text-2xl font-bold", fitCfg.color)}>
              {fit.skillCoverage}% Skill Match
            </div>
            <p className="mt-1 text-sm text-muted">
              {fit.matchedSkills.length} of {fit.matchedSkills.length + fit.gapSkills.length} required skills matched
            </p>
          </div>
          <div className={cn("flex h-16 w-16 items-center justify-center rounded-full border-4", {
            "border-emerald-500": fit.level === "strong",
            "border-amber-500": fit.level === "moderate",
            "border-red-500": fit.level === "stretch",
          })}>
            <span className={cn("text-xl font-bold", fitCfg.color)}>
              {fit.level === "strong" ? "A" : fit.level === "moderate" ? "B" : "C"}
            </span>
          </div>
        </div>
      </Card>

      {/* Matched skills */}
      {fit.matchedSkills.length > 0 && (
        <Card className="p-5">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <CheckCircle className="h-4 w-4 text-emerald-500" />
            Skills You Have ({fit.matchedSkills.length})
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {fit.matchedSkills.map((s) => (
              <span key={s} className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                {s}
              </span>
            ))}
          </div>
        </Card>
      )}

      {/* Skill gaps */}
      {fit.gapSkills.length > 0 && (
        <Card className="p-5">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Skills to Develop ({fit.gapSkills.length})
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {fit.gapSkills.map((s) => (
              <span key={s} className="rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                {s}
              </span>
            ))}
          </div>
        </Card>
      )}

      {/* Lead project */}
      <Card className="p-5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <FolderOpen className="h-4 w-4 text-brand" />
          Lead With This Project
        </div>
        <p className="mt-2 text-sm text-muted">{leadProject}</p>
      </Card>

      {/* Requirements & eligibility */}
      {(internship.requirements || internship.workAuth || internship.gradEligibility) && (
        <Card className="p-5 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <GraduationCap className="h-4 w-4 text-muted" />
            Requirements & Eligibility
          </div>
          {internship.requirements && (
            <div>
              <p className="text-xs font-medium text-muted uppercase tracking-wider">Requirements</p>
              <p className="mt-1 text-sm">{internship.requirements}</p>
            </div>
          )}
          {internship.workAuth && (
            <div>
              <p className="text-xs font-medium text-muted uppercase tracking-wider">Work Authorization</p>
              <p className="mt-1 text-sm">{internship.workAuth}</p>
            </div>
          )}
          {internship.gradEligibility && (
            <div>
              <p className="text-xs font-medium text-muted uppercase tracking-wider">Grad Eligibility</p>
              <p className="mt-1 text-sm">{internship.gradEligibility}</p>
            </div>
          )}
        </Card>
      )}
    </>
  );
}

function ResumeTab({
  rankedExperience,
  rankedProjects,
  tailoredBullets,
  resume,
  internship,
}: {
  rankedExperience: TailorData["rankedExperience"];
  rankedProjects: TailorData["rankedProjects"];
  tailoredBullets: TailorData["tailoredBullets"];
  resume: TailorData["resume"];
  internship: TailorData["internship"];
}) {
  return (
    <>
      <Card className="p-5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Briefcase className="h-4 w-4 text-brand" />
          Tailored Resume Order for {internship.company}
        </div>
        <p className="mt-1 text-xs text-muted">
          Experience and projects reordered by relevance to this role. Use this order when customizing your resume.
        </p>
      </Card>

      {/* Tailored experience order */}
      <Card className="p-5">
        <h3 className="text-sm font-semibold mb-3">Experience (by relevance)</h3>
        <div className="space-y-4">
          {rankedExperience.map((exp, idx) => (
            <div key={idx} className="border-l-2 border-border pl-4">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand/10 text-[10px] font-bold text-brand">
                  {idx + 1}
                </span>
                <span className="text-sm font-medium">{exp.title}</span>
                <span className="text-xs text-muted">@ {exp.company}</span>
                <Badge tone={exp.score > 5 ? "good" : exp.score > 2 ? "info" : "muted"} className="text-[10px] ml-auto">
                  {exp.score > 5 ? "High" : exp.score > 2 ? "Medium" : "Low"} relevance
                </Badge>
              </div>
              <ul className="mt-2 space-y-1">
                {exp.bullets.map((b, j) => (
                  <li key={j} className="text-xs text-muted flex gap-1.5">
                    <ChevronRight className="h-3 w-3 mt-0.5 shrink-0 text-border" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Card>

      {/* Tailored projects order */}
      <Card className="p-5">
        <h3 className="text-sm font-semibold mb-3">Projects (by relevance)</h3>
        <div className="space-y-4">
          {rankedProjects.map((proj, idx) => (
            <div key={idx} className="border-l-2 border-border pl-4">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand/10 text-[10px] font-bold text-brand">
                  {idx + 1}
                </span>
                <span className="text-sm font-medium">{proj.name}</span>
                <Badge tone={proj.score > 5 ? "good" : proj.score > 2 ? "info" : "muted"} className="text-[10px] ml-auto">
                  {proj.score > 5 ? "High" : proj.score > 2 ? "Medium" : "Low"} relevance
                </Badge>
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {proj.tech.map((t) => (
                  <span key={t} className="rounded bg-surface-hover px-1.5 py-0.5 text-[10px] text-muted">{t}</span>
                ))}
              </div>
              <ul className="mt-2 space-y-1">
                {proj.bullets.map((b, j) => (
                  <li key={j} className="text-xs text-muted flex gap-1.5">
                    <ChevronRight className="h-3 w-3 mt-0.5 shrink-0 text-border" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Card>

      {/* Top bullets to highlight */}
      <Card className="p-5">
        <h3 className="text-sm font-semibold mb-3">
          <Zap className="inline h-4 w-4 text-brand mr-1" />
          Top Bullets to Highlight
        </h3>
        <p className="text-xs text-muted mb-3">The most relevant points from your resume for this specific role:</p>
        <ol className="space-y-2">
          {tailoredBullets.slice(0, 6).map((tb, idx) => (
            <li key={idx} className="flex gap-2 text-xs">
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-brand/10 text-[9px] font-bold text-brand mt-0.5">
                {idx + 1}
              </span>
              <div>
                <span className="font-medium text-muted">{tb.source}:</span>{" "}
                <span>{tb.bullet}</span>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      {/* Skills to feature */}
      <Card className="p-5">
        <h3 className="text-sm font-semibold mb-3">Skills Section</h3>
        <div className="space-y-2">
          {Object.entries(resume.skills).map(([category, skills]) => (
            <div key={category}>
              <span className="text-xs font-medium text-muted capitalize">{category}: </span>
              <span className="text-xs">{skills.join(", ")}</span>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}

function PrepTab({
  prep,
  fit,
  internship,
}: {
  prep: TailorData["prep"];
  fit: TailorData["fit"];
  internship: TailorData["internship"];
}) {
  return (
    <>
      {/* Deadline warning */}
      {internship.deadline && (
        <Card className={cn("p-5", internship.deadline < new Date().toISOString().slice(0, 10) ? "border-red-500/30 bg-red-500/5" : "border-amber-500/30 bg-amber-500/5")}>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle className="h-4 w-4" />
            Deadline: {internship.deadline}
          </div>
          {internship.deadline < new Date().toISOString().slice(0, 10) && (
            <p className="mt-1 text-xs text-red-500">This deadline has passed. Check if the application is still accepting submissions.</p>
          )}
        </Card>
      )}

      {/* Prep checklist */}
      <Card className="p-5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <BookOpen className="h-4 w-4 text-brand" />
          Prep Checklist
        </div>
        <div className="mt-3 space-y-3">
          {prep.map((tip, idx) => (
            <div key={idx} className="flex gap-3 text-sm">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand/10 text-[10px] font-bold text-brand mt-0.5">
                {idx + 1}
              </span>
              <p>{tip}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* Skill coverage breakdown */}
      <Card className="p-5">
        <h3 className="text-sm font-semibold mb-3">Skill Coverage</h3>
        <div className="relative h-3 w-full rounded-full bg-surface-hover overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all", {
              "bg-emerald-500": fit.level === "strong",
              "bg-amber-500": fit.level === "moderate",
              "bg-red-500": fit.level === "stretch",
            })}
            style={{ width: `${fit.skillCoverage}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-muted">{fit.skillCoverage}% of identified requirements matched</p>

        <div className="mt-4 grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400 mb-1">You Have</p>
            <div className="flex flex-wrap gap-1">
              {fit.matchedSkills.map((s) => (
                <span key={s} className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-400">{s}</span>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-amber-600 dark:text-amber-400 mb-1">To Learn</p>
            <div className="flex flex-wrap gap-1">
              {fit.gapSkills.length > 0 ? fit.gapSkills.map((s) => (
                <span key={s} className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-400">{s}</span>
              )) : (
                <span className="text-[10px] text-muted">No gaps identified</span>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* Notes from tracker */}
      {internship.notes && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold mb-2">Intel & Notes</h3>
          <p className="text-sm text-muted">{internship.notes}</p>
        </Card>
      )}
    </>
  );
}
