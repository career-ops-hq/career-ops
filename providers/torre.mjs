// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Torre provider — RETIRED (#4859, 2026-10-08). The public opportunity search
// this provider read (POST https://search.torre.co/opportunities/_search) now
// answers HTTP 400 {"meta":{"message":"Invalid request"}} to every body,
// including `{}`, and torre.ai's own job search became an AI chat that makes no
// request to search.torre.co. The API this was built on looks changed or
// retired, so there is nothing to repair against.
//
// fetch() below throws immediately with that explanation instead of surfacing
// a bare "HTTP 400 Bad Request" for each configured entry. detect() still
// matches `provider: torre` on purpose, so the message reaches anyone who still
// has an entry — remove it from portals.yml once seen. See
// docs/SUPPORTED_JOB_BOARDS.md.

// The retirement message thrown by fetch() below — also asserted in
// tests/providers/torre.test.mjs, so update both together.
const RETIRED_MESSAGE =
  'torre: this source is unavailable — search.torre.co/opportunities/_search now answers ' +
  'HTTP 400 "Invalid request" to every query, and torre.ai\'s job search no longer uses it (#4859). ' +
  'This provider is retired, not broken-and-fixable: remove `provider: torre` from ' +
  'portals.yml. See docs/SUPPORTED_JOB_BOARDS.md.';

const SEARCH_ENDPOINT = 'https://search.torre.co/opportunities/_search';

/** @type {Provider} */
export default {
  id: 'torre',

  detect(entry) {
    return entry?.provider === 'torre' ? { url: SEARCH_ENDPOINT } : null;
  },

  async fetch() {
    // Deliberately no network call: the endpoint rejects every body (see the
    // file header). Throwing here, with the cause named, replaces one opaque
    // "HTTP 400 Bad Request" per configured entry with something actionable.
    throw new Error(RETIRED_MESSAGE);
  },
};
