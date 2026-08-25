// tests/liveness-api-linkedin.test.mjs — the LinkedIn rung of the liveness ladder.
//
// LinkedIn had no API rung, so every LinkedIn URL fell through to Playwright. A
// headless fetch of linkedin.com/jobs/view/{id} lands on a generic search page, so
// that rung never produced a verdict worth trusting and dead LinkedIn postings kept
// reading as live.
//
// The rung reads the guest endpoint, which returns rendered HTML with no auth and
// no browser. Two independent signals, and BOTH have to agree:
//
//   closed marker present + no apply control -> expired
//   no closed marker      + apply control    -> active
//   anything else                            -> uncertain
//
// The asymmetry that matters: a false `expired` costs the user a real job they
// never see again, while a false `uncertain` costs one re-check. So a checker that
// can only ever answer "expired" is worse than no checker at all. Every assertion
// below that names a `live` fixture is the negative control for that failure mode:
// delete the apply-control signal from the implementation and they redden; delete
// the closed-marker signal and the expired assertions redden. Neither direction can
// go green on its own.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';

const { resolveAtsApi, classifyLinkedInPosting, checkLivenessViaApi, throttleProviderRequest } =
  await import(pathToFileURL(join(ROOT, 'liveness-api.mjs')).href);

console.log('\nLinkedIn liveness rung');

function check(desc, condition, details = '') {
  if (condition) pass(desc);
  else fail(`${desc}${details ? ` (${details})` : ''}`);
}

const fixture = (name) => readFileSync(join(ROOT, 'tests', 'fixtures', `linkedin-guest-${name}.html`), 'utf-8');
const CLOSED = fixture('closed');
const LIVE_ONSITE = fixture('live-onsite');
const LIVE_MODAL = fixture('live-modal');

const ID = '4402976479';
const API = `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${ID}`;

// -- 1. URL -> guest API resolution -----------------------------------------
{
  const bare = resolveAtsApi(`https://www.linkedin.com/jobs/view/${ID}/`);
  check('a bare /jobs/view/{id} URL resolves to the guest posting endpoint',
    bare?.ats === 'linkedin' && bare.apiUrl === API, JSON.stringify(bare));

  // The URL people actually copy out of LinkedIn carries a title slug in front
  // of the id.
  const slug = resolveAtsApi(`https://www.linkedin.com/jobs/view/staff-software-engineer-at-acme-${ID}`);
  check('a slugged /jobs/view/{slug}-{id} URL resolves to the same endpoint',
    slug?.ats === 'linkedin' && slug.apiUrl === API, JSON.stringify(slug));

  // Search and collection pages keep the posting id in the query string; a URL
  // pasted from that view is still a specific posting.
  const search = resolveAtsApi(`https://www.linkedin.com/jobs/search/?currentJobId=${ID}&keywords=engineer`);
  check('a ?currentJobId= search URL resolves to the same endpoint',
    search?.ats === 'linkedin' && search.apiUrl === API, JSON.stringify(search));

  const collection = resolveAtsApi(`https://www.linkedin.com/jobs/collections/recommended/?currentJobId=${ID}`);
  check('a ?currentJobId= collections URL resolves to the same endpoint',
    collection?.ats === 'linkedin' && collection.apiUrl === API, JSON.stringify(collection));

  check('the rung declares an interpret step, so a 200 alone never means live',
    typeof bare?.interpret === 'function', JSON.stringify(bare));
}

// -- 2. what must NOT resolve ------------------------------------------------
// Every one of these would either point the fixed-host URL template at something
// that is not a posting, or hand a non-posting page to the classifier.
{
  const rejects = [
    ['a LinkedIn profile URL', 'https://www.linkedin.com/in/example-person'],
    ['a company page', 'https://www.linkedin.com/company/acme/jobs/'],
    ['a job search page with no posting id', 'https://www.linkedin.com/jobs/search/?keywords=engineer'],
    ['a non-numeric job id', 'https://www.linkedin.com/jobs/view/not-a-number/'],
    ['a non-numeric currentJobId', 'https://www.linkedin.com/jobs/search/?currentJobId=abc'],
    ['a lookalike host', 'https://notlinkedin.com/jobs/view/4402976479'],
    ['a subdomain-suffix lookalike host', 'https://linkedin.com.example.org/jobs/view/4402976479'],
    ['plain http', 'http://www.linkedin.com/jobs/view/4402976479'],
  ];
  for (const [desc, url] of rejects) {
    check(`${desc} does not resolve to the LinkedIn rung`, resolveAtsApi(url) === null, url);
  }

  // Regional subdomains are real LinkedIn posting hosts and must still resolve.
  const regional = resolveAtsApi(`https://uk.linkedin.com/jobs/view/${ID}`);
  check('a regional LinkedIn subdomain still resolves', regional?.ats === 'linkedin', JSON.stringify(regional));
}

// -- 3. the two-signal classifier, on real captured markup -------------------
{
  const closed = classifyLinkedInPosting(CLOSED);
  check('a posting carrying the closed marker and no apply control is expired',
    closed?.result === 'expired', JSON.stringify(closed));
  check('and the expired verdict carries a LinkedIn-specific code',
    closed?.code === 'linkedin_closed_marker', JSON.stringify(closed));

  // NEGATIVE CONTROL. If the apply-control signal stops being read, these two go
  // red and nothing else does — which is the whole point of asserting them by
  // name. A rung that answers "expired" for every posting passes every assertion
  // above and fails exactly here.
  const onsite = classifyLinkedInPosting(LIVE_ONSITE);
  check('a posting with the on-site apply button and no closed marker is live',
    onsite?.result === 'active', JSON.stringify(onsite));
  check('and it is specifically NOT reported expired',
    onsite?.result !== 'expired', JSON.stringify(onsite));

  const modal = classifyLinkedInPosting(LIVE_MODAL);
  check('a posting with the off-site apply modal and no closed marker is live',
    modal?.result === 'active', JSON.stringify(modal));
  check('and it is specifically NOT reported expired',
    modal?.result !== 'expired', JSON.stringify(modal));

  check('the live verdict carries a LinkedIn-specific code',
    onsite?.code === 'linkedin_apply_control' && modal?.code === 'linkedin_apply_control',
    `${JSON.stringify(onsite)} ${JSON.stringify(modal)}`);
}

// -- 4. one signal is never enough -------------------------------------------
// Both halves have to agree. These are the cases where the page is telling us two
// things at once, or nothing at all, and a guess in either direction is wrong.
{
  const both = classifyLinkedInPosting(`${CLOSED}\n${LIVE_ONSITE}`);
  check('closed marker AND apply control together is uncertain, not a guess',
    both?.result === 'uncertain', JSON.stringify(both));

  const neither = classifyLinkedInPosting(
    '<section class="core-rail"><h1 class="top-card-layout__title">Staff Software Engineer</h1></section>'
  );
  check('neither signal present is uncertain, not expired',
    neither?.result === 'uncertain', JSON.stringify(neither));

  // The signals must be read independently rather than one being derived from the
  // other: apply control alone, with no closed marker, is the live case above;
  // closed marker alone, with no apply control, is the expired case above. This
  // pins that a body carrying only the marker never reads as live.
  const markerOnly = classifyLinkedInPosting(
    '<figcaption class="closed-job__flavor--closed">No longer accepting applications</figcaption>'
  );
  check('the closed marker on its own never reads as live',
    markerOnly?.result === 'expired', JSON.stringify(markerOnly));

  check('an empty body is inconclusive rather than expired',
    classifyLinkedInPosting('') === null, JSON.stringify(classifyLinkedInPosting('')));
  check('a non-string body is inconclusive rather than expired',
    classifyLinkedInPosting(null) === null && classifyLinkedInPosting(undefined) === null);
}

// -- 5. the interpret step is wired to the classifier -------------------------
// The classifier being right is worth nothing if the rung never calls it. This
// runs the real interpret over a real Response, so the body read is exercised too.
{
  const resolved = resolveAtsApi(`https://www.linkedin.com/jobs/view/${ID}/`);
  const verdict = await resolved.interpret(new Response(CLOSED, { status: 200 }), resolved.parts);
  check('interpret runs the classifier over the response body',
    verdict?.result === 'expired' && verdict.code === 'linkedin_closed_marker', JSON.stringify(verdict));

  const live = await resolved.interpret(new Response(LIVE_MODAL, { status: 200 }), resolved.parts);
  check('and returns live for a live body, through the same path',
    live?.result === 'active', JSON.stringify(live));
}

// -- 6. end to end through checkLivenessViaApi --------------------------------
// One call only: the rung throttles itself, so a second would sleep for seconds.
{
  const realFetch = globalThis.fetch;
  let requested = null;
  let sentHeaders = null;
  globalThis.fetch = async (url, init) => {
    requested = String(url);
    sentHeaders = init?.headers ?? null;
    return new Response(LIVE_ONSITE, { status: 200, headers: { 'content-type': 'text/html' } });
  };
  try {
    const verdict = await checkLivenessViaApi(`https://www.linkedin.com/jobs/view/${ID}/`);
    check('checkLivenessViaApi returns the live verdict for a LinkedIn posting',
      verdict?.result === 'active' && verdict.code === 'linkedin_apply_control', JSON.stringify(verdict));
    check('and it asked the guest endpoint, not the posting page',
      requested === API, String(requested));
    check('and asked for HTML, which is what the rung parses',
      /text\/html/.test(String(sentHeaders?.accept ?? '')), JSON.stringify(sentHeaders));
  } finally {
    globalThis.fetch = realFetch;
  }
}

// -- 7. throttling ------------------------------------------------------------
// The guest endpoint is unauthenticated and rate-limited; a manual sweep of it has
// to space calls 3-4s apart. The interval lives on the provider so it applies to
// every caller, not just the one loop in check-liveness.mjs.
{
  const resolved = resolveAtsApi(`https://www.linkedin.com/jobs/view/${ID}/`);
  check('the LinkedIn rung declares a throttle interval of at least 3s',
    typeof resolved?.throttleMs === 'number' && resolved.throttleMs >= 3000, JSON.stringify(resolved?.throttleMs));

  // Reserve-then-wait, so back-to-back callers queue instead of all reading the
  // same "last request" timestamp and firing together.
  const started = Date.now();
  const first = await throttleProviderRequest('test-provider-linkedin-rung', 60);
  const second = await throttleProviderRequest('test-provider-linkedin-rung', 60);
  const elapsed = Date.now() - started;
  check('the first request through a throttled provider does not wait', first === 0, String(first));
  check('the second waits out the interval', second >= 55 && elapsed >= 55, `waited=${second} elapsed=${elapsed}`);
  check('a provider with no declared interval never waits',
    (await throttleProviderRequest('test-provider-linkedin-rung-unthrottled', 0)) === 0);
}

// -- 8. the ladder still prefers this rung over the browser -------------------
// Structural: a rung nothing routes to is indistinguishable from no rung. The
// browser rung is the thing being avoided here, so assert the caller checks the
// API first rather than trusting the ordering to stay put.
{
  const src = readFileSync(join(ROOT, 'check-liveness.mjs'), 'utf-8');
  const apiAt = src.indexOf('checkLivenessViaApi(');
  const browserAt = src.indexOf('checkUrlLivenessWithFallback(');
  check('check-liveness.mjs consults the API rung before the browser rung',
    apiAt > -1 && browserAt > -1 && apiAt < browserAt, `api=${apiAt} browser=${browserAt}`);
}
