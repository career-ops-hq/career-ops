import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { findApplication, readReport } from "@/lib/career-ops";
import { legitimacyTone, parseReport, scoreTone } from "@/lib/format";
import { compareIds, summaryFields } from "@/lib/pipeline-compare.mjs";
import { Badge } from "@/components/ui/badge";
import { CompanyLogo } from "@/components/company-logo";
import { PageFrame } from "@/components/page-frame";

export const dynamic = "force-dynamic";

type Column = {
  n: string;
  company: string;
  role: string;
  score: string;
  legitimacy: string | null;
  fields: Map<string, string>;
};

function column(n: string): Column | null {
  const app = findApplication(n);
  const report = readReport(n);
  if (!app && !report) return null;
  const meta = report ? parseReport(report.content) : null;
  const field = (label: string) => meta?.fields.find((f) => f.label === label)?.value ?? "";
  const fields = new Map<string, string>();
  if (app?.status) fields.set("Status", app.status);
  if (app?.date || field("Date")) fields.set("Date", app?.date || field("Date"));
  if (field("Archetype")) fields.set("Archetype", field("Archetype"));
  for (const f of meta ? summaryFields(meta.body) : []) fields.set(f.label, f.value);
  return {
    n,
    company: app?.company ?? meta?.title ?? `#${n}`,
    role: app?.role ?? "",
    score: app?.score || field("Score"),
    legitimacy: meta?.legitimacy ?? null,
    fields,
  };
}

export default async function ComparePage({ searchParams }: { searchParams: Promise<{ n?: string | string[] }> }) {
  const { n } = await searchParams;
  const columns = compareIds(n).map(column).filter((c): c is Column => c !== null);
  const labels = [...new Set(columns.flatMap((c) => [...c.fields.keys()]))];

  return (
    <PageFrame>
      <Link href="/pipeline?tab=all" className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-brand-text">
        <ArrowLeft className="size-4" /> Pipeline
      </Link>
      <h1 className="mt-5 font-display text-2xl tracking-tight text-landing">Compare</h1>
      {columns.length < 2 ? (
        <p className="mt-4 text-sm text-muted">Select two or three applications in the Pipeline to compare them.</p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-2xl border border-border">
          <table className="w-full min-w-[40rem] table-fixed text-sm">
            <thead className="bg-surface/60 text-left align-top">
              <tr>
                <th className="w-32 px-4 py-3" />
                {columns.map((c) => (
                  <th key={c.n} scope="col" className="px-4 py-3 font-normal">
                    <Link href={`/pipeline/${c.n}`} className="flex items-center gap-2 hover:text-brand-text">
                      <CompanyLogo name={c.company} size={24} />
                      <span className="font-medium">{c.company}</span>
                    </Link>
                    <p className="mt-1 text-xs text-muted">{c.role}</p>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border align-top">
              <tr>
                <th scope="row" className="px-4 py-2.5 text-left text-xs font-medium text-faint">Score</th>
                {columns.map((c) => (
                  <td key={c.n} className="px-4 py-2.5">
                    {c.score && <Badge tone={scoreTone(c.score)}>{c.score}</Badge>}
                  </td>
                ))}
              </tr>
              <tr>
                <th scope="row" className="px-4 py-2.5 text-left text-xs font-medium text-faint">Legitimacy</th>
                {columns.map((c) => (
                  <td key={c.n} className="px-4 py-2.5">
                    {c.legitimacy && <Badge tone={legitimacyTone(c.legitimacy)}>{c.legitimacy}</Badge>}
                  </td>
                ))}
              </tr>
              {labels.map((label) => (
                <tr key={label}>
                  <th scope="row" className="px-4 py-2.5 text-left text-xs font-medium text-faint">{label}</th>
                  {columns.map((c) => (
                    <td key={c.n} className="px-4 py-2.5">{c.fields.get(label) ?? ""}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageFrame>
  );
}
