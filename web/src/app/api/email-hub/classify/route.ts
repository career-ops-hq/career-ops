import { careerOpsRoot } from "@/lib/career-ops";
import { classifyEmail, extractEmailEntities, matchEmailToJob } from "@/lib/email-intelligence.mjs";
import { readApplications } from "@/lib/career-ops";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/email-hub/classify
 * Body: { subject, from, fromName, to, date, body }
 * Classifies the email, extracts entities and attempts a job match.
 * Never sends anything.
 */
export async function POST(req: Request) {
  try {
    const input = (await req.json()) as Record<string, unknown>;
    const email = {
      subject: typeof input.subject === "string" ? input.subject : "",
      from: typeof input.from === "string" ? input.from : "",
      fromName: typeof input.fromName === "string" ? input.fromName : "",
      to: typeof input.to === "string" ? input.to : "",
      date: typeof input.date === "string" ? input.date : "",
      body: typeof input.body === "string" ? input.body : "",
    };

    const classification = classifyEmail(email);
    const entities = extractEmailEntities(email);
    const jobs = readApplications().map((a) => ({ id: a.n, company: a.company, role: a.role }));
    const match = matchEmailToJob(email, jobs);

    return NextResponse.json({ ok: true, classification, entities, match });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err instanceof Error ? err.message : err) }, { status: 400 });
  }
}
