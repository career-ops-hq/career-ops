import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { markInboxDone } from "@/lib/core/eval-dedupe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  id?: string;
  title?: string;
  subtitle?: string;
  page?: string;
  input?: string;
  kind?: string;
  result?: { score: number | null; summary: string };
  // Gate 3 post-tailoring compliance audit. Sent by the client on every run and
  // only ever present on a pdf-lane run; `unavailable` is the gate's own
  // fail-open answer, so an absent decision and an unavailable one differ.
  gate3?: { decision?: string; reason?: string; reasons?: string[]; source?: string };
  // Per-run token/cost, forwarded from the `done` stream event. Absent whenever
  // the CLI reported no usage, which renders as "—" rather than a fake zero.
  cost?: { tokens?: number; usd?: number };
  steps?: { kind: string; label: string }[];
  output?: string;
  status?: string;
  lastLabel?: string;
};

// Persist a finished worker's log as markdown under a web-managed dir so the CLI
// assistant can read past runs ("what did we find on that Anthropic role?").
export async function POST(req: Request) {
  let b: Body;
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  if (!b.id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const dir = path.join(careerOpsRoot(), ".career-ops-web", "runs");
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    return NextResponse.json({ error: "mkdir failed" }, { status: 500 });
  }
  const safeId = String(b.id).replace(/[^a-z0-9_-]/gi, "");
  const steps = (b.steps ?? []).map((s) => `- ${s.kind === "tool" ? `🔧 ${s.label}` : s.label}`).join("\n");
  const verdict = b.result?.score != null ? `${b.result.score}/5 — ${b.result.summary || ""}` : "—";
  // Gate 3 summary line. Kept verbatim (machine reason + raw reasons) so the log
  // stays greppable — the UI humanizes these tokens, but a log read by the CLI
  // assistant is exactly where the raw value is useful. Collapses to one line.
  const gate3Reasons = (b.gate3?.reasons ?? []).filter(Boolean).join("; ");
  const gate3 = b.gate3?.decision
    ? `${b.gate3.decision}${gate3Reasons ? ` — ${gate3Reasons}` : b.gate3.reason ? ` — ${b.gate3.reason}` : ""}`
    : "—";
  // A failed run is saved too, so name the failure in the header. Without this the
  // log of a killed worker is indistinguishable from one that never started.
  const failed = b.status === "error";
  // Token/cost markers. `—` (the tracker's own "no data" convention) when the
  // CLI reported no usage — never 0, which would read as a free run.
  const tokens = typeof b.cost?.tokens === "number" ? b.cost.tokens.toLocaleString() : "—";
  const usd = typeof b.cost?.usd === "number" ? `$${b.cost.usd.toFixed(2)}` : "—";
  const md = `# Web run · ${b.title || b.id}${failed ? " — FAILED" : ""}

- id: ${b.id}
- page: ${b.page || "-"}
- input: ${b.input || "-"}
- verdict: ${verdict}
- tokens: ${tokens}
- cost: ${usd}
- gate3: ${gate3}${failed ? `\n- outcome: FAILED — ${(b.lastLabel || "no reason recorded").replace(/\s+/g, " ")}` : ""}

## Steps
${steps}

## Output
${b.output || ""}
`;
  try {
    fs.writeFileSync(path.join(dir, `${safeId}.md`), md);
  } catch {
    return NextResponse.json({ error: "write failed" }, { status: 500 });
  }

  // A DONE evaluation means a report landed (the run route only emits `done`
  // for an evaluate that wrote one) — flip the posting's pipeline row to [x] so
  // it stops showing as pending and can't re-fire a worker. Idempotent; a row
  // that doesn't exist (pasted JD with no pipeline entry) is a no-op.
  if (b.status === "done" && b.kind === "evaluate" && b.input) {
    try {
      markInboxDone(careerOpsRoot(), b.input);
    } catch {
      /* non-fatal: the run log is the point of this endpoint */
    }
  }

  return NextResponse.json({ ok: true });
}
