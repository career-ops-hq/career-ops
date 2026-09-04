// Tests for normalizing a pasted job posting URL.
//
// The LinkedIn cases are the reason this module exists: linkedin.com/jobs/view/<id>
// served to a headless agent is an authwall, so an evaluation run against it produces
// a thin or invented report that still lands in the tracker looking legitimate. The
// public guest endpoint returns the real posting body, so we fetch that and record
// the canonical link.
//
// Run:  node --test tests/lib/job-url.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeJobUrl,
  parsePastedUrls,
  companyFromJobUrl,
  postingKey,
  domainIs,
  atsSourceFromHost,
} from "../../src/lib/job-url.mjs";
// Imported so postingKey's key can be asserted against the repo's ONE identity
// key rather than against a literal that would silently stop meaning anything if
// the core's canonicalization moved. Explore's canon() is not imported directly
// (explore-ai.ts is TypeScript, unloadable under bare `node --test`, which is why
// the mirrors are .mjs at all) — but canon() is a one-line `return normalizeUrl(u)`,
// so asserting against normalizeUrl asserts against canon.
import { normalizeUrl } from "../../src/lib/core/url-key.mjs";

test("normalizeJobUrl: a plain ATS posting passes through unchanged", () => {
  // Given a Greenhouse posting, which a headless agent can already read
  const r = normalizeJobUrl("https://boards.greenhouse.io/acme/jobs/4567890");

  // Then nothing is rewritten and the fetch target IS the canonical URL
  assert.equal(r.ok, true);
  assert.equal(r.kind, "generic");
  assert.equal(r.url, "https://boards.greenhouse.io/acme/jobs/4567890");
  assert.equal(r.fetchUrl, r.url);
});

test("normalizeJobUrl: a LinkedIn job view resolves to the guest endpoint", () => {
  // Given the URL shape the user actually copies from the address bar
  const r = normalizeJobUrl("https://www.linkedin.com/jobs/view/4434693435/");

  // Then we fetch the public mirror...
  assert.equal(r.ok, true);
  assert.equal(r.kind, "linkedin");
  assert.equal(r.fetchUrl, "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/4434693435");
  // ...and record the link the user can actually click later
  assert.equal(r.url, "https://www.linkedin.com/jobs/view/4434693435/");
});

test("normalizeJobUrl: LinkedIn slug-and-id and collection URLs both yield the id", () => {
  // Given the two other shapes LinkedIn hands out: a titled permalink...
  const slug = normalizeJobUrl("https://www.linkedin.com/jobs/view/senior-ai-engineer-at-acme-4434693435");
  // ...and the collections/search view, where the id is only in the query string
  const coll = normalizeJobUrl("https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4434693435");

  // Then both normalize to the same posting
  assert.equal(slug.fetchUrl, "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/4434693435");
  assert.equal(coll.fetchUrl, "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/4434693435");
  assert.equal(slug.url, coll.url);
});

test("normalizeJobUrl: a LinkedIn link with no job id is refused with advice", () => {
  // Given a LinkedIn page that is not one posting, evaluating it would score a
  // listings page. Refuse rather than fetch something meaningless.
  const r = normalizeJobUrl("https://www.linkedin.com/jobs/search/?keywords=ai");

  assert.equal(r.ok, false);
  assert.match(r.error, /single job posting/i);
});

test("normalizeJobUrl: a lookalike host is not treated as LinkedIn", () => {
  // Given the substring trap that sourceFromUrl already guards against
  const r = normalizeJobUrl("https://linkedin.com.evil.example/jobs/view/4434693435/");

  // Then it stays generic — no guest URL is minted for a host we do not trust
  assert.equal(r.ok, true);
  assert.equal(r.kind, "generic");
  assert.equal(r.fetchUrl, r.url);
});

test("normalizeJobUrl: tracking parameters are stripped, real ones kept", () => {
  // Given a link copied out of an email or a share sheet
  const r = normalizeJobUrl("https://jobs.lever.co/acme/abc-123?utm_source=newsletter&trk=public_jobs&gh_jid=99");

  // Then the noise is gone and a meaningful query parameter survives
  assert.equal(r.ok, true);
  assert.ok(!r.url.includes("utm_source"));
  assert.ok(!r.url.includes("trk="));
  assert.ok(r.url.includes("gh_jid=99"));
});

test("normalizeJobUrl: a bare host gets https, junk is refused", () => {
  // Given a paste with no scheme
  const bare = normalizeJobUrl("boards.greenhouse.io/acme/jobs/1");
  assert.equal(bare.ok, true);
  assert.equal(bare.url, "https://boards.greenhouse.io/acme/jobs/1");

  // Given inputs that are not http(s) postings at all
  for (const bad of ["javascript:alert(1)", "file:///etc/passwd", "ftp://x.example/j", "   ", "not a url", ""]) {
    assert.equal(normalizeJobUrl(bad).ok, false, bad);
  }
  // And a non-string, which the client can hand us from a stray state value
  assert.equal(normalizeJobUrl(undefined).ok, false);
});

test("normalizeJobUrl: trailing sentence punctuation from a pasted paragraph is stripped", () => {
  // Given a link copied out of the end of a sentence, period included
  const period = normalizeJobUrl("https://boards.greenhouse.io/acme/jobs/1.");
  assert.equal(period.ok, true);
  assert.equal(period.url, "https://boards.greenhouse.io/acme/jobs/1");

  // Given the same, but the sentence continues after the link with a comma
  const comma = normalizeJobUrl("https://boards.greenhouse.io/acme/jobs/1,");
  assert.equal(comma.ok, true);
  assert.equal(comma.url, "https://boards.greenhouse.io/acme/jobs/1");
});

test("normalizeJobUrl: a huge paste is refused before any per-character work", () => {
  // Given the input that made the old /[.,;!?]+$/ trailing-punctuation regex
  // quadratic: a long run of matching characters followed by one that fails the
  // anchor, so the engine restarts one position right and re-consumes the run
  // (CodeQL js/polynomial-redos). The scan is linear now, and the length bound
  // stops the work before it starts.
  const huge = `${"!".repeat(50_000)}x`;
  const started = Date.now();
  const r = normalizeJobUrl(huge);

  assert.equal(r.ok, false);
  assert.match(r.error, /too long/i);
  // Generous, so this asserts "not quadratic" rather than a machine speed. The
  // pre-fix regex on this input took orders of magnitude longer than this.
  assert.ok(Date.now() - started < 1000, "normalizing a huge paste must not scale quadratically");
});

test("normalizeJobUrl: a long-but-plausible URL is still accepted", () => {
  // Given the bound must reject abuse without rejecting a real posting URL, which
  // can carry a substantial query string
  const long = `https://boards.greenhouse.io/acme/jobs/1?ref=${"a".repeat(1000)}`;
  const r = normalizeJobUrl(long);

  assert.equal(r.ok, true);
  assert.equal(r.kind, "generic");
});

test("normalizeJobUrl: a URL wrapped in angle brackets is unwrapped", () => {
  // Given the Markdown/email convention of wrapping a bare link in <...>
  const r = normalizeJobUrl("<https://boards.greenhouse.io/acme/jobs/1>");

  assert.equal(r.ok, true);
  assert.equal(r.url, "https://boards.greenhouse.io/acme/jobs/1");
});

test("normalizeJobUrl: composed paste noise (wrapper AND trailing punctuation) is stripped", () => {
  // Given the most common Markdown/email paste shape: a link wrapped in <...> at
  // the end of a sentence. Neither strip alone resolves this: the "." has to go
  // before ">" is the last character for the wrapper check to see it.
  const angle = normalizeJobUrl("<https://boards.greenhouse.io/acme/jobs/1>.");
  assert.equal(angle.ok, true);
  assert.equal(angle.url, "https://boards.greenhouse.io/acme/jobs/1");

  // Given the parenthesized equivalent, with a comma continuing the sentence after
  const paren = normalizeJobUrl("(https://boards.greenhouse.io/acme/jobs/1),");
  assert.equal(paren.ok, true);
  assert.equal(paren.url, "https://boards.greenhouse.io/acme/jobs/1");
});

test("normalizeJobUrl: a URL ending in a real trailing slash is left alone", () => {
  // Given a posting whose path itself legitimately ends in "/" — must NOT be
  // treated as paste noise the way a trailing "." or "," is
  const r = normalizeJobUrl("https://boards.greenhouse.io/acme/jobs/1/");

  assert.equal(r.ok, true);
  assert.equal(r.url, "https://boards.greenhouse.io/acme/jobs/1/");
});

test("parsePastedUrls: splits on whitespace and reports bad lines individually", () => {
  // Given a multi-line paste where one line is broken
  const text = `https://boards.greenhouse.io/acme/jobs/1
  not-a-url-at-all::
https://www.linkedin.com/jobs/view/4434693435/`;

  const { entries, errors } = parsePastedUrls(text);

  // Then the good ones still run and the bad one is named, not silently dropped
  assert.equal(entries.length, 2);
  assert.equal(entries[1].kind, "linkedin");
  assert.equal(errors.length, 1);
  assert.match(errors[0].raw, /not-a-url-at-all/);
});

test("parsePastedUrls: the same posting pasted twice is kept once", () => {
  // Given a duplicate paste, deduped on the CANONICAL url so the two LinkedIn
  // spellings of one job collapse together
  const { entries } = parsePastedUrls(
    "https://www.linkedin.com/jobs/view/4434693435/ https://www.linkedin.com/jobs/view/senior-ai-engineer-at-acme-4434693435",
  );

  assert.equal(entries.length, 1);
});

test("companyFromJobUrl: derives the company from an ATS slug, else the host", () => {
  // Given the three ATS shapes whose URL carries the company
  assert.equal(companyFromJobUrl("https://boards.greenhouse.io/acme/jobs/1"), "acme");
  assert.equal(companyFromJobUrl("https://jobs.lever.co/stripe-inc/abc"), "stripe-inc");
  assert.equal(companyFromJobUrl("https://jobs.ashbyhq.com/ramp/xyz"), "ramp");
  // Given a host that carries no company slug, fall back to the registrable name
  assert.equal(companyFromJobUrl("https://careers.example.com/jobs/1"), "example");
  // Given LinkedIn, the company is simply not in the URL — say nothing rather than guess
  assert.equal(companyFromJobUrl("https://www.linkedin.com/jobs/view/4434693435/"), "");
});

test("domainIs: anchored at a dot boundary, not a bare substring", () => {
  // Given the real host and a lookalike that merely contains it
  assert.equal(domainIs("boards.greenhouse.io", "greenhouse.io"), true);
  assert.equal(domainIs("greenhouse.io", "greenhouse.io"), true);
  assert.equal(domainIs("greenhouse.io.evil.example", "greenhouse.io"), false);
  assert.equal(domainIs("notgreenhouse.io", "greenhouse.io"), false);
});

test("atsSourceFromHost: recognizes every ATS host sourceFromUrl (inbox.ts) relies on", () => {
  // Given each ATS's real host, including Workday's two live spellings
  assert.equal(atsSourceFromHost("boards.greenhouse.io"), "greenhouse");
  assert.equal(atsSourceFromHost("jobs.lever.co"), "lever");
  assert.equal(atsSourceFromHost("jobs.ashbyhq.com"), "ashby");
  assert.equal(atsSourceFromHost("acme.myworkdayjobs.com"), "workday");
  assert.equal(atsSourceFromHost("acme.workday.com"), "workday");
  // Given a host on no ATS at all
  assert.equal(atsSourceFromHost("careers.example.com"), null);
});

test("postingKey: the url-key identity for a normalizable posting, LinkedIn included", () => {
  // Given a plain ATS link, the key is normalizeUrl's key for it — note the
  // trailing slash is gone, because url-key.mjs owns this shape now, not this
  // module. Asserted against normalizeUrl itself rather than a literal, so this
  // stays true if the core's canonicalization changes and the mirror follows.
  const gh = "https://boards.greenhouse.io/acme/jobs/4567890";
  assert.equal(postingKey(gh), normalizeUrl(gh));

  // Given two different LinkedIn spellings of the same job, both collapse to the
  // same key, which is the whole point: this is the identity a caller dedupes on
  assert.equal(
    postingKey("https://www.linkedin.com/jobs/view/senior-ai-engineer-at-acme-4434693435"),
    "https://www.linkedin.com/jobs/view/4434693435",
  );
  assert.equal(
    postingKey("https://www.linkedin.com/jobs/view/4434693435/"),
    postingKey("https://www.linkedin.com/jobs/view/senior-ai-engineer-at-acme-4434693435"),
  );
  // ...including the collection/search spelling, which carries the id only in the
  // query string and which normalizeUrl alone would key as a different posting
  assert.equal(
    postingKey("https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4434693435"),
    postingKey("https://www.linkedin.com/jobs/view/4434693435/"),
  );
});

test("postingKey agrees with explore's key on a posting neither has to special-case", () => {
  // The reason postingKey routes through normalizeUrl at all. TodayDashboard asks
  // "is this discovered offer already in my pipeline?" with postingKey; Explore
  // asks "have I seen this offer?" with canon(), which is normalizeUrl. A second
  // key body here meant the same posting could answer differently on two screens
  // showing the same card.
  for (const url of [
    "https://boards.greenhouse.io/acme/jobs/apply?gh_jid=4471829005&utm_source=li",
    "https://jobs.lever.co/acme/9f2c1e10-0000-4a3b-9c1d-1a2b3c4d5e6f",
    "http://Boards.Greenhouse.io/acme/jobs/apply/",
  ]) {
    assert.equal(postingKey(url), normalizeUrl(url), `postingKey and Explore disagree on ${url}`);
  }
});

test("postingKey: hands back the input unchanged when it does not parse, never throws", () => {
  // Given strings normalizeJobUrl refuses, postingKey must not throw and must not
  // return undefined, since callers use this as a Map/Set key with no null check
  assert.equal(postingKey("not a url"), "not a url");
  assert.equal(postingKey(""), "");
  assert.doesNotThrow(() => postingKey("javascript:alert(1)"));
});

test("postingKey is idempotent, because two call sites double-apply it", () => {
  // registry.ts's evaluate action passes postingKey(url) into ctx.jobForUrl,
  // which postingKeys the needle again before comparing. That was invisibly safe
  // while postingKey returned normalizeJobUrl's own output; now that it returns
  // a url-key (no trailing slash, sorted params) the round trip has to be pinned,
  // or a double-applied key stops matching a single-applied one and the duplicate
  // -spend guard silently re-fires an evaluation the user already paid for.
  for (const url of [
    "https://www.linkedin.com/jobs/view/4434693435/",
    "https://www.linkedin.com/jobs/view/senior-ai-engineer-at-acme-4434693435",
    "https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4434693435",
    "https://boards.greenhouse.io/acme/jobs/apply?location=paris&gh_jid=4471829005",
    "http://Boards.Greenhouse.io/acme/jobs/apply/",
    "not a url",
    "",
  ]) {
    const once = postingKey(url);
    assert.equal(postingKey(once), once, `postingKey is not idempotent on ${JSON.stringify(url)}`);
  }
});

test("postingKey never returns normalizeUrl's '' NO KEY sentinel", () => {
  // normalizeUrl's own header: '' means NO KEY and must never match another ''.
  // A Set membership test cannot honor that, so postingKey has to hand back
  // something distinct instead. Two different unrecognizable inputs must stay
  // two different keys.
  const a = postingKey("not a url");
  const b = postingKey("also not a url");
  assert.notEqual(a, "");
  assert.notEqual(b, "");
  assert.notEqual(a, b, "two unparseable inputs collapsed onto one key");
});
