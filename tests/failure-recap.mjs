/**
 * failure-recap.mjs — what failed in a test-all run, and how to rerun just that.
 *
 * A full run prints about 29,000 lines. A failure sits somewhere in the middle,
 * and the last screen, which is what a contributor or their agent reads first
 * (`gh run view --log-failed` ends there too), said only "N failed". This
 * module turns the failures test-all.mjs recorded into three views of the same
 * list, all printed or written by finish() in tests/helpers.mjs:
 *
 *   - recapLines(): the plain-text recap at the end of the log;
 *   - stepSummary(): Markdown for $GITHUB_STEP_SUMMARY, the run's summary page;
 *   - annotations(): `::error` workflow commands, which GitHub shows on the
 *     PR's checks without opening the log.
 *
 * Pure functions, no I/O: tests/failure-recap.test.mjs covers them directly.
 * Recap lines never start with "  ❌", the prefix fail() prints, so a reader
 * counting failures by that prefix still counts each one once.
 */

/** Recorded under this name: a failure from test-all.mjs's own inline sections. */
export const INLINE_SUITE = 'test-all.mjs';

// The suites shown, and the messages per suite. A run that fails in hundreds
// of places has one cause; the first few say what it is.
const MAX_SUITES = 30;
const MAX_MESSAGES_PER_SUITE = 3;
const MAX_DETAIL_LINES = 40;
const MAX_MESSAGE_CHARS = 300;
// GitHub shows at most 10 error annotations per step.
const MAX_ANNOTATIONS = 10;

/**
 * The command that reruns one suite. A file under tests/ runs alone with
 * --only (matched against its path under tests/, with forward slashes on every
 * OS); a failure in the inline sections needs the full run.
 *
 * @param {string|null} suite - Repo-relative path, or null / INLINE_SUITE.
 * @returns {string}
 */
export function rerunCommand(suite) {
  const s = String(suite ?? '').replace(/\\/g, '/');
  if (!s || s === INLINE_SUITE || !s.startsWith('tests/')) return 'node test-all.mjs';
  return `node test-all.mjs --only ${s.slice('tests/'.length)}`;
}

/** First line of a message, trimmed to a readable length. */
function oneLine(msg) {
  // A message can itself begin with a verdict mark (a suite echoing a child's
  // line); repeated here it would read, and count, as one more verdict.
  const first = String(msg ?? '').split('\n')[0].trim().replace(/^(?:❌|✅|⚠️)\s*/u, '');
  return first.length > MAX_MESSAGE_CHARS ? `${first.slice(0, MAX_MESSAGE_CHARS - 1)}…` : first;
}

/**
 * Group failures by suite, in the order each suite first failed.
 *
 * @param {Array<{suite: string|null, msg: string, detail?: string[]}>} failures
 * @returns {Array<{suite: string, messages: string[], detail: string[], count: number}>}
 */
export function groupBySuite(failures) {
  const groups = new Map();
  for (const f of failures ?? []) {
    const suite = String(f?.suite ?? INLINE_SUITE).replace(/\\/g, '/');
    if (!groups.has(suite)) groups.set(suite, { suite, messages: [], detail: [], count: 0 });
    const g = groups.get(suite);
    g.count++;
    g.messages.push(oneLine(f?.msg));
    if (Array.isArray(f?.detail)) g.detail.push(...f.detail.map(String));
  }
  return [...groups.values()];
}

/**
 * The plain-text recap printed above the results line.
 *
 * @param {Array<{suite: string|null, msg: string, detail?: string[]}>} failures
 * @returns {string[]} Lines without trailing newlines; empty when nothing failed.
 */
export function recapLines(failures) {
  const groups = groupBySuite(failures);
  if (groups.length === 0) return [];
  const total = groups.reduce((n, g) => n + g.count, 0);
  const lines = ['', `── What failed (${total} in ${groups.length} place${groups.length === 1 ? '' : 's'}), and how to rerun just that ──`];
  for (const g of groups.slice(0, MAX_SUITES)) {
    lines.push(`  • ${g.suite}`);
    for (const m of g.messages.slice(0, MAX_MESSAGES_PER_SUITE)) lines.push(`      ${m}`);
    if (g.messages.length > MAX_MESSAGES_PER_SUITE) lines.push(`      … and ${g.messages.length - MAX_MESSAGES_PER_SUITE} more in this file (see the log above)`);
    lines.push(`      rerun: ${rerunCommand(g.suite)}`);
  }
  if (groups.length > MAX_SUITES) lines.push(`  … and ${groups.length - MAX_SUITES} more files (see the log above)`);
  return lines;
}

/**
 * Markdown for the job's step summary.
 *
 * @param {Array<{suite: string|null, msg: string, detail?: string[]}>} failures
 * @param {{os?: string, runnerFailedOnly?: boolean}} [context]
 * @returns {string} Empty when there is nothing to say.
 */
export function stepSummary(failures, { os = '' } = {}) {
  const groups = groupBySuite(failures);
  if (groups.length === 0) return '';
  const total = groups.reduce((n, g) => n + g.count, 0);
  const where = os ? ` on ${os}` : '';
  const out = [`## test-all failed${where}: ${total} failure${total === 1 ? '' : 's'} in ${groups.length} place${groups.length === 1 ? '' : 's'}`, ''];
  out.push('Each one reruns on its own with the command under it. The full log has the output around it.', '');
  for (const g of groups.slice(0, MAX_SUITES)) {
    out.push(`### \`${g.suite}\``, '');
    for (const m of g.messages.slice(0, MAX_MESSAGES_PER_SUITE)) out.push(`- ${m.replace(/([<>])/g, '\\$1')}`);
    if (g.messages.length > MAX_MESSAGES_PER_SUITE) out.push(`- … and ${g.messages.length - MAX_MESSAGES_PER_SUITE} more`);
    out.push('', `Rerun: \`${rerunCommand(g.suite)}\``, '');
    if (g.detail.length) {
      const shown = g.detail.slice(0, MAX_DETAIL_LINES).map((l) => l.replace(/~~~/g, '~ ~ ~'));
      out.push('<details><summary>What it printed</summary>', '', '~~~', ...shown, '~~~', '', '</details>', '');
    }
  }
  if (groups.length > MAX_SUITES) out.push(`… and ${groups.length - MAX_SUITES} more files, in the log.`, '');
  return out.join('\n');
}

/** Escape a workflow command's message (data) part. */
function escapeData(s) {
  return String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

/** Escape a workflow command's property (title) part. */
function escapeProperty(s) {
  return escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

/**
 * `::error` workflow commands, one per failing suite.
 *
 * @param {Array<{suite: string|null, msg: string}>} failures
 * @returns {string[]}
 */
export function annotations(failures) {
  return groupBySuite(failures).slice(0, MAX_ANNOTATIONS).map((g) => {
    const body = `${g.messages[0]}${g.count > 1 ? ` (+${g.count - 1} more)` : ''} — rerun: ${rerunCommand(g.suite)}`;
    return `::error title=${escapeProperty(g.suite)}::${escapeData(body)}`;
  });
}
