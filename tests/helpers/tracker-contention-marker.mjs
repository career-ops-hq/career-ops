import { existsSync, readFileSync } from 'node:fs';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function readMarker(markerPath) {
  if (!existsSync(markerPath)) return null;
  try {
    return JSON.parse(readFileSync(markerPath, 'utf-8'));
  } catch {
    // A concurrent writer may still be finishing its JSON write.
    return null;
  }
}

/**
 * Wait for a test-only contention marker to become valid JSON.
 *
 * The marker writer creates the file before its JSON bytes are necessarily
 * visible to a concurrent reader. Treat a parse failure like a missing file
 * and keep polling until the caller's bounded deadline.
 *
 * `stopWhen`, when given, ends the wait early once it returns true — e.g. when
 * the writer has exited, after which no marker can still arrive. The marker
 * is read once more at that point, so one written just before the exit counts.
 */
export async function waitForContentionMarker(markerPath, timeoutMs, { stopWhen } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const stopping = stopWhen?.() === true;
    const marker = readMarker(markerPath);
    if (marker || stopping) return marker;
    await sleep(10);
  }
  return null;
}
