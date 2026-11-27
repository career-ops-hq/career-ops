import { pipelineSummary, withCloseDates } from "@/lib/career-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // always read fresh local files

// Exposes the user's pipeline (inbox + tracker) to the client so the assistant
// can resolve "all the Anthropic ones" to concrete postings CLIENT-SIDE — the
// model only ever emits a company name, never URLs (no hallucination, no tokens).
export async function GET() {
  const s = pipelineSummary();
  const applications = await withCloseDates(s.applications);
  return Response.json({
    inbox: s.inbox,
    applications,
    root: s.root,
    rootExists: s.rootExists,
  });
}
