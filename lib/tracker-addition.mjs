/**
 * lib/tracker-addition.mjs — the helpers every headless evaluator needs to emit
 * a tracker-addition row, in one place.
 *
 * Four evaluators grew private copies of `tsvSafe` / `normalizedTrackerScore`
 * (three of them also `slugifyCompany`), and the copies drifted
 * (career-ops-hq/career-ops#3796). `gemini-eval.mjs`'s version concatenated
 * rather than parsed, so a model answering `SCORE: 4.2 (strong fit)` wrote
 * `4.2 (strong fit)/5` — neither a score nor a sentinel, which is the
 * undecidable cell `merge-tracker.mjs` refuses outright. The evaluation was
 * skipped, loudly but wholly, while the sibling copy had been immune the whole
 * time for the same input. Neither file recorded that the other existed.
 *
 * A helper whose entire job is keeping one column parseable must not exist
 * four times: the failure mode is silent divergence, and each copy has to be
 * found before it can be fixed. Consolidating also makes the guard in
 * `tests/evaluator-score-cell.test.mjs` an assertion of single-sourcing rather
 * than a sweep for copies.
 *
 * Lives in lib/ rather than in `tracker-utils.mjs`, which pulls in js-yaml and
 * the writer-lock machinery — a dependency the evaluators otherwise do not
 * need. Like lib/placeholder-cell.mjs and lib/local-today.mjs, this file
 * imports nothing.
 */

/**
 * Flatten a value into something safe to place in a tab-separated cell.
 *
 * A raw tab or newline inside a field silently shifts every field after it into
 * the wrong column, so they collapse to a single space rather than being
 * escaped.
 *
 * @param {unknown} value - Raw field value.
 * @returns {string} The value with tabs/newlines collapsed to spaces, trimmed.
 */
export function tsvSafe(value) {
  return String(value ?? '').replace(/[\t\r\n]+/g, ' ').trim();
}

/**
 * Slugify a company name for report and addition filenames.
 *
 * @param {unknown} value - Raw company name.
 * @returns {string} Lowercase dash slug, or "unknown" when nothing survives.
 */
export function slugifyCompany(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'unknown';
}

/**
 * Whether a value is a complete http(s) URL, and so can become a dedup key.
 *
 * @param {unknown} value - Candidate posting URL.
 * @returns {boolean} True only for a parseable http/https URL with a host.
 */
export function isPostingUrl(value) {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname !== '';
  } catch {
    return false;
  }
}

/**
 * Normalize a model-reported score into the tracker's score cell.
 *
 * Evaluators extract the whole rest of the `SCORE:` line and validate only its
 * numeric prefix, so `SCORE: 4.2 (strong fit)` passes validation and arrives
 * here intact.
 *
 * @param {unknown} value - Score as extracted from the model's summary block.
 * @returns {string} `X.X/5`, or the documented `N/A` sentinel (#1799).
 */
export function normalizedTrackerScore(value) {
  const clean = tsvSafe(value);
  // Parse, do not pattern-match the string. Two bugs lived in the old guard:
  // `/n\/?a/i` was unanchored with an optional slash, so bare `na` matched and a
  // real score with trailing prose -- `4.2 (final)`, `4.2 (internal)`,
  // `4.5 - strong signal` -- was recorded as `N/A`; and the `/5` early return kept
  // the whole string, so `4.2/10` became `4.2/5` and merged as a genuine score.
  // Trailing prose is tolerated because models produce it; a denominator that is
  // not 5, or a value outside 0..5, is refused rather than reinterpreted.
  const parsed = clean.match(/^(\d+(?:\.\d+)?)/);
  if (!parsed) return 'N/A';
  const score = parseFloat(parsed[1]);
  // The denominator is load-bearing wherever it sits. Requiring it immediately
  // after the number read `4.2 (strong fit)/10` -- a ten-point score with an
  // annotation -- as a bare 4.2 and wrote `4.2/5`, the same wrong number
  // `8/10` used to produce. The first denominator in the cell is taken and must
  // be 5; absent one, the scale is the contract's. A cell that puts an unrelated
  // fraction first (`4.2 (fit 3/4 axes)`) is refused rather than guessed at --
  // N/A is recoverable, a wrong score is not.
  const denominator = clean.match(/\/\s*(\d+(?:\.\d+)?)/);
  const scale = denominator ? parseFloat(denominator[1]) : 5;
  if (!Number.isFinite(score) || scale !== 5 || score < 0 || score > 5) return 'N/A';
  return `${score}/5`;
}
