import { NextRequest } from "next/server";
import { generateInterviewPrep } from "../../../../../interview-prep.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { payload, jdText } = body || {};
    const prep = generateInterviewPrep(payload, jdText);
    return Response.json({ prep });
  } catch (err: any) {
    return Response.json({ error: err.message || "Failed to generate interview prep" }, { status: 500 });
  }
}
