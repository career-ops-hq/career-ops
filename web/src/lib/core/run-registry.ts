// In-memory registry of in-flight runs that WRITE the tracker (kind evaluate/pdf →
// the core runs merge-tracker / updates applications.md). The web is a single local
// Node process, so a module-level set is enough.
//
// Why this exists: `tracker.mjs delete` (#1200) does NOT yet share a file lock with
// merge-tracker (a documented follow-up — merge-tracker isn't import-safe), so a row
// delete must not run while a worker is mid-merge or one of the two writes is lost.
// The delete route serializes against this registry — coarse (the whole run), but
// correct: we never delete while an evaluation is in flight.
//
// WHAT THIS DOES **NOT** PROTECT, and the reason that matters: this is a counter
// in THIS process's memory. It cannot see the user's CLI, a second `career-ops
// web` instance, or anything else on the machine. Cross-process exclusion on
// data/applications.md is the core's FILE lock (tracker-utils.mjs), reached from
// web via lib/core/tracker-lock.ts.
//
// The distinction is not academic: /api/status wrote the tracker with no file
// lock at all while this registry existed one import away, so the route looked
// guarded and lost updates against the CLI in silence (#2900). A reader who sees
// a guard stops looking for the one that is missing — which is exactly why this
// paragraph is here and not in a commit message.
//
// Rule of thumb: in-flight question → this registry. Writing the tracker →
// withTrackerLock. They compose; neither substitutes for the other.

let seq = 0;
const writing = new Set<number>();

/** Mark that a tracker-writing run has started; returns a token to release with. */
export function acquireTrackerWrite(): number {
  const token = ++seq;
  writing.add(token);
  return token;
}

export function releaseTrackerWrite(token: number): void {
  writing.delete(token);
}

/** True while any evaluation/pdf run that mutates applications.md is in flight. */
export function isTrackerWriting(): boolean {
  return writing.size > 0;
}
