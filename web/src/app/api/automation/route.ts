import { automationSnapshot, runAutomation, saveWatch } from "@/lib/automation-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  return Response.json(await automationSnapshot(), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function PUT(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Ogiltig JSON." }, { status: 400 });
  }

  try {
    const state = saveWatch(body);
    return Response.json({ ok: true, state });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Kunde inte spara bevakningen." },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  let action = "run";
  let force = false;
  try {
    const body = (await req.json()) as { action?: string; force?: boolean };
    action = body.action || action;
    force = body.force === true;
  } catch {
    // Empty body runs the watch.
  }
  if (action !== "run") return Response.json({ error: "Okänd åtgärd." }, { status: 400 });

  try {
    const state = await runAutomation(force);
    return Response.json({ ok: true, state });
  } catch (error) {
    console.error("[automation] körning misslyckades", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Bevakningen kunde inte köras." },
      { status: 500 },
    );
  }
}
