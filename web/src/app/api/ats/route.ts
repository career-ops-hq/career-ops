import { NextRequest } from "next/server";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { resumeText, jdText } = body || {};

    if (!resumeText || !jdText) {
      return new Response(JSON.stringify({ error: "resumeText and jdText required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const root = careerOpsRoot();
    const atsModule = await import(path.join(root, "ats-score.mjs"));
    const result = atsModule.calculateAtsScore(resumeText, jdText);

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
