import { NextRequest } from "next/server";
import { generateOutreachCadence } from "../../../../../outreach-generator.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const outreach = generateOutreachCadence(body || {});
    return Response.json({ outreach });
  } catch (err: any) {
    return Response.json({ error: err.message || "Failed to generate outreach" }, { status: 500 });
  }
}
