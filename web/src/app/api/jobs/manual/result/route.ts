import { NextResponse } from "next/server";
import { readApplications, readReport } from "@/lib/career-ops";
import { canonicalJobUrl, normalizeManualJobInput } from "@/lib/manual-jobs.mjs";

export const runtime = "nodejs";
const norm = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  try {
    const job = normalizeManualJobInput(body);
    const applications = [...readApplications()].reverse();
    const match = applications.find((app) => {
      const report = readReport(app.n)?.content || "";
      if (job.url) {
        const reportUrl = report.match(/^\*\*URL:\*\*\s*(https?:\/\/\S+)/im)?.[1] || "";
        return canonicalJobUrl(reportUrl) === canonicalJobUrl(job.url);
      }
      return norm(app.company) === norm(job.company) && norm(app.role) === norm(job.title);
    });
    if (!match) return NextResponse.json({ error: "The canonical evaluation record is not available yet." }, { status: 404 });
    const report = readReport(match.n);
    return NextResponse.json({ application: match, report: report?.content || null, reportUrl: `/pipeline/${match.n}` });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid manual job input." }, { status: 400 });
  }
}
