import { NextRequest } from "next/server";
import { evaluateSalaryOffer } from "../../../../../salary-advisor.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const salary = evaluateSalaryOffer(body || {});
    return Response.json({ salary });
  } catch (err: any) {
    return Response.json({ error: err.message || "Failed to evaluate salary" }, { status: 500 });
  }
}
