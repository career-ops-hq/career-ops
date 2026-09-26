import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { withFollowupsLock, FollowupsBusyError } from "@/lib/core/followups-lock";

export { FollowupsBusyError };

// Server-only helpers shared by the follow-ups API routes (log + override).

/** data/follow-ups.md — the follow-up log + next-date pins (user layer). */
export function followupsLogPath(): string {
  return path.join(careerOpsRoot(), "data", "follow-ups.md");
}

// In-process serialization of follow-up mutations: POST log derives the next
// num from a read of the file, DELETE and the override routes do read-modify-
// write — unserialized, concurrent requests in THIS process could mint
// duplicate nums or drop lines. The web app is a single local server process,
// so a promise queue serializes them.
//
// WHAT THIS DOES **NOT** PROTECT: this queue only sees THIS process. It cannot
// see the user's CLI or the core's cadence seeder (followup-seed.mjs), which
// read-modify-write the SAME data/follow-ups.md. Its old comment claimed "no
// cross-process lock needed", and that false comfort is exactly why the gap
// survived — a reader who sees a guard stops looking for the one that is
// missing (the same shape as /api/status before #2903). Cross-process exclusion
// is the core FILE lock, reached via withFollowupsLock; this queue and that
// lock COMPOSE (see withFollowupsWrite) — neither replaces the other.
let queue: Promise<unknown> = Promise.resolve();
export function withLogLock<T>(fn: () => T | Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

// The full guard for any data/follow-ups.md mutation. Order is load-bearing and
// agreed with the core maintainer (#3034): the in-process queue OUTSIDE, the
// cross-process file lock INSIDE.
//
//   withLogLock(() => withFollowupsLock(path, fn))
//
// Why this order: the queue reduces this process's N concurrent requests to ONE
// before the file lock is touched, so the file lock only ever arbitrates "the
// one active web request vs the user's CLI". Reversed, two of the user's own
// browser tabs would contend on the cross-process lock — one wins, the other
// eats the timeout and a 409 — for a race the free in-process queue already
// resolves. Every followups writer goes through here so no call site can get
// the nesting wrong.
export function withFollowupsWrite<T>(fn: () => T | Promise<T>): Promise<T> {
  return withLogLock(() => withFollowupsLock(followupsLogPath(), fn));
}

// Map a throw from withFollowupsWrite onto an HTTP response, consistently across
// the four followups mutation handlers. A contended lock is transient (someone
// else — the CLI, the seeder, another tab — holds it right now), so it is 409 +
// Retry-After, not a 500: the caller should retry, not treat the write as
// rejected. Anything else is a real failure on this machine → 500.
export function followupsWriteError(e: unknown, fallback = "write failed"): Response {
  if (e instanceof FollowupsBusyError) {
    return Response.json(
      { error: "follow-ups file is busy — try again in a moment" },
      { status: 409, headers: { "Retry-After": "1" } },
    );
  }
  return Response.json({ error: e instanceof Error ? e.message : fallback }, { status: 500 });
}
