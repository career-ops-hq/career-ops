// Parity + regression tests for the web's LinkedIn posting-URL mirror.
// Imports the core and the web copy side-by-side so they can never drift, same
// pattern as url-key.test.mjs and normalize-text-key.test.mjs.
//
// The core keeps this rung inside liveness-api.mjs's ATS_PROVIDERS table rather
// than exporting the parser, so parity is asserted through the one public seam
// that reaches it: resolveAtsApi(), which returns { ats, apiUrl } for a posting
// it recognizes. That is the same pair the mirror produces, so comparing the two
// pins both halves (which URLs count as a posting, and what endpoint they map to)
// without reaching into the table.
//
// Run:  node --test tests/lib/linkedin-url.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL, fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { linkedInJobId, linkedInGuestUrl, linkedInCanonicalUrl } from "../../src/lib/core/linkedin-url.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const { resolveAtsApi } = await import(pathToFileURL(join(ROOT, "liveness-api.mjs")).href);

/** What the mirror says about a raw URL, in resolveAtsApi's shape (or null). */
function webResolve(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const id = linkedInJobId(u);
  return id === null ? null : { ats: "linkedin", apiUrl: linkedInGuestUrl(id) };
}

/** Only the fields the mirror is responsible for; the core returns more. */
function coreResolve(raw) {
  const r = resolveAtsApi(raw);
  return r && r.ats === "linkedin" ? { ats: r.ats, apiUrl: r.apiUrl } : null;
}

// Every input here is https, because resolveAtsApi refuses a non-https URL
// outright (its SSRF stance) while the mirror is called from normalizeJobUrl,
// which has already decided the scheme is acceptable. Comparing on http would be
// asserting a difference in the CALLER's contract, not drift in the parser.
// The http case is covered by job-url.test.mjs, which owns that contract.
const RECOGNIZED = [
  "https://www.linkedin.com/jobs/view/4434693435/",
  "https://www.linkedin.com/jobs/view/4434693435",
  "https://www.linkedin.com/jobs/view/senior-ai-engineer-at-acme-4434693435",
  "https://linkedin.com/jobs/view/4434693435/",
  "https://uk.linkedin.com/jobs/view/4434693435/",
  "https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4434693435",
  "https://www.linkedin.com/jobs/search/?currentJobId=4434693435&keywords=ai",
];

const NOT_A_POSTING = [
  // Not one posting: a board, a company page, a feed.
  "https://www.linkedin.com/jobs/",
  "https://www.linkedin.com/company/acme/jobs/",
  "https://www.linkedin.com/feed/",
  // Suffix-matching a host is the classic bypass. linkedin.com must be the
  // registrable domain, not a prefix of one.
  "https://linkedin.com.evil.example/jobs/view/4434693435/",
  "https://notlinkedin.com/jobs/view/4434693435/",
  // currentJobId present but not an id.
  "https://www.linkedin.com/jobs/search/?currentJobId=abc",
  "https://www.linkedin.com/jobs/search/?currentJobId=",
  // A non-LinkedIn posting: this rung must not claim it.
  "https://boards.greenhouse.io/acme/jobs/4567890",
];

test("web mirror matches core on every recognized LinkedIn posting shape", () => {
  for (const input of RECOGNIZED) {
    const web = webResolve(input);
    assert.notEqual(web, null, `mirror failed to recognize: ${input}`);
    assert.deepEqual(web, coreResolve(input), `parity: ${input}`);
  }
});

test("web mirror matches core on URLs that are NOT one LinkedIn posting", () => {
  for (const input of NOT_A_POSTING) {
    assert.equal(webResolve(input), null, `mirror wrongly recognized: ${input}`);
    assert.equal(coreResolve(input), null, `core parity: ${input}`);
  }
});

test("the guest endpoint is built from a fixed host and digits only", () => {
  // The whole SSRF argument for this module: `id` is a digits-only capture, so
  // nothing user-supplied can reach the hostname. If the capture ever loosens,
  // this fails.
  for (const input of RECOGNIZED) {
    const id = linkedInJobId(new URL(input));
    assert.match(id, /^\d+$/, `id must be digits only, got ${JSON.stringify(id)}`);
    assert.equal(linkedInGuestUrl(id), `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}`);
    assert.equal(new URL(linkedInGuestUrl(id)).hostname, "www.linkedin.com");
  }
});

test("all three spellings of one posting resolve to the same id", () => {
  // This is what makes postingKey able to collapse them, and it is the property
  // normalizeUrl cannot supply on its own (it is host-agnostic by design).
  const ids = new Set(RECOGNIZED.map((u) => linkedInJobId(new URL(u))));
  assert.deepEqual([...ids], ["4434693435"]);
});

test("the canonical link is a real LinkedIn job page, not the guest endpoint", () => {
  // The rule the whole feature rests on: READ the mirror, RECORD the clickable
  // link. A tracker full of jobs-guest API links would be useless to click.
  const canonical = linkedInCanonicalUrl("4434693435");
  assert.equal(canonical, "https://www.linkedin.com/jobs/view/4434693435/");
  assert.doesNotMatch(canonical, /jobs-guest/);
  // ...and it round-trips: the canonical link parses back to the same id.
  assert.equal(linkedInJobId(new URL(canonical)), "4434693435");
});

test("linkedInCanonicalUrl is web-only and therefore NOT asserted against core", () => {
  // Stated as a test so the exemption is deliberate rather than an omission
  // someone later reads as a gap: the core only ever needs the API URL, so it
  // has no canonical-link builder for this to have parity with.
  assert.equal(typeof linkedInCanonicalUrl, "function");
  // Regex rather than .includes(): CodeQL reads a substring test against a URL
  // as an incomplete-sanitization check (js/incomplete-url-substring-sanitization).
  assert.match(coreResolve("https://www.linkedin.com/jobs/view/4434693435/").apiUrl, /jobs-guest/);
});
