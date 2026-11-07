/**
 * @param {{ onDisk?: boolean, trackerMarked?: boolean, jobFinished?: boolean }} [input]
 * @returns {{ exists: boolean, stale: boolean, viewLabel: "View tailored CV" | null, note: string | null }}
 */
export function cvDiskState({ onDisk = false, trackerMarked = false, jobFinished = false } = {}) {
  if (onDisk) return { exists: true, stale: false, viewLabel: "View tailored CV", note: null };
  const stale = Boolean(trackerMarked || jobFinished);
  return {
    exists: false,
    stale,
    viewLabel: null,
    note: stale
      ? "The tracker says a tailored CV is ready, but no file is in output/. Generate it again before you apply."
      : null,
  };
}
