import { NextResponse } from "next/server";
import { readJsonObject } from "@/lib/json-body";
import { keywordsInText, loadStudio, unsupportedRewriteClaims } from "@/lib/cv-studio/server";
import { runRewrite } from "@/lib/cv-studio/rewrite-run";
import { buildRewritePrompt, MAX_INSTRUCTION, parseRewrite } from "@/lib/cv-studio/rewrite.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 150;

type RouteContext = { params: Promise<{ n: string }> };

const MESSAGES = {
  "no-cli": "No AI CLI is set up. Choose one in Config, or edit the wording by hand.",
  unfenced: "This AI CLI cannot be limited to read-only access, so the rewrite did not run. Choose Claude, Codex or Grok in Config, or edit the wording by hand.",
  refused: "The AI CLI could not be started with read-only access, so nothing ran.",
  failed: "The AI CLI did not finish. Check that it is signed in, then try again.",
  "no-answer": "The AI CLI replied without a usable bullet. Try a different instruction.",
  unsupported: "The rewrite was discarded because it adds claims this bullet does not support:",
} as const;

export async function POST(req: Request, { params }: RouteContext) {
  const n = (await params).n;
  const body = await readJsonObject<{ bulletId?: unknown; instruction?: unknown; cliId?: unknown }>(req);
  if (!body || typeof body.bulletId !== "string" || typeof body.instruction !== "string" || typeof body.cliId !== "string") {
    return NextResponse.json({ error: "bulletId, instruction and cliId required" }, { status: 400 });
  }
  const instruction = body.instruction.trim().slice(0, MAX_INSTRUCTION);
  if (!instruction) return NextResponse.json({ error: "Say how the bullet should change." }, { status: 400 });

  const load = await loadStudio(n);
  if (!load.ok) return NextResponse.json({ error: load.reason }, { status: 404 });
  const bullet = load.doc.sections.flatMap((s) => s.items.flatMap((i) => i.bullets)).find((b) => b.id === body.bulletId);
  if (!bullet) return NextResponse.json({ error: "unknown bullet" }, { status: 404 });

  const run = await runRewrite(body.cliId, buildRewritePrompt({ instruction, base: bullet.base, tailored: bullet.tailored, keywords: load.doc.keywords }));
  if (!run.ok) {
    if (run.detail) console.error(`cv-studio rewrite ${run.reason}: ${run.detail}`);
    return NextResponse.json({ error: MESSAGES[run.reason] }, { status: 502 });
  }
  const text = parseRewrite(run.reply);
  if (!text) return NextResponse.json({ error: MESSAGES["no-answer"] }, { status: 422 });
  const claims = await unsupportedRewriteClaims(text, [bullet.base, bullet.tailored].filter((t) => t !== null).join("\n"));
  if (claims.length) return NextResponse.json({ error: `${MESSAGES.unsupported} ${claims.join(", ")}.`, claims }, { status: 422 });
  return NextResponse.json({ text, keywords: (await keywordsInText(n, text)) ?? [], warning: run.warning });
}
