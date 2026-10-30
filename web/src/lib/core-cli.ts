import { execFile } from "node:child_process";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";

const CORE_CLI_TIMEOUT_MS = 30_000;

// The CLI waits a full minute for the tracker lock by default, which is right
// for a batch run and wrong for an HTTP request: the browser would hang and
// then get killed by the timeout above — reported as a crash — instead of the
// 503 the contended case should produce. Bounding the child's wait below our
// own kill timeout lets its exit-4 path actually fire, so a busy tracker comes
// back as "retry shortly" in a few seconds.
//
// An operator's own value is honored only while it stays under the ceiling.
// Above it the two settings contradict each other — the child would still be
// waiting when we kill it — and the result is not a longer wait but the loss of
// the lock-timeout signal entirely.
const LOCK_WAIT_DEFAULT_MS = 10_000;
const LOCK_WAIT_CEILING_MS = CORE_CLI_TIMEOUT_MS - 5_000;

function boundedLockWait(): Record<string, string> {
  const raw = Number(process.env.CAREER_OPS_TRACKER_LOCK_TIMEOUT_MS);
  const requested = Number.isFinite(raw) && raw > 0 ? raw : LOCK_WAIT_DEFAULT_MS;
  const wait = String(Math.min(requested, LOCK_WAIT_CEILING_MS));
  // followup-seed.mjs takes the follow-ups lock, with its own timeout variable.
  return { CAREER_OPS_TRACKER_LOCK_TIMEOUT_MS: wait, CAREER_OPS_FOLLOWUPS_LOCK_TIMEOUT_MS: wait };
}

export type CliResult = { code: number; stdout: string; stderr: string; spawnFailed: boolean; timedOut: boolean };

export function runCoreCli(script: string, args: string[]): Promise<CliResult> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [rootScript(script), ...args],
      {
        cwd: careerOpsRoot(),
        timeout: CORE_CLI_TIMEOUT_MS,
        env: { ...process.env, ...boundedLockWait() },
        // windowsHide: see api/doctor/route.ts — a stale inherited console
        // kills every child with 0xC0000142 on Windows; never inherit one.
        windowsHide: true,
      },
      (err, stdout, stderr) => {
        // execFile reports three different things through one error object: a
        // non-zero exit, a kill (our timeout), and a failure to spawn at all.
        // They map to different HTTP statuses, and a killed child carries no
        // numeric exit code — indistinguishable from a spawn failure unless
        // `killed` is checked first.
        const e = err as (NodeJS.ErrnoException & { killed?: boolean }) | null;
        const timedOut = e?.killed === true;
        const code = typeof e?.code === "number" ? e.code : e ? -1 : 0;
        resolve({
          code,
          stdout: stdout || "",
          stderr: stderr || "",
          spawnFailed: !timedOut && code === -1,
          timedOut,
        });
      },
    );
  });
}

export function runSetStatus(args: string[]): Promise<CliResult> {
  return runCoreCli("set-status", args);
}
