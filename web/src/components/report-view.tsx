import Link from "next/link";
import { ArrowLeft, FileText, ExternalLink, ChevronDown } from "lucide-react";
import type { Application } from "@/lib/career-ops";
import { Badge } from "@/components/ui/badge";
import { scoreTone, legitimacyTone, parseReport } from "@/lib/format";
import {
  APPLY_LINE,
  applyCtaQuiet,
  applyLineLabel,
  cleanHeading,
  isLeadSection,
  isVerdictHeading,
  splitSections,
  verdictReason,
} from "@/lib/report-sections.mjs";
import { isStarTableHeader, parsePipeTable } from "@/lib/report-tables.mjs";
import { StatusSelect } from "@/components/status-select";
import { CompanyLogo } from "@/components/company-logo";
import { ScoreMethodology } from "@/components/score-methodology";
import { GeneratePdfButton } from "@/components/generate-pdf-button";
import { ApplyButton } from "@/components/apply-button";
import { DeleteFromTracker } from "@/components/delete-from-tracker";
import { ReportMarkdown } from "@/components/report-markdown";
import { companyPresentation } from "@/lib/company-presentation.mjs";

// Progressive disclosure of the report. Current oferta.md writes letter F as
// Interview Plan (STAR+R), not a verdict — never promote by letter (#3416).
// The score + 4.0 apply line + legitimacy live in one Peak-End callout (#4203).
// Block B (CV Match) stays open; everything else, including Role Summary and
// STAR+R, is collapsed (#4205). Machine artifacts stay in the Technical tier.

function isMachine(heading: string): boolean {
  return /machine summary|submitted|submit[-\s]?log/i.test(heading);
}

function httpUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  return /^https?:\/\//i.test(url) ? url : undefined;
}

function preview(md: string): string {
  const table = parsePipeTable(md);
  if (table && isStarTableHeader(table.header)) {
    const n = table.rows.length;
    return `${n} interview stor${n === 1 ? "y" : "ies"}`;
  }
  const text = md
    .replace(/^#+\s.*$/gm, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[*_`>#|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const sentence = text.split(/(?<=[.!?])\s/)[0] ?? text;
  return sentence.length > 96 ? sentence.slice(0, 96).trimEnd() + "…" : sentence;
}

export function ReportView({
  id,
  app,
  report,
  canDelete = false,
  pdfReadyFromIndex = false,
  coverReady = false,
}: {
  id: string;
  app: Application | null;
  report: string | null;
  /** kept in the props contract (the page passes it) but no longer surfaced —
   *  the raw .md filename is a dev artifact, not header content. */
  file?: string | null;
  canDelete?: boolean;
  pdfReadyFromIndex?: boolean;
  /** A tailored cover letter for THIS application exists in output/ (resolved by
   *  the page, see resolveTailoredCover). View only — covers are never generated
   *  from here. */
  coverReady?: boolean;
}) {
  const meta = report ? parseReport(report) : null;
  const field = (label: string) => meta?.fields.find((f) => f.label === label)?.value;
  const score = app?.score || field("Score");
  const date = app?.date || field("Date");
  const archetype = field("Archetype");
  const url = field("URL");
  const decision = field("Decision");
  const line = applyLineLabel(score ?? "");
  const recommended = line === "Recommended";
  const quietApply = applyCtaQuiet({ score, legitimacy: meta?.legitimacy });
  const applyUrl = httpUrl(url);
  const pdfReady = (app?.pdf ?? "").includes("✅") || pdfReadyFromIndex;
  const company = app ? companyPresentation(app) : null;
  const companyName = company?.label ?? app?.company ?? meta?.title ?? id;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8 xl:max-w-5xl 2xl:max-w-[1600px]">
      <Link
        href="/pipeline"
        className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-brand"
      >
        <ArrowLeft className="size-4" /> Pipeline
      </Link>

      <header className="mt-5">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-faint">#{id}</p>
        <div className="mt-2 flex items-center gap-3">
          <CompanyLogo name={company?.logoName ?? meta?.title ?? `Report #${id}`} size={40} />
          <h1 className="font-display text-3xl tracking-tight text-landing">
            {company?.label ?? meta?.title ?? `Report #${id}`}
          </h1>
        </div>
        {app?.role && <p className="mt-1 text-muted">{app.role}</p>}

        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          {app && <StatusSelect n={id} current={app.status} />}
          <GeneratePdfButton n={id} company={app?.company ?? meta?.title ?? id} pdfReady={pdfReady} />
          {coverReady && (
            <a
              href={`/api/cover-pdf?application=${encodeURIComponent(id)}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-500/15 dark:text-emerald-400 max-sm:min-h-[44px]"
            >
              <FileText className="size-3.5" /> View cover
            </a>
          )}
        </div>

        {app && canDelete && (
          <div className="mt-3">
            <DeleteFromTracker n={id} />
          </div>
        )}

        {(archetype || date || applyUrl) && (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            {archetype && <span className="max-w-full truncate">{archetype}</span>}
            {date && <span className="tabular-nums text-faint">{date}</span>}
            {applyUrl && (
              <a
                href={applyUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center gap-1 text-brand hover:underline max-sm:min-h-[44px]"
              >
                posting <ExternalLink className="size-3" />
              </a>
            )}
          </div>
        )}
      </header>

      {report ? (
        <>
          {(() => {
            const { intro, sections } = splitSections(meta?.body ?? report);
            const verdictSection = sections.find((s) => isVerdictHeading(s.heading));
            const rest = sections.filter((s) => s !== verdictSection);
            const machine = rest.filter((s) => isMachine(s.heading));
            const mainSections = rest.filter((s) => !isMachine(s.heading));
            const reason = verdictReason({
              report,
              intro,
              verdictContent: verdictSection?.content,
            });
            const verdictClass = recommended
              ? "border-brand/25 bg-brand-soft/50"
              : "border-border bg-surface/50";
            const callout = (
              <div className={`rounded-2xl border px-5 py-5 ${verdictClass}`}>
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-faint">Verdict</p>
                <div className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-1">
                  {score ? (
                    <p className="font-display text-4xl tabular-nums tracking-tight text-landing">{score}</p>
                  ) : (
                    <p className="text-sm text-muted">No score on this report.</p>
                  )}
                  <p className="pb-1 text-xs text-muted">Apply line is {APPLY_LINE.toFixed(1)}</p>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {score && <Badge tone={scoreTone(score)}>{score}</Badge>}
                  {line && <Badge tone={recommended ? "good" : "muted"}>{line}</Badge>}
                  {decision && <Badge tone="info">{decision}</Badge>}
                  {meta?.legitimacy && <Badge tone={legitimacyTone(meta.legitimacy)}>{meta.legitimacy}</Badge>}
                </div>
                {reason && <p className="mt-4 text-[15px] font-medium leading-relaxed text-foreground">{reason}</p>}
                <div className="mt-4">
                  <ApplyButton
                    n={id}
                    url={applyUrl}
                    company={companyName}
                    pdfReady={pdfReady}
                    quiet={quietApply}
                  />
                </div>
              </div>
            );
            if (sections.length === 0) {
              return (
                <div className="mt-8">
                  {callout}
                  <article className="report-prose mt-6">
                    <ReportMarkdown>{meta?.body ?? report}</ReportMarkdown>
                  </article>
                </div>
              );
            }
            return (
              <div className="mt-8">
                {callout}

                {mainSections.map((s, i) => {
                  const expanded = isLeadSection(s);
                  if (expanded) {
                    return (
                      <article key={i} className="report-prose mt-6">
                        <h2>{cleanHeading(s.heading)}</h2>
                        <ReportMarkdown>{s.content}</ReportMarkdown>
                      </article>
                    );
                  }
                  return (
                    <details key={i} className="group mt-3 overflow-hidden rounded-xl border border-border bg-surface/30">
                      <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 px-4 py-3 transition-colors hover:bg-surface-hover">
                        <span className="text-sm font-medium">{cleanHeading(s.heading)}</span>
                        <span className="hidden truncate text-xs text-faint sm:inline">{preview(s.content)}</span>
                        <ChevronDown className="ml-auto size-4 shrink-0 text-faint transition-transform group-open:rotate-180" />
                      </summary>
                      <div className="report-prose border-t border-border px-4 py-3">
                        <ReportMarkdown>{s.content}</ReportMarkdown>
                      </div>
                    </details>
                  );
                })}

                {machine.length > 0 && (
                  <>
                    <div className="mt-6 flex items-center gap-3 text-[11px] uppercase tracking-[0.14em] text-faint">
                      <span className="h-px flex-1 bg-border" />
                      Technical details · for developers
                      <span className="h-px flex-1 bg-border" />
                    </div>
                    {machine.map((s, i) => (
                      <details key={i} className="group mt-2 overflow-hidden rounded-xl border border-border/60 bg-surface/20">
                        <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 px-4 py-3 font-mono text-xs text-muted transition-colors hover:bg-surface-hover">
                          {cleanHeading(s.heading)}
                          <ChevronDown className="ml-auto size-4 shrink-0 text-faint transition-transform group-open:rotate-180" />
                        </summary>
                        <div className="report-prose border-t border-border/60 px-4 py-3">
                          <ReportMarkdown>{s.content}</ReportMarkdown>
                        </div>
                      </details>
                    ))}
                  </>
                )}
              </div>
            );
          })()}
          <ScoreMethodology />
        </>
      ) : (
        <div className="mt-8 flex items-center gap-3 rounded-2xl border border-dashed border-border bg-surface/30 p-5 text-sm text-muted">
          <FileText className="size-5 shrink-0 text-faint" />
          No report file found for #{id} in <code className="text-foreground">reports/</code>.
        </div>
      )}
    </div>
  );
}
