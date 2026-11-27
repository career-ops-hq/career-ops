// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// EchoJobs provider — RETIRED (#2976, 2026-08-20). The board-wide public JSON
// feed this provider read (https://echojobs.io/api/jobs) no longer serves
// listings: both the feed and its robots.txt now answer with a Vercel
// bot-protection checkpoint (HTTP 429), and the site's own robots.txt
// disallows /api. career-ops does not work around bot protection, so this is
// not a provider to repair — the door is closed on purpose. See
// docs/SUPPORTED_JOB_BOARDS.md for the current state.
//
// fetch() below throws immediately with that explanation rather than making
// a request against the checkpoint and surfacing a confusing raw parse error
// ("expected { jobs: [...] }") to anyone who still has `provider: echojobs`
// configured. detect() is left matching `provider: echojobs` on purpose, so
// that misconfiguration surfaces this clear message instead of a silent
// "no provider matched" — remove the entry from portals.yml once seen.

const FEED_BASE = 'https://echojobs.io/api/jobs';

// The retirement message thrown by fetch() below — also asserted verbatim in
// tests/providers/echojobs.test.mjs, so update both together.
const RETIRED_MESSAGE =
  'echojobs: this feed is gone — echojobs.io/api/jobs is now behind bot protection ' +
  '(HTTP 429, Vercel checkpoint) and the site\'s robots.txt disallows /api (#2976). ' +
  'This provider is retired, not broken-and-fixable: remove `provider: echojobs` from ' +
  'portals.yml. See docs/SUPPORTED_JOB_BOARDS.md.';

/** @type {Provider} */
export default {
  id: 'echojobs',

  detect(entry) {
    return entry?.provider === 'echojobs' ? { url: FEED_BASE } : null;
  },

  async fetch() {
    // Deliberately no network call: the feed is confirmed gone (see the file
    // header), and career-ops does not work around bot protection. Throwing
    // immediately, with a message naming the cause, is what turns "expected
    // { jobs: [...] }" into something a user can act on.
    throw new Error(RETIRED_MESSAGE);
  },
};
