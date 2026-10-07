import { existsSync, readFileSync } from 'node:fs';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Wait for a test-only contention marker to become valid JSON.
 *
 * The marker writer creates the file before its JSON bytes are necessarily
 * visible to a concurrent reader. Treat a parse failure like a missing file
 * and keep polling until the caller's bounded deadline.
 */
export async function waitForContentionMarker(markerPath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(markerPath)) {
      try {
        return JSON.parse(readFileSync(markerPath, 'utf-8'));
      } catch {
        // A concurrent writer may still be finishing its JSON write.
      }
    }
    await sleep(10);
  }
  return null;
}
