/**
 * Raw `**URL:**` token → bare URL — algorithm mirror of the core's
 * `unwrapReportUrlToken` in tracker-parse.mjs (root).
 *
 * Plain .mjs (same pattern as url-key.mjs) so node:test can import it without
 * a TS runner. No dependencies, same as the core it mirrors.
 *
 * WHY A COPY EXISTS AT ALL: the live core lives in the user's career-ops
 * checkout and is resolved at runtime via careerOpsRoot(), while
 * whats-new-suppression.mjs imports its URL helpers statically (it already
 * keys with the url-key.mjs mirror). The core unwraps every report token before
 * keying it (tracker-utils.mjs reportUrlToken, verify-pipeline.mjs
 * extractReportUrlKey, tracker-parse.mjs reportUrlForNumbers), so the web must
 * too: kept raw, `<https://…>` has no key (the posting reads as unknown) and
 * `https://….` keys as a different posting.
 *
 * Keep the body byte-for-byte aligned with tracker-parse.mjs
 * `unwrapReportUrlToken`. The parity test in tests/lib/report-url-token.test.mjs
 * fails the build if they drift.
 *
 * @param {string} token
 * @returns {string}
 */
export function unwrapReportUrlToken(token) {
  let url = String(token);
  let depth = 0;
  for (const ch of url) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
  }
  for (;;) {
    const last = url.at(-1);
    if (last === ',' || last === '.' || last === ';') url = url.slice(0, -1);
    else if (last === ')' && depth < 0) {
      url = url.slice(0, -1);
      depth++;
    } else break;
  }
  return url.replace(/^<|>$/g, '');
}
