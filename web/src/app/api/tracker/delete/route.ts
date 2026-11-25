import { spawn } from "node:child_process";
import { rootScript, trackerCanDelete } from "@/lib/career-ops";
import { resolveCodeRoot } from "@/lib/core/code-root.mjs";
import { isTrackerWriting } from "@/lib/core/run-registry";
import { parseOrphanReport } from "@/lib/tracker-delete-output.mjs";
import { readJsonObject } from "@/lib/json-body";

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

export async function POST(req: Request) {
  const body = await readJsonObject<{ n?: string | number; dryRun?: boolean }>(req);
  if (!body) return Response.json({ error: "bad json" }, { status: 400 });
  const num = String(body.n ?? "").trim();
  if (!/^\d+$/.test(num)) {
    return Response.json({ error: "a numeric application number is required" }, { status: 400 });
  }
  const dryRun = !!body.dryRun;

  if (!trackerCanDelete()) {
    return Response.json(
      { error: "Removing a tracker row needs a newer career-ops — update to delete rows from here." },
      { status: 400 },
    );
  }
  // Serialize: the delete must not run while an evaluation is writing the tracker
  // (tracker.mjs delete doesn't share a lock with merge-tracker yet).
  if (isTrackerWriting()) {
    return Response.json(
      { error: "An evaluation is updating your tracker right now — try again in a moment." },
      { status: 409 },
    );
  }
  if (!dryRun && deleting) {
    return Response.json({ error: "Another delete is already in progress — try again in a moment." }, { status: 409 });
  }
  if (!dryRun) deleting = true;

  const args = [rootScript("tracker"), "delete", "--num", num];
  if (dryRun) args.push("--dry-run");

  try {
    const result = await new Promise<{ code: number | null; err: string }>((resolve) => {
      let err = "";
      let child;
      try {
        // windowsHide: see api/doctor/route.ts — a stale inherited console
        // kills every child with 0xC0000142 on Windows; never inherit one.
        child = spawn(process.execPath, args, { cwd: resolveCodeRoot(process.cwd(), process.env), env: process.env, windowsHide: true });
      } catch (e) {
        resolve({ code: 1, err: e instanceof Error ? e.message : "failed to start tracker.mjs" });
        return;
      }
      child.stderr.on("data", (d: Buffer) => {
        err += d.toString();
      });
      child.stdout.on("data", () => {
        /* delete reports to stderr; drain stdout so the pipe never stalls */
      });
      // CAREER_OPS_CHILD_TIMEOUT_MS lets a test prove the kill without waiting
      // 30 seconds. A child that ignores SIGTERM used to leave this promise,
      // and the deleting flag, open forever. Exit 0 during the grace window
      // is the script finishing, so that result stands.
      const requested = Number(process.env.CAREER_OPS_CHILD_TIMEOUT_MS);
      const timeout = Number.isFinite(requested) && requested > 0 ? requested : 30_000;
      const grace = 2_000;
      let settled = false;
      let stopping = false;
      let gaveUp = false;
      let killer: ReturnType<typeof setTimeout> | undefined;
      let hardKill: ReturnType<typeof setTimeout> | undefined;
      let giveUp: ReturnType<typeof setTimeout> | undefined;
      const finish = (value: { code: number | null; err: string }) => {
        if (settled) return;
        settled = true;
        if (killer) clearTimeout(killer);
        if (hardKill) clearTimeout(hardKill);
        if (giveUp) clearTimeout(giveUp);
        resolve(value);
      };
      const timedOut = () => ({ code: null, err: "Delete timed out after 30 seconds and was stopped." });
      killer = setTimeout(() => {
        stopping = true;
        try { child.kill("SIGTERM"); } catch { /* already gone */ }
        hardKill = setTimeout(() => {
          try { child.kill("SIGKILL"); } catch { /* already gone */ }
        }, grace);
        // close waits on the pipes. A descendant holding stdout never delivers
        // it, and SIGKILL does not reach that descendant.
        giveUp = setTimeout(() => {
          gaveUp = true;
          finish(timedOut());
        }, grace + 1_000);
      }, timeout);
      child.on("error", (e) => finish({ code: 1, err: e.message }));
      child.on("close", (code) => {
        if (gaveUp) return;
        if (stopping && code == null) {
          finish(timedOut());
          return;
        }
        finish({ code, err });
      });
    });

    if (result.code !== 0) {
      const notFound = /No application numbered/i.test(result.err);
      return Response.json(
        { error: result.err.trim().split("\n")[0] || "delete failed" },
        { status: notFound ? 404 : 400 },
      );
    }
    return Response.json({ ok: true, dryRun, orphanReport: parseOrphanReport(result.err) });
  } finally {
    if (!dryRun) deleting = false;
  }
}
