import { NextResponse } from "next/server";
import { careerOpsRoot } from "@/lib/career-ops";
import { detectClis } from "@/lib/clis";
import { readRememberedCli } from "@/lib/remembered-cli.mjs";

export const dynamic = "force-dynamic";

// Detects which agnostic CLIs are installed on THIS machine (local-first). The
// web delegates career-ops to one of these in headless mode, on the user's own
// auth/tokens — no API key needed.
export async function GET() {
  return NextResponse.json({ clis: detectClis(), remembered: readRememberedCli(careerOpsRoot()) });
}
