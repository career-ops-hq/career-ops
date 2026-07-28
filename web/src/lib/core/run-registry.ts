// In-memory registry of in-flight runs that WRITE the tracker (kind evaluate/pdf →
// the core runs merge-tracker / updates applications.md). The web is a single local
// Node process, so a module-level set is enough.
//
// Why this exists: `tracker.mjs delete` (#1200) does NOT yet share a file lock with
// merge-tracker (a documented follow-up — merge-tracker isn't import-safe), so a row
// delete must not run while a worker is mid-merge or one of the two writes is lost.
// The delete route serializes against this registry — coarse (the whole run), but
// correct: we never delete while an evaluation is in flight.

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
