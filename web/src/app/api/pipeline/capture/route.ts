import { capturePosting } from "@/lib/core/capture";
import { MAX_CAPTURE_TEXT_BYTES, parseCaptureRequest } from "@/lib/core/capture-request.mjs";
import { readJsonObject } from "@/lib/json-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The JD text ceiling is counted in DECODED bytes (capture-request.mjs). JSON
// escaping can grow a character up to six times on the wire (a control char
// becomes `\u00XX`), so the body cap covers that worst case plus room for the
// URL and labels: text within its limit is never refused for its escaping,
// and text over it gets the "too long" answer, not a generic bad request. A
// body past this cap is still dropped as it streams in, never buffered in full.
const MAX_BODY_BYTES =6 * MAX_CAPTURE_TEXT_BYTES + 64 * 1024;

// Free + no evaluation: record a pasted posting URL (and optional JD text) in
// data/pipeline.md via the core's captureJd(). Never commits, pushes or starts
// an evaluation worker — Evaluate is a separate, deliberate action.
export async function POST(req: Request) {
  const body = await readJsonObject(req, { maxBytes: MAX_BODY_BYTES });
  if (!body) return Response.json({ ok: false, error: "bad request" }, { status: 400 });
  const parsed = parseCaptureRequest(body);
  if ("error" in parsed) return Response.json({ ok: false, error: parsed.error }, { status: 400 });

  const result = await capturePosting(parsed.input);
  if (!result.ok) return Response.json(result, { status: result.invalid ? 400 : 500 });
  return Response.json(result);
}
