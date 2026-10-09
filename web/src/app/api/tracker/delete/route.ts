import { spawn } from "node:child_process";
import { careerOpsRoot, rootScript, trackerCanDelete } from "@/lib/career-ops";
import { isTrackerWriting } from "@/lib/core/run-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Remove ONE application row from applications.md by orchestrating the core
// write-gate `tracker.mjs delete --num N` (#1200) — we NEVER hand-edit the file
// (atomic write + SQLite reindex + orphan-report report all live in the script).
// This is the disc#9 fix: a bogus row (e.g. an evaluation that errored mid-run)
// must be removable. `--dry-run` previews; the real delete is irreversible, so the
// UI confirms first.

// One delete at a time (single local process). Real deletes only — dry-runs write
// nothing and can overlap.
let deleting = false;

function parseOrphan(stderr: string): string | null {
  // dry-run: "(report file would be orphaned: <path>)"
  // real:    "Note: report file may now be orphaned — <path>"
  const m = stderr.match(/orphaned[:—-]+\s*([^\n)]+)\)?\s*$/im);
  return m ? m[1].trim() : null;
}

export async function POST(req: Request) {
  let body: { n?: string | number; dryRun?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Pedido inválido." }, { status: 400 });
  }
  const num = String(body.n ?? "").trim();
  if (!/^\d+$/.test(num)) {
    return Response.json({ error: "É necessário indicar um número de candidatura válido." }, { status: 400 });
  }
  const dryRun = !!body.dryRun;

  if (!trackerCanDelete()) {
    return Response.json(
      { error: "A remoção de candidaturas exige uma versão mais recente do career-ops." },
      { status: 400 },
    );
  }
  // Serialize: the delete must not run while an evaluation is writing the tracker
  // (tracker.mjs delete doesn't share a lock with merge-tracker yet).
  if (isTrackerWriting()) {
    return Response.json(
      { error: "Uma avaliação está a atualizar as candidaturas. Volta a tentar dentro de instantes." },
      { status: 409 },
    );
  }
  if (!dryRun && deleting) {
    return Response.json({ error: "Já está em curso outra remoção. Volta a tentar dentro de instantes." }, { status: 409 });
  }
  if (!dryRun) deleting = true;

  const args = [rootScript("tracker"), "delete", "--num", num];
  if (dryRun) args.push("--dry-run");

  try {
    const result = await new Promise<{ code: number | null; err: string }>((resolve) => {
      let err = "";
      let child;
      try {
        child = spawn(process.execPath, args, { cwd: careerOpsRoot(), env: process.env });
      } catch (e) {
        resolve({ code: 1, err: e instanceof Error ? e.message : "Não foi possível iniciar tracker.mjs." });
        return;
      }
      child.stderr.on("data", (d: Buffer) => {
        err += d.toString();
      });
      child.stdout.on("data", () => {
        /* delete reports to stderr; drain stdout so the pipe never stalls */
      });
      const killer = setTimeout(() => {
        try {
          child.kill("SIGTERM");
        } catch {
          /* ignore */
        }
      }, 30_000);
      child.on("error", (e) => {
        clearTimeout(killer);
        resolve({ code: 1, err: e.message });
      });
      child.on("close", (code) => {
        clearTimeout(killer);
        resolve({ code, err });
      });
    });

    if (result.code !== 0) {
      const notFound = /No application numbered/i.test(result.err);
      return Response.json(
        { error: result.err.trim().split("\n")[0] || "Não foi possível remover a candidatura." },
        { status: notFound ? 404 : 400 },
      );
    }
    return Response.json({ ok: true, dryRun, orphanReport: parseOrphan(result.err) });
  } finally {
    if (!dryRun) deleting = false;
  }
}
