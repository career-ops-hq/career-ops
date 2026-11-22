import { NextResponse } from "next/server";
import { readMemory, rememberFact } from "@/lib/career-ops";
import { readJsonObject } from "@/lib/json-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ memory: readMemory() });
}

// Append a durable fact the assistant learned about the user. Written to the
// CANONICAL modes/_profile.md (single source of truth) so the CLI/TUI see it too
// — never a web-only memory store.
export async function POST(req: Request) {
  const b = await readJsonObject<{ fact?: string }>(req);
  if (!b) return NextResponse.json({ error: "bad json" }, { status: 400 });
  const fact = (b.fact ?? "").toString();
  if (!fact.trim()) return NextResponse.json({ error: "fact required" }, { status: 400 });

  const result = rememberFact(fact);
  // "write failed" was misleading for the case that actually happens: the
  // profile could not be READ, so nothing was written — deliberately, to
  // avoid clobbering it. Name the file, because the user has to go look at it.
  if (result === "error") {
    return NextResponse.json(
      { error: "could not read or write modes/_profile.md — the fact was not saved and the file was left as it is" },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, deduped: result === "deduped" });
}
