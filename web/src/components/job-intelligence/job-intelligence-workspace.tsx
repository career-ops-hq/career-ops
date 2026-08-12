"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";

/* ── Types ──────────────────────────────────────────────────────────── */

interface SavedSource {
  url: string; role: string; company: string | null; location: string | null;
  compensation: string | null; done: boolean;
}
interface AnalysisSummary {
  id: string; jobTitle: string; company: string | null; location: string | null;
  workMode: string; employmentType: string | null; seniority: string | null;
  salary: string | null; requirementCount: number; verdict: string | null;
  score: number | null; analyzedAt: string | null;
}
interface RequirementMatch {
  id: string; text: string; category: string; classification: string;
  status: string; confidence: string; explanation: string;
  evidence: Array<{ term: string; status: string; source: string; snippet: string }>;
}
interface GapItem extends RequirementMatch { recommendedAction?: string; }
interface GapQuestion { id: string; requirementId: string | null; question: string; reason: string; }
interface MatchReport {
  verdict: { label: string; score: number; coverage: number;
    seniority: { score: number; reason: string }; location: { score: number; reason: string };
    workMode: { score: number; reason: string }; riskFactors: string[]; reasons: string[]; };
  requirementMatches: RequirementMatch[];
  gaps: { verified: GapItem[]; potential: GapItem[]; transferable: GapItem[];
    missingEvidence: GapItem[]; gaps: GapItem[]; questions: GapQuestion[]; };
  recommendedActions: string[];
}
interface FullAnalysis {
  id: string; meta: { source: string; url: string | null; fileName: string | null };
  analysis: { metadata: { jobTitle: string; company: string | null; location: string | null;
    country: string | null; workMode: string; seniority: { level: string; label: string } | null; };
    requirements: Array<{ id: string; text: string; category: string; classification: string; reason: string }>;
    responsibilities: Array<{ id: string; text: string }>;
    salary: { raw: string; currency: string; min: number; max: number; period: string } | null;
    keywords: string[]; };
  report: MatchReport; summary: AnalysisSummary;
}

/* ── Score → Badge colour ────────────────────────────────────────────── */

function verdictBadge(verdict: string | null) {
  if (!verdict) return "muted" as const;
  if (verdict.includes("Excellent") || verdict.includes("Strong")) return "good" as const;
  if (verdict.includes("Partial")) return "warn" as const;
  return "bad" as const;
}

function statusBadge(status: string) {
  if (status === "verified") return "good" as const;
  if (status === "potential") return "info" as const;
  if (status === "transferable") return "warn" as const;
  return "muted" as const;
}

function classBadge(c: string) {
  if (c === "Required") return "warn" as const;
  if (c === "Preferred") return "info" as const;
  if (c === "Optional") return "muted" as const;
  return "muted" as const;
}

/* ── Workspace ───────────────────────────────────────────────────────── */

export function JobIntelligenceWorkspace() {
  const router = useRouter();
  const [savedSources, setSavedSources] = useState<SavedSource[]>([]);
  const [analyses, setAnalyses] = useState<AnalysisSummary[]>([]);
  const [selected, setSelected] = useState<FullAnalysis | null>(null);
  const [importing, setImporting] = useState(false);
  const [importTab, setImportTab] = useState<"text"|"url"|"pdf"|"saved">("text");
  const [importText, setImportText] = useState("");
  const [importUrl, setImportUrl] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [matchTab, setMatchTab] = useState<"match"|"gaps"|"actions">("match");
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const reload = useCallback(async () => {
    try {
      const r = await fetch("/api/jobs/intelligence");
      if (!r.ok) return;
      const d = await r.json();
      setSavedSources(d.savedSources || []);
      setAnalyses(d.analyses || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  async function handleImport() {
    setImportError(null);
    let body: Record<string, unknown> = {};
    if (importTab === "text") {
      if (importText.length < 40) { setImportError("Minst 40 tecken krävs."); return; }
      body = { source: "text", text: importText };
    } else if (importTab === "url") {
      if (!importUrl.startsWith("http")) { setImportError("Ange en giltig URL."); return; }
      body = { source: "url", url: importUrl };
    } else if (importTab === "pdf") {
      setImportError("PDF-upload sker via filfälten nedan."); return;
    } else if (importTab === "saved") {
      body = { source: "saved", url: importUrl };
    }
    setImporting(true);
    try {
      const r = await fetch("/api/jobs/intelligence", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Import misslyckades");
      setSelected(d.analysis);
      setAnswers({});
      setImporting(false);
      setImportText(""); setImportUrl("");
      await reload();
    } catch (e: unknown) {
      setImportError(e instanceof Error ? e.message : "Okänt fel");
      setImporting(false);
    }
  }

  async function handleFileUpload(file: File) {
    setImportError(null); setImporting(true);
    try {
      const b64 = await file.arrayBuffer();
      const r = await fetch("/api/jobs/intelligence", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "pdf", fileB64: btoa(String.fromCharCode(...new Uint8Array(b64))), fileName: file.name }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "PDF-import misslyckades");
      setSelected(d.analysis); setImporting(false); setImportText(""); setImportUrl(""); setAnswers({});
      await reload();
    } catch (e: unknown) {
      setImportError(e instanceof Error ? e.message : "Okänt fel");
      setImporting(false);
    }
  }

  async function answerQuestion(qid: string, value: string) {
    if (!selected) return;
    try {
      const r = await fetch(`/api/jobs/intelligence/${selected.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: { [qid]: value } }),
      });
      if (!r.ok) return;
      const d = await r.json();
      setSelected(d.analysis);
      setAnswers((prev) => ({ ...prev, [qid]: value }));
      await reload();
    } catch { /* ignore */ }
  }

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-8">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[var(--fg)]">Jobbintelligens</h1>
          <p className="text-sm text-[var(--muted)]">Analysera jobbannonser och matcha mot din masterprofil.</p>
        </div>
        <Button variant="primary" onClick={() => setImporting(true)}>
          <span className="text-lg leading-none">+</span> Importera annons
        </Button>
      </div>

      {/* 3-panel layout */}
      <div className="grid gap-4 lg:grid-cols-[300px_1fr_1fr]">

        {/* ── Panel 1: Job Results ── */}
        <Card className="h-fit max-h-[70vh] overflow-y-auto">
          <div className="mb-3 flex items-center justify-between px-1 pt-1">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--brand)]">
              Analyserade jobb
            </p>
            <Badge tone="muted">{analyses.length}</Badge>
          </div>
          {analyses.length === 0 ? (
            <p className="px-1 pb-3 text-sm text-[var(--muted)]">
              Inga analyserade jobb ännu. Klicka på &quot;Importera annons&quot; för att komma igång.
            </p>
          ) : (
            <ul className="space-y-2">
              {analyses.map((a) => (
                <li key={a.id}>
                  <button
                    onClick={async () => {
                      try {
                        const r = await fetch(`/api/jobs/intelligence/${a.id}`);
                        if (r.ok) { setSelected(await r.json()); setAnswers({}); }
                      } catch { /* ignore */ }
                    }}
                    className={cn(
                      "w-full rounded-lg border px-3 py-2.5 text-left transition-colors",
                      selected?.id === a.id
                        ? "border-[var(--brand)] bg-[var(--brand)]/5"
                        : "border-[var(--border)] hover:bg-[var(--surface-hover)]",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-[var(--fg)]">
                          {a.jobTitle || "Namnlös"}
                        </p>
                        <p className="truncate text-xs text-[var(--muted)]">
                          {[a.company, a.location].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                      {a.verdict && <Badge tone={verdictBadge(a.verdict)}>{a.score ?? "?"}%</Badge>}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* ── Panel 2: Job Details ── */}
        <Card className="min-h-[400px]">
          <div className="px-1 pt-1">
            <p className="mb-2 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--brand)]">
              Jobbdetaljer
            </p>
            {selected ? (
              <div className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-[var(--fg)]">
                    {selected.analysis.metadata.jobTitle}
                  </h2>
                  <p className="text-sm text-[var(--muted)]">
                    {[selected.analysis.metadata.company, selected.analysis.metadata.location]
                      .filter(Boolean).join(" · ")}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {selected.analysis.metadata.workMode && (
                      <Badge tone="info">{selected.analysis.metadata.workMode}</Badge>
                    )}
                    {selected.analysis.metadata.seniority && (
                      <Badge tone="muted">{selected.analysis.metadata.seniority.label}</Badge>
                    )}
                    {selected.analysis.salary && (
                      <Badge tone="good">{selected.analysis.salary.raw}</Badge>
                    )}
                  </div>
                  <div className="mt-3">
                    <Button
                      onClick={() => router.push(`/cv/tailor/${selected.id}`)}
                      className="w-full sm:w-auto"
                    >
                      Anpassa CV
                    </Button>
                  </div>
                </div>

                {/* Requirements */}
                <div>
                  <p className="mb-1 text-sm font-semibold text-[var(--fg)]">
                    Krav ({selected.analysis.requirements.length})
                  </p>
                  <ul className="space-y-1">
                    {selected.analysis.requirements.map((r) => (
                      <li key={r.id} className="flex items-start gap-2 text-sm">
                        <Badge tone={classBadge(r.classification)} className="mt-0.5 shrink-0">
                          {r.classification.slice(0, 3)}
                        </Badge>
                        <span className="text-[var(--fg)]">{r.text}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Responsibilities */}
                {selected.analysis.responsibilities.length > 0 && (
                  <div>
                    <p className="mb-1 text-sm font-semibold text-[var(--fg)]">
                      Ansvarsområden ({selected.analysis.responsibilities.length})
                    </p>
                    <ul className="space-y-1">
                      {selected.analysis.responsibilities.map((r) => (
                        <li key={r.id} className="text-sm text-[var(--fg)]">• {r.text}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Keywords */}
                {selected.analysis.keywords.length > 0 && (
                  <div>
                    <p className="mb-1 text-sm font-semibold text-[var(--fg)]">Nyckelord</p>
                    <div className="flex flex-wrap gap-1.5">
                      {selected.analysis.keywords.map((k) => (
                        <Badge key={k} tone="muted">{k}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-[var(--muted)]">
                Välj ett analyserat jobb till vänster för att se detaljer.
              </p>
            )}
          </div>
        </Card>

        {/* ── Panel 3: AI Match + Gaps ── */}
        <Card className="min-h-[400px]">
          <div className="px-1 pt-1">
            <p className="mb-2 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--brand)]">
              AI Match & Gap-analys
            </p>

            {selected?.report ? (
              <div className="space-y-4">
                {/* Verdict summary */}
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <Badge tone={verdictBadge(selected.report.verdict.label)}>
                        {selected.report.verdict.label}
                      </Badge>
                      <span className="ml-2 text-sm font-semibold text-[var(--fg)]">
                        {selected.report.verdict.score}%
                      </span>
                    </div>
                    <span className="text-xs text-[var(--muted)]">
                      Täckning: {selected.report.verdict.coverage}%
                    </span>
                  </div>
                </div>

                {/* Tab selector */}
                <div className="flex gap-1 rounded-lg border border-[var(--border)] p-0.5">
                  {(["match", "gaps", "actions"] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setMatchTab(tab)}
                      className={cn(
                        "flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                        matchTab === tab ? "bg-[var(--brand)] text-white" : "hover:bg-[var(--surface-hover)] text-[var(--muted)]",
                      )}
                    >
                      {tab === "match" && `Matchning (${selected.report.requirementMatches.length})`}
                      {tab === "gaps" && `Brister (${selected.report.gaps.gaps.length})`}
                      {tab === "actions" && `Åtgärder (${selected.report.recommendedActions.length})`}
                    </button>
                  ))}
                </div>

                {/* Tab content */}
                {matchTab === "match" && (
                  <ul className="space-y-2">
                    {selected.report.requirementMatches.map((m) => (
                      <li key={m.id} className="rounded-lg border border-[var(--border)] p-2.5">
                        <div className="mb-1 flex items-start justify-between gap-2">
                          <span className="text-sm text-[var(--fg)]">{m.text}</span>
                          <Badge tone={statusBadge(m.status)} className="shrink-0">
                            {m.status}
                          </Badge>
                        </div>
                        <p className="text-xs leading-relaxed text-[var(--muted)]">
                          {m.explanation}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}

                {matchTab === "gaps" && (
                  <div className="space-y-3">
                    {selected.report.gaps.gaps.length > 0 && (
                      <ul className="space-y-2">
                        {selected.report.gaps.gaps.map((g) => (
                          <li key={g.id} className="rounded-lg border border-[var(--border)] p-2.5">
                            <p className="mb-1 text-sm font-medium text-[var(--fg)]">{g.text}</p>
                            {g.recommendedAction && (
                              <p className="text-xs font-medium text-[var(--brand)]">
                                → {g.recommendedAction}
                              </p>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    {selected.report.gaps.gaps.length === 0 && (
                      <p className="text-sm text-[var(--muted)]">Inga brister identifierade.</p>
                    )}

                    {/* Questions for the user */}
                    {selected.report.gaps.questions.length > 0 && (
                      <div>
                        <p className="mb-1 text-sm font-semibold text-[var(--fg)]">
                          Frågor till dig ({selected.report.gaps.questions.length})
                        </p>
                        <ul className="space-y-2">
                          {selected.report.gaps.questions.map((q) => (
                            <li key={q.id} className="rounded-lg border border-[var(--border)] p-2.5">
                              <p className="mb-2 text-sm text-[var(--fg)]">{q.question}</p>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => answerQuestion(q.id, "yes")}
                                  className={cn(
                                    "rounded-md border px-3 py-1 text-xs font-medium transition-colors",
                                    answers[q.id] === "yes"
                                      ? "border-[var(--brand)] bg-[var(--brand)]/10 text-[var(--brand)]"
                                      : "border-[var(--border)] text-[var(--muted)] hover:bg-[var(--surface-hover)]",
                                  )}
                                >
                                  Ja
                                </button>
                                <button
                                  onClick={() => answerQuestion(q.id, "no")}
                                  className={cn(
                                    "rounded-md border px-3 py-1 text-xs font-medium transition-colors",
                                    answers[q.id] === "no"
                                      ? "border-[var(--brand)] bg-[var(--brand)]/10 text-[var(--brand)]"
                                      : "border-[var(--border)] text-[var(--muted)] hover:bg-[var(--surface-hover)]",
                                  )}
                                >
                                  Nej
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {matchTab === "actions" && (
                  <ol className="list-decimal space-y-2 pl-4">
                    {selected.report.recommendedActions.map((a, i) => (
                      <li key={i} className="text-sm text-[var(--fg)]">{a}</li>
                    ))}
                  </ol>
                )}

                {/* Risk factors */}
                {selected.report.verdict.riskFactors.length > 0 && (
                  <div className="rounded-xl border border-amber-400/30 bg-amber-500/5 p-3">
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-amber-600">
                      Riskfaktorer
                    </p>
                    <ul className="space-y-1">
                      {selected.report.verdict.riskFactors.map((r, i) => (
                        <li key={i} className="text-xs text-[var(--fg)]">⚠ {r}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-[var(--muted)]">
                Välj ett jobb för att se matchning och gap-analys.
              </p>
            )}
          </div>
        </Card>
      </div>

      {/* ── Import modal ── */}
      {importing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <Card className="w-full max-w-lg p-6" corner="br">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-[var(--fg)]">Importera jobbannons</h2>
              <button onClick={() => setImporting(false)} className="text-[var(--muted)] hover:text-[var(--fg)]">✕</button>
            </div>

            {/* Tab bar */}
            <div className="mb-4 flex gap-1 rounded-lg border border-[var(--border)] p-0.5">
              {(["text", "url", "pdf", "saved"] as const).map((tab) => (
                <button key={tab} onClick={() => setImportTab(tab)}
                  className={cn("flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                    importTab === tab ? "bg-[var(--brand)] text-white" : "hover:bg-[var(--surface-hover)] text-[var(--muted)]",
                  )}>
                  {tab === "text" && "Text"}
                  {tab === "url" && "URL"}
                  {tab === "pdf" && "PDF"}
                  {tab === "saved" && "Sparade"}
                </button>
              ))}
            </div>

            {importError && (
              <div className="mb-3 rounded-lg border border-red-400/30 bg-red-500/5 p-2.5 text-sm text-red-600">
                {importError}
              </div>
            )}

            {importTab === "text" && (
              <textarea value={importText} onChange={(e) => setImportText(e.target.value)}
                rows={10}
                placeholder="Klistra in hela jobbannonsen här..."
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--fg)] placeholder:text-[var(--muted)] focus:border-[var(--brand)] focus:outline-none"
              />
            )}

            {importTab === "url" && (
              <input value={importUrl} onChange={(e) => setImportUrl(e.target.value)}
                placeholder="https://exempel.se/jobb/staff-engineer"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--fg)] placeholder:text-[var(--muted)] focus:border-[var(--brand)] focus:outline-none"
              />
            )}

            {importTab === "pdf" && (
              <div className="rounded-lg border-2 border-dashed border-[var(--border)] p-6 text-center">
                <p className="mb-2 text-sm text-[var(--muted)]">Välj en PDF-fil (max 10 MB)</p>
                <input type="file" accept=".pdf,application/pdf"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); }}
                  className="text-sm"
                />
              </div>
            )}

            {importTab === "saved" && (
              <div className="max-h-[200px] space-y-1 overflow-y-auto">
                {savedSources.length === 0 ? (
                  <p className="text-sm text-[var(--muted)]">Inga sparade jobb i pipeline ännu.</p>
                ) : savedSources.map((s) => (
                  <button key={s.url || s.role}
                    onClick={() => { setImportUrl(s.url); }}
                    className={cn(
                      "w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                      importUrl === s.url ? "border-[var(--brand)] bg-[var(--brand)]/5" : "border-[var(--border)] hover:bg-[var(--surface-hover)]",
                    )}>
                    <span className="font-medium text-[var(--fg)]">{s.role}</span>
                    <span className="ml-2 text-[var(--muted)]">{[s.company, s.location].filter(Boolean).join(" · ")}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => { setImporting(false); setImportText(""); setImportUrl(""); setImportError(null); }}>
                Avbryt
              </Button>
              {importTab !== "pdf" && (
                <Button variant="primary" onClick={handleImport}>
                  Analysdera
                </Button>
              )}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
