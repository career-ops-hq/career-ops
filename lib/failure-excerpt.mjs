// lib/failure-excerpt.mjs — choose which lines of a failed child suite's output
// are worth printing (#4017).
//
// test-all.mjs runs every node:test suite in a child process and, on failure,
// printed the last twelve non-empty lines of its output. node's runner prints
// the error message ABOVE the stack frames, so that window reliably kept the
// frames and dropped the message — and the message is the only place an
// assertion's interpolated value appears. A failed `assert.ok(elapsed >= 400,
// \`gave up after \${elapsed}ms\`)` showed `actual: false, expected: true`,
// which is true of every failed assert.ok in the repository.
//
// Keep the headers the window cuts off, and keep the window. The frames locate
// the assertion; the message explains it.

/**
 * Lines that open an error block: `AssertionError [ERR_ASSERTION]: ...`,
 * `TypeError: ...`, `Error: ...`. Anchored so an `at ...` frame mentioning a
 * path with "Error" in it is not mistaken for a header.
 */
const ERROR_HEADER = /^\s*(?:[A-Za-z_$][\w$]*)?(?:Error|Exception)\b[^\n]*:/;

/**
 * Pick the lines worth printing from a failed suite's stdout/stderr.
 *
 * @param {string|null|undefined} text Raw child output.
 * @param {object} [opts]
 * @param {number} [opts.tailLines=12] Trailing lines to keep, the previous behaviour.
 * @param {number} [opts.maxHeaders=5] Ceiling on recovered headers, so a suite
 *   failing in bulk cannot flood a CI log. Truncation is reported, never silent.
 * @returns {string[]} Lines in source order, each already trimmed of nothing —
 *   callers add their own indentation.
 */
export function failureExcerpt(text, { tailLines = 12, maxHeaders = 5 } = {}) {
  const lines = String(text ?? '').split('\n').filter((l) => l.trim());
  if (lines.length === 0) return [];

  const firstTail = Math.max(0, lines.length - tailLines);
  // Index-based, not text-based: two identical frames are two real frames, and
  // selecting by index keeps each line once without collapsing genuine repeats.
  const keep = new Set();
  for (let i = firstTail; i < lines.length; i++) keep.add(i);

  let dropped = 0;
  for (let i = 0; i < firstTail; i++) {
    if (!ERROR_HEADER.test(lines[i])) continue;
    if (keep.size - tailLines >= maxHeaders) { dropped++; continue; }
    keep.add(i);
  }

  const out = [...keep].sort((a, b) => a - b).map((i) => lines[i]);
  if (dropped > 0) out.push(`... ${dropped} more error line(s) not shown`);
  return out;
}
