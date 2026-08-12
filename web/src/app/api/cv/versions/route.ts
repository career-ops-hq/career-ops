import { careerOpsRoot } from "@/lib/career-ops";
import { listCvVersions, restoreCvVersion } from "@/lib/cv-version-store.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const versions = await listCvVersions(careerOpsRoot());
    return Response.json({ versions });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "versions read failed" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  let body: { id?: string };
  try {
    body = (await req.json()) as { id?: string };
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  if (!body.id) return Response.json({ error: "version id required" }, { status: 400 });

  try {
    const version = await restoreCvVersion(careerOpsRoot(), body.id);
    return Response.json({ ok: true, version });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "restore failed" },
      { status: 400 },
    );
  }
}
