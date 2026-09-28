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

// Serialization gates for tracker-writing runs, split into TWO independent
// FIFO lanes — evaluate and pdf. The old single shared gate serialized them
// against each other too (a CV generation blocked evaluations and vice versa),
// which is unnecessary: the CLI writers already serialize on the SAME
// cross-process tracker lock (tracker-utils.mjs acquireTrackerLock — used by
// merge-tracker, mark-pdf-ready, set-status), so a pdf's mark-pdf-ready cannot
// clobber an evaluate's merge even when the web runs them concurrently. And the
// web gate's one irreplaceable job — making "did THIS run write a report?"
// (route.ts reportsBefore snapshot) exact by construction — is only threatened
// by ANOTHER EVALUATE creating a report file; pdfs never write reports/.
//
// So: evaluates wait only on evaluates (lane "evaluate"), pdfs only on pdfs
// (lane "pdf"), and the two kinds run side by side. Both lanes still feed the
// `writing` map, so a row delete (which does NOT yet share the tracker lock)
// stays guarded while a pdf is mid-run exactly as it was.
export type RunLane = "evaluate" | "pdf";

const laneTails = new Map<RunLane, Promise<void>>([
  ["evaluate", Promise.resolve()],
  ["pdf", Promise.resolve()],
]);

export function acquireLaneGate(lane: RunLane): Promise<() => void> {
  const tail = laneTails.get(lane) ?? Promise.resolve();
  return new Promise((resolve) => {
    // The chain link stays pending until the holder RELEASES, not until the
    // token is acquired — otherwise every queued run would pile on after the
    // first acquisition instead of waiting for the first run to finish.
    laneTails.set(lane, tail.then(() => new Promise<void>((release) => {
      const token = acquireTrackerWrite();
      resolve(() => {
        releaseTrackerWrite(token);
        release();
      });
    })));
  });
}

export function acquireEvalGate(): Promise<() => void> {
  return acquireLaneGate("evaluate");
}

export function acquirePdfGate(): Promise<() => void> {
  return acquireLaneGate("pdf");
}
