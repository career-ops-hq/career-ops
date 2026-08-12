import { careerOpsRoot, readApplications } from "@/lib/career-ops";
import { ingestEmail, listMessages, updateJobLink } from "@/lib/email-hub-store.mjs";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/email-hub/emails — list classified email (summaries).
 */
export async function GET() {
  try {
    const root = careerOpsRoot();
    const messages = await listMessages(root);
    return NextResponse.json({ ok: true, messages });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}

/**
 * POST /api/email-hub/emails — ingest one email (mock inbox source).
 * Body: { subject, from, fromName, to, date, body, connectorId?, linkJobId? }
 * Classifies + extracts + links to a pipeline job when confident.
 */
export async function POST(req: Request) {
  try {
    const input = (await req.json()) as Record<string, unknown>;
    const root = careerOpsRoot();
    const email = {
      subject: typeof input.subject === "string" ? input.subject : "",
      from: typeof input.from === "string" ? input.from : "",
      fromName: typeof input.fromName === "string" ? input.fromName : "",
      to: typeof input.to === "string" ? input.to : "",
      date: typeof input.date === "string" ? input.date : "",
      body: typeof input.body === "string" ? input.body : "",
    };

    const jobs = readApplications().map((a) => ({ id: a.n, company: a.company, role: a.role }));
    const rec = await ingestEmail(root, email, jobs, {
      connectorId: typeof input.connectorId === "string" ? input.connectorId : "mock",
      linkJobId: typeof input.linkJobId === "string" ? input.linkJobId : undefined,
    });

    return NextResponse.json({ ok: true, message: rec });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err instanceof Error ? err.message : err) }, { status: 400 });
  }
}

/**
 * PATCH /api/email-hub/emails — confirm or change a job link.
 * Body: { id, jobId }
 */
export async function PATCH(req: Request) {
  try {
    const input = (await req.json()) as Record<string, unknown>;
    const root = careerOpsRoot();
    const id = typeof input.id === "string" ? input.id : "";
    const jobId = typeof input.jobId === "string" ? input.jobId : "";
    const jobs = readApplications().map((a) => ({ id: a.n, company: a.company, role: a.role }));
    const updated = await updateJobLink(root, id, jobId, jobs);
    return NextResponse.json({ ok: true, message: updated });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err instanceof Error ? err.message : err) }, { status: 400 });
  }
}
