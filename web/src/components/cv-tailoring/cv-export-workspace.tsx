"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import {
  analyzeCvForAts,
  scoreCv,
  improveSafePoints,
} from "@/lib/ats-analyzer";
import {
  renderHtml,
  structuredCv,
  CV_TEMPLATES,
  EXPORT_FORMATS,
} from "@/lib/cv-export";
import type { AtsReport, ScorecardResult, SafeFixResult } from "@/lib/ats-analyzer";

/* ── Types ──────────────────────────────────────────────────────────── */

export interface CvExportWorkspaceProps {
  cvText: string;
  jobId?: string;
  versionId?: string;
  jobTitle?: string;
  company?: string;
}

type TabKey = "ats" | "score" | "preview" | "export";

type BadgeTone = "good" | "bad" | "info" | "warn" | "muted";

const TABS: Array<{ key: TabKey; label: string; description: string }> = [
  { key: "ats", label: "ATS", description: "Kompatibilitetsanalys" },
  { key: "score", label: "SCORE", description: "CV Scorecard" },
  { key: "preview", label: "PREVIEW", description: "Mall och förhandsvisning" },
  { key: "export", label: "EXPORT", description: "PDF / DOCX / TXT / MD" },
];

const SEVERITY_TONE: Record<string, BadgeTone> = {
  PASS: "good",
  WARNING: "warn",
  CRITICAL: "bad",
};

const FORMAT_LABEL: Record<string, string> = {
  pdf: "PDF",
  docx: "DOCX",
  txt: "TXT",
  md: "Markdown",
};

/* ── Workspace ──────────────────────────────────────────────────────── */

export function CvExportWorkspace({
  cvText: initialCvText,
  jobId,
  versionId,
  jobTitle,
  company,
}: CvExportWorkspaceProps) {
  const [tab, setTab] = useState<TabKey>("ats");
  const [cvText, setCvText] = useState(initialCvText);
  const [jobText, setJobText] = useState("");
  const [ats, setAts] = useState<AtsReport | null>(null);
  const [score, setScore] = useState<ScorecardResult | null>(null);
  const [fix, setFix] = useState<SafeFixResult | null>(null);
  const [fixApplied, setFixApplied] = useState(false);
  const [templateId, setTemplateId] = useState<string>("ats-standard");
  const [format, setFormat] = useState<string>("pdf");
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<{
    ok: boolean;
    fileName: string;
    base64?: string;
    mime?: string;
    size?: number;
    qualityGate?: { passed: boolean; checks: Array<{ id: string; label: string; ok: boolean; message: string }> };
    error?: string;
  } | null>(null);

  // Hämta jobbannonsens nyckelord (från analysen) för keyword-täckning.
  useEffect(() => {
    let cancelled = false;
    if (jobId) {
      fetch(`/api/jobs/intelligence/${jobId}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (cancelled || !d) return;
          const keywords = Array.isArray(d?.analysis?.keywords) ? d.analysis.keywords : [];
          setJobText(keywords.filter((k: unknown) => typeof k === "string").join(" "));
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  // ATS-analys + scorecard (deterministisk, körs lokalt i webbläsaren).
  useEffect(() => {
    const options = jobText.trim() ? { jobText } : {};
    const report = analyzeCvForAts(cvText, options);
    const card = scoreCv({ cvText, options });
    setAts(report);
    setScore(card);
  }, [cvText, jobText]);

  const improved = useMemo(() => fix?.correctedText ?? null, [fix]);

  const runSafeFix = useCallback(() => {
    const result = improveSafePoints(cvText);
    setFix(result);
    setFixApplied(false);
  }, [cvText]);

  const applySafeFix = useCallback(() => {
    if (!improved) return;
    setCvText(improved);
    setFixApplied(true);
  }, [improved]);

  const doExport = useCallback(async () => {
    setExporting(true);
    setExportResult(null);
    try {
      const res = await fetch("/api/cv/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cvText,
          versionId: versionId ?? undefined,
          jobId: jobId ?? undefined,
          jobTitle: jobTitle ?? undefined,
          company: company ?? undefined,
          templateId,
          format,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setExportResult({ ok: false, fileName: "", error: data?.error || "Exporten misslyckades." });
        return;
      }
      setExportResult({
        ok: data?.ok ?? false,
        fileName: data?.export?.fileName || "",
        base64: data?.export?.base64,
        mime: data?.export?.mime,
        size: data?.export?.size,
        qualityGate: data?.export?.qualityGate,
      });
    } catch (err) {
      setExportResult({ ok: false, fileName: "", error: err instanceof Error ? err.message : "Okänt fel." });
    } finally {
      setExporting(false);
    }
  }, [cvText, versionId, jobId, jobTitle, company, templateId, format]);

  const download = useCallback(() => {
    if (!exportResult?.base64 || !exportResult.mime) return;
    const bytes = atob(exportResult.base64);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    const blob = new Blob([arr], { type: exportResult.mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = exportResult.fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [exportResult]);

  const previewHtml = useMemo(
    () => renderHtml(structuredCv(cvText), templateId),
    [cvText, templateId],
  );

  return (
    <div className="space-y-4">
      {/* Flikar */}
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Button
            key={t.key}
            variant={tab === t.key ? "primary" : "outline"}
            size="sm"
            onClick={() => setTab(t.key)}
            title={t.description}
          >
            {t.label}
          </Button>
        ))}
      </div>

      {tab === "ats" && ats && (
        <AtsTab ats={ats} />
      )}

      {tab === "score" && score && (
        <ScoreTab
          score={score}
          fix={fix}
          improved={improved}
          fixApplied={fixApplied}
          onRunFix={runSafeFix}
          onApplyFix={applySafeFix}
        />
      )}

      {tab === "preview" && (
        <PreviewTab
          templateId={templateId}
          setTemplateId={setTemplateId}
          previewHtml={previewHtml}
        />
      )}

      {tab === "export" && (
        <ExportTab
          format={format}
          setFormat={setFormat}
          exporting={exporting}
          exportResult={exportResult}
          onExport={doExport}
          onDownload={download}
          templateId={templateId}
          jobTitle={jobTitle}
          company={company}
        />
      )}
    </div>
  );
}

/* ── ATS-tab ────────────────────────────────────────────────────────── */

function AtsTab({ ats }: { ats: AtsReport }) {
  const { summary } = ats;
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="good">PASS {summary.pass}</Badge>
          <Badge tone="warn">WARNING {summary.warning}</Badge>
          <Badge tone="bad">CRITICAL {summary.critical}</Badge>
          <span className="text-xs text-[var(--muted)]">
            {ats.wordCount} ord · {ats.detectedLanguage} · {ats.sections.length} sektioner
          </span>
        </div>
        {ats.keywords?.coverage !== undefined && (
          <p className="mt-2 text-sm text-[var(--muted)]">
            Nyckelordstäckning mot jobbannonsen:{" "}
            <strong className="text-[var(--fg)]">{Math.round(ats.keywords.coverage * 100)} %</strong>
            {ats.keywords.matched.length > 0 && (
              <> — matchade: {ats.keywords.matched.slice(0, 12).join(", ")}</>
            )}
            {ats.keywords.missing.length > 0 && (
              <span className="block mt-1">
                Saknade: <span className="text-[var(--warn)]">{ats.keywords.missing.slice(0, 12).join(", ")}</span>
              </span>
            )}
          </p>
        )}
        <p className="mt-3 text-xs text-[var(--muted)]">
          Viktigt: CareerPilot AI kan inte garantera ett ATS-resultat. Analysen visar
          kompatibilitetsrisker och rekommendationer baserat på dokumentstruktur och relevans.
        </p>
      </Card>

      <Card className="p-4">
        <h3 className="mb-3 font-semibold">Kontroller</h3>
        <div className="space-y-2">
          {ats.checks.map((c) => (
            <div
              key={c.id}
              className={cn(
                "rounded-lg border p-3",
                c.severity === "PASS" && "border-[var(--border)]",
                c.severity === "WARNING" && "border-[color:var(--warn)]/40 bg-[color:var(--warn)]/5",
                c.severity === "CRITICAL" && "border-[color:var(--danger)]/40 bg-[color:var(--danger)]/5",
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={SEVERITY_TONE[c.severity] || "muted"}>{c.severity}</Badge>
                <span className="font-medium text-sm">{c.label}</span>
              </div>
              <p className="mt-1 text-sm text-[var(--muted)]">{c.message}</p>
              {c.fix && (
                <p className="mt-1 text-xs text-[var(--fg)]">
                  <span className="font-medium">Rekommenderad åtgärd: </span>
                  {c.fix}
                </p>
              )}
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="mb-1 font-semibold">ATS-miljöer</h3>
        <p className="mb-3 text-xs text-[var(--muted)]">
          Kompatibilitetsrisker per vanligt rekryteringssystem — baserat på dokumentstruktur, inte garantier.
        </p>
        <div className="grid gap-2 md:grid-cols-2">
          {ats.environments.map((env) => (
            <div key={env.id} className="rounded-lg border border-[var(--border)] p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-sm">{env.name}</span>
                <Badge
                  tone={env.riskLevel === "hög" ? "bad" : env.riskLevel === "medel" ? "warn" : "good"}
                >
                  {env.riskLevel === "låg" ? "Låg risk" : env.riskLevel === "medel" ? "Medel risk" : "Hög risk"}
                </Badge>
              </div>
              {env.knownRisks?.length > 0 && (
                <ul className="mt-2 list-disc pl-4 text-xs text-[var(--muted)]">
                  {env.knownRisks.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              )}
              {env.guidance?.length > 0 && (
                <p className="mt-2 text-xs text-[var(--fg)]">
                  <span className="font-medium">Rekommendation: </span>
                  {env.guidance[0]}
                </p>
              )}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ── SCORE-tab ──────────────────────────────────────────────────────── */

const BAND_TONE: Record<string, BadgeTone> = {
  Excellent: "good",
  Strong: "good",
  Good: "info",
  "Needs Improvement": "warn",
  Critical: "bad",
};

function ScoreTab({
  score,
  fix,
  improved,
  fixApplied,
  onRunFix,
  onApplyFix,
}: {
  score: ScorecardResult;
  fix: SafeFixResult | null;
  improved: string | null;
  fixApplied: boolean;
  onRunFix: () => void;
  onApplyFix: () => void;
}) {
  const categories = Object.entries(score.categories || {});
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-semibold">Total beredskap</span>
          <Badge tone={BAND_TONE[score.overallReadiness?.band] || "muted"}>
            {score.overallReadiness?.band || "–"}
          </Badge>
          {score.overallReadiness?.label && (
            <span className="text-sm text-[var(--muted)]">{score.overallReadiness.label}</span>
          )}
        </div>
        {score.overallReadiness?.explanation && (
          <p className="mt-2 text-sm text-[var(--muted)]">{score.overallReadiness.explanation}</p>
        )}
      </Card>

      <div className="grid gap-2 md:grid-cols-2">
        {categories.map(([key, band]) => (
          <div key={key} className="rounded-lg border border-[var(--border)] p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-sm">{band.label || key}</span>
              <div className="flex items-center gap-2">
                {typeof band.score === "number" && (
                  <span className="text-xs text-[var(--muted)]">{band.score}/100</span>
                )}
                <Badge tone={BAND_TONE[band.band] || "muted"}>{band.band}</Badge>
              </div>
            </div>
            {band.explanation && (
              <p className="mt-1 text-xs text-[var(--muted)]">{band.explanation}</p>
            )}
            {band.problems?.length > 0 && (
              <ul className="mt-2 list-disc pl-4 text-xs text-[var(--danger)]">
                {band.problems.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            )}
            {band.fix && (
              <p className="mt-2 text-xs text-[var(--fg)]">
                <span className="font-medium">Rekommendation: </span>
                {band.fix}
              </p>
            )}
          </div>
        ))}
      </div>

      <Card className="p-4">
        <h3 className="mb-2 font-semibold">Förbättra säkra punkter</h3>
        <p className="mb-3 text-xs text-[var(--muted)]">
          Korrigerar automatiskt språk, stavning, tydlighet, struktur och säkra ATS-formatproblem.
          Arbetsgivare, datum, roller, certifieringar, utbildningar, färdigheter, ansvar, resultat
          och siffror ändras aldrig automatiskt — du godkänner ändringen innan den tillämpas.
        </p>
        <Button variant="outline" size="sm" onClick={onRunFix}>
          Förbättra alla säkra punkter
        </Button>

        {fix && (
          <div className="mt-3 space-y-2">
            {fix.changes.length === 0 ? (
              <p className="text-sm text-[var(--good)]">Inga säkra punkter att förbättra — CV:t är redan rent.</p>
            ) : (
              <ul className="list-disc pl-4 text-sm">
                {fix.changes.map((c) => (
                  <li key={c.id}>
                    <Badge tone={c.safe ? "good" : "warn"}>{c.safe ? "Säker" : "Kräver granskning"}</Badge>{" "}
                    {c.description}
                  </li>
                ))}
              </ul>
            )}
            {fix.digitsPreserved === false && (
              <p className="text-xs text-[var(--danger)]">
                Varning: siffror kan ha ändrats — granska manuellt.
              </p>
            )}
            {improved && !fixApplied && (
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={onApplyFix}>
                  Tillämpa säkra förbättringar
                </Button>
                <span className="text-xs text-[var(--muted)]">
                  Uppdaterar förhandsvisning och export med den förbättrade texten.
                </span>
              </div>
            )}
            {fixApplied && (
              <p className="text-sm text-[var(--good)]">
                ✅ Säkra förbättringar tillämpade — inga faktauppgifter har ändrats.
              </p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ── PREVIEW-tab ────────────────────────────────────────────────────── */

function PreviewTab({
  templateId,
  setTemplateId,
  previewHtml,
}: {
  templateId: string;
  setTemplateId: (id: string) => void;
  previewHtml: string;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-2 md:grid-cols-3">
        {CV_TEMPLATES.map((t) => (
          <button
            key={t.id}
            onClick={() => setTemplateId(t.id)}
            className={cn(
              "rounded-lg border p-3 text-left transition-colors",
              templateId === t.id
                ? "border-[var(--brand)] bg-[var(--brand)]/5"
                : "border-[var(--border)] hover:bg-[var(--surface-hover)]",
            )}
          >
            <div className="font-medium text-sm">{t.name}</div>
            <div className="mt-1 text-xs text-[var(--muted)]">{t.description}</div>
            <div className="mt-2 flex flex-wrap gap-1">
              {t.tags?.map((tag) => (
                <span key={tag} className="rounded bg-[var(--surface-hover)] px-1.5 py-0.5 text-[10px] text-[var(--muted)]">
                  {tag}
                </span>
              ))}
            </div>
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-[var(--border)]">
        <iframe
          title="CV-förhandsvisning"
          sandbox=""
          srcDoc={previewHtml}
          className="h-[640px] w-full bg-white"
        />
      </div>
    </div>
  );
}

/* ── EXPORT-tab ─────────────────────────────────────────────────────── */

function ExportTab({
  format,
  setFormat,
  exporting,
  exportResult,
  onExport,
  onDownload,
  templateId,
  jobTitle,
  company,
}: {
  format: string;
  setFormat: (f: string) => void;
  exporting: boolean;
  exportResult: {
    ok: boolean;
    fileName: string;
    base64?: string;
    mime?: string;
    size?: number;
    qualityGate?: { passed: boolean; checks: Array<{ id: string; label: string; ok: boolean; message: string }> };
    error?: string;
  } | null;
  onExport: () => void;
  onDownload: () => void;
  templateId: string;
  jobTitle?: string;
  company?: string;
}) {
  const template = CV_TEMPLATES.find((t) => t.id === templateId);
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h3 className="mb-2 font-semibold">Exportera CV</h3>
        <div className="flex flex-wrap gap-2">
          {EXPORT_FORMATS.map((f) => (
            <Button
              key={f}
              variant={format === f ? "primary" : "outline"}
              size="sm"
              onClick={() => setFormat(f)}
            >
              {FORMAT_LABEL[f] || f}
            </Button>
          ))}
        </div>
        <p className="mt-3 text-xs text-[var(--muted)]">
          Mall: <strong className="text-[var(--fg)]">{template?.name}</strong>
          {jobTitle ? <> · Roll: <strong className="text-[var(--fg)]">{jobTitle}</strong></> : null}
          {company ? <> · Företag: <strong className="text-[var(--fg)]">{company}</strong></> : null}
          {" · "}Filnamn: <code className="text-[var(--fg)]">Förnamn_Efternamn_Roll_Företag_CV.{format}</code>
        </p>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Exporten sparas som ny CV-version-metadata — original-CV:t skrivs aldrig över.
        </p>
        <div className="mt-3">
          <Button onClick={onExport} disabled={exporting}>
            {exporting ? "Exporterar och kontrollerar…" : "Exportera och kvalitetskontrollera"}
          </Button>
        </div>
      </Card>

      {exportResult && (
        <Card className="p-4">
          {exportResult.ok ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="good">✅ KLAR</Badge>
                <span className="font-medium text-sm">{exportResult.fileName}</span>
                {typeof exportResult.size === "number" && (
                  <span className="text-xs text-[var(--muted)]">
                    {Math.round(exportResult.size / 1024)} KB
                  </span>
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" onClick={onDownload}>
                  Ladda ner {FORMAT_LABEL[format] || format}
                </Button>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <Badge tone="bad">MISSLYCKADES</Badge>
              <span className="text-sm text-[var(--danger)]">{exportResult.error || "Exporten kunde inte verifieras."}</span>
            </div>
          )}

          {exportResult.qualityGate && (
            <div className="mt-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="font-medium text-sm">Export Quality Gate</span>
                <Badge tone={exportResult.qualityGate.passed ? "good" : "bad"}>
                  {exportResult.qualityGate.passed ? "PASSERAD" : "MISSLYCKADES"}
                </Badge>
              </div>
              <div className="space-y-1">
                {exportResult.qualityGate.checks.map((c) => (
                  <div key={c.id} className="flex items-start gap-2 text-xs">
                    <span className={c.ok ? "text-[var(--good)]" : "text-[var(--danger)]"}>
                      {c.ok ? "✓" : "✗"}
                    </span>
                    <span className="text-[var(--fg)]">{c.label}</span>
                    <span className="text-[var(--muted)]">— {c.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
