import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  id?: string;
  title?: string;
  subtitle?: string;
  page?: string;
  input?: string;
  result?: { score: number | null; summary: string };
  steps?: { kind: string; label: string }[];
  output?: string;
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
  const md = `# Web run · ${b.title || b.id}

- id: ${b.id}
- page: ${b.page || "-"}
- input: ${b.input || "-"}
- verdict: ${verdict}

## Steps
${steps}

## Output
${b.output || ""}
`;
  try {
    fs.writeFileSync(path.join(dir, `${safeId}.md`), md);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "write failed" }, { status: 500 });
  }
}
