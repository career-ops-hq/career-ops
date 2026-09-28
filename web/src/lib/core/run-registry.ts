// In-memory registry of in-flight runs that WRITE the tracker (kind evaluate/pdf →
// the core runs merge-tracker / updates applications.md). The web is a single local
// Node process, so a module-level map is enough.
//
// Why this exists: `tracker.mjs delete` (#1200) does NOT yet share a file lock with
// merge-tracker (a documented follow-up — merge-tracker isn't import-safe), so a row
// delete must not run while a worker is mid-merge or one of the two writes is lost.
// Status updates use set-status.mjs's own tracker lock — they do NOT consult this.

let seq = 0;
/** token → acquiredAt (ms). Pruned if a stream never releases (client disconnect edge cases). */
const writing = new Map<number, number>();

/** Slightly above pdf killMs in /api/run so stale tokens self-heal. */
const MAX_WRITE_MS = 750_000;

function pruneStaleWrites(): void {
  const now = Date.now();
  for (const [token, at] of writing) {
    if (now - at > MAX_WRITE_MS) writing.delete(token);
  }
}

/** Mark that a tracker-writing run has started; returns a token to release with. */
export function acquireTrackerWrite(): number {
  pruneStaleWrites();
  const token = ++seq;
  writing.set(token, Date.now());
  return token;
}

export function releaseTrackerWrite(token: number): void {
  writing.delete(token);
}

/** True while any evaluation/pdf run that mutates applications.md is in flight. */
export function isTrackerWriting(): boolean {
  pruneStaleWrites();
  return writing.size > 0;
}

// Serialization gate for tracker-writing runs. reports/ and applications.md are
// single-writer resources, and two CONCURRENT evaluations each snapshotting
// reports/ made "did THIS run write a report?" ambiguous — run A's close handler
// claimed run B's just-written report as its own (PolicyBazaar job-12,
// 2026-09-28, where A had no report at all yet read a green "report saved").
// Rather than trusting an agent-typed marker — more prompt formatting for a
// correctness boundary — serialize the writers: callers of acquireWriteGate()
// hold the gate for the WHOLE run and release via the returned fn. The gate
// still feeds the `writing` map, so a row delete is guarded exactly as before.
let writeQueueTail: Promise<void> = Promise.resolve();
export function acquireWriteGate(): Promise<() => void> {
  return new Promise((resolve) => {
    // The chain link stays pending until the holder RELEASES, not until the
    // token is acquired — otherwise every queued run would pile on after the
    // first acquisition instead of waiting for the first run to finish.
    writeQueueTail = writeQueueTail.then(() => new Promise<void>((release) => {
      const token = acquireTrackerWrite();
      resolve(() => {
        releaseTrackerWrite(token);
        release();
      });
    }));
  });
}
