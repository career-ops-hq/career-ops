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
 * The same information in node's TAP reporter, which is the default on node 20
 * and 22 whenever stdout is not a terminal (node 23 made spec the default). TAP
 * prints no `AssertionError [ERR_ASSERTION]: ...` line at all: the message sits
 * under `error:` in a YAML block, either on that line or indented below a `|-`,
 * and the error code has a line of its own. Those lines sit about twenty lines
 * from the end, above the frames and the summary, so the window missed them and
 * the excerpt on node 22 was frames only.
 */
const TAP_ERROR = /^(\s*)error: /;
const TAP_CODE = /^\s*code: '[A-Z][A-Z0-9_]*'$/;
const TAP_STACK = /^(\s*)stack: \|-$/;

const indentOf = (line) => line.length - line.trimStart().length;

/**
 * Indexes of TAP error lines: each `error:` line, the indented lines of its
 * block message, each `code: '...'` line, and the first frame under `stack: |-`
 * (the one that locates the assertion; the window keeps the frames below it
 * on the spec reporter, but on TAP the summary pushes all of them out).
 *
 * @param {string[]} lines Non-empty output lines.
 * @returns {Set<number>}
 */
function tapErrorLines(lines) {
  const found = new Set();
  for (let i = 0; i < lines.length; i++) {
    if (TAP_CODE.test(lines[i])) { found.add(i); continue; }
    const stack = TAP_STACK.exec(lines[i]);
    if (stack) {
      if (i + 1 < lines.length && indentOf(lines[i + 1]) > stack[1].length) found.add(i + 1);
      continue;
    }
    const m = TAP_ERROR.exec(lines[i]);
    if (!m) continue;
    found.add(i);
    // A block message continues while the lines are indented deeper than the
    // `error:` key; the next key at the same depth ends it.
    const depth = m[1].length;
    while (i + 1 < lines.length && indentOf(lines[i + 1]) > depth) {
      found.add(++i);
    }
  }
  return found;
}

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

  const tap = tapErrorLines(lines);
  let dropped = 0;
  for (let i = 0; i < firstTail; i++) {
    if (!ERROR_HEADER.test(lines[i]) && !tap.has(i)) continue;
    if (keep.size - tailLines >= maxHeaders) { dropped++; continue; }
    keep.add(i);
  }

  const out = [...keep].sort((a, b) => a - b).map((i) => lines[i]);
  if (dropped > 0) out.push(`... ${dropped} more error line(s) not shown`);
  return out;
}

/**
 * The excerpt for a failed child run, read from both of its streams.
 *
 * node's runner writes its failure report to stdout, and warnings or a crash
 * land on stderr. Taking whichever stream is non-empty printed a warning and
 * dropped the assertion. stderr goes first, so the tail window stays on
 * stdout's frames, and an error header on stderr is still recovered. One pass
 * over the joined text keeps the same bound as a single stream.
 *
 * @param {{ stdout?: string, stderr?: string }|null|undefined} detail
 * @param {object} [opts] Passed through to failureExcerpt.
 * @returns {string[]}
 */
export function childFailureExcerpt(detail, opts) {
  const streams = [detail?.stderr, detail?.stdout].filter((s) => s && String(s).trim());
  return failureExcerpt(streams.join('\n'), opts);
}
