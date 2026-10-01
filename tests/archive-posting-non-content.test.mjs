// tests/archive-posting-non-content.test.mjs — archiveUrl() refuses to save a
// non-content capture (login wall / 404 shell / paywall / JS-required /
// bot-challenge) rather than silently reporting success (#4526) — while a
// real, long posting that merely CARRIES one of those phrases incidentally
// (a sidebar sign-in nudge next to a full JD) is still archived normally,
// since the marker check is gated on the page being short overall.
//
// check-jd-archive.mjs's detectNonContentMarker() already recognizes these
// shapes, but only at AUDIT time — well after a bad capture is already sitting
// in jds/. This exercises the REAL archiveUrl() (no mocking of the detection
// logic itself), driven through a fake Playwright browser/context/page rather
// than a real one: archive-posting.mjs has no dedicated test suite of its own
// anywhere in this repo, precisely because it does real network navigation
// through a real headless browser, and a unit test that launched Chromium
// against a live URL would be flaky, slow, and network-dependent for no
// benefit. The fake page satisfies exactly the Playwright surface
// archiveUrl() calls (goto/url/title/$eval/waitForTimeout/evaluate/pdf) so the
// REAL function logic runs end to end; only the browser layer underneath it
// is faked. CAREER_OPS_ROOT is set to a temp dir BEFORE import, so JDS_DIR
// resolves there instead of the real project's jds/.
//
// Run:  node --test tests/archive-posting-non-content.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'career-ops-archive-nc-'));
process.env.CAREER_OPS_ROOT = tmp;

const { archiveUrl } = await import('../archive-posting.mjs');

function makeFakeBrowser({ bodyText, title = 'Backend Engineer | Acme', h1 = 'Backend Engineer', httpStatus = 200, evaluateRejects = false }) {
  let pdfCalled = false;
  const page = {
    _landedUrl: null,
    async goto(url) { page._landedUrl = url; return { status: () => httpStatus }; },
    url() { return page._landedUrl; },
    async waitForTimeout() {},
    async title() { return title; },
    async $eval(selector) {
      if (selector !== 'h1') throw new Error(`fake page has no selector ${selector}`);
      if (h1 == null) throw new Error('no h1 in fixture');
      return h1;
    },
    // Real Playwright serializes and runs the passed function IN the page.
    // The fake can't execute page-context code, so it just returns the
    // controlled fixture text — testing archiveUrl()'s reaction to the
    // extracted text is the point here, not Playwright's own extraction.
    // evaluateRejects simulates a real extraction failure (the page
    // navigating away, a detached frame, etc.) so the test exercises
    // archiveUrl()'s actual `.catch(() => '')` fallback, not just a fixture
    // that happens to already be an empty string.
    async evaluate() {
      if (evaluateRejects) throw new Error('fake: page.evaluate() failed (simulated extraction failure)');
      return bodyText;
    },
    async pdf() { pdfCalled = true; return Buffer.from('%PDF-fake'); },
  };
  const context = {
    async newPage() { return page; },
    async close() {},
    // installEgressGuard() registers a route handler on every real Playwright
    // context; the fake only needs to accept the call, since the guard's own
    // logic (rejectPrivateOrInvalid / validateUrlSecurity) is exercised on the
    // real navigation URL passed to archiveUrl(), not through this handler.
    async route() {},
  };
  const browser = { async newContext() { return context; } };
  return { browser, pdfCalled: () => pdfCalled };
}

const jdsFiles = () => (existsSync(join(tmp, 'jds')) ? readdirSync(join(tmp, 'jds')) : []);

test('a login-wall page is refused, not archived', async () => {
  const { browser, pdfCalled } = makeFakeBrowser({ bodyText: 'Sign in to view this job. Join LinkedIn to see who you know at Acme.' });
  await assert.rejects(
    () => archiveUrl(browser, 'https://boards.greenhouse.io/acme/jobs/1', {}),
    /refusing to archive.*sign-in\/login wall/i,
  );
  assert.equal(pdfCalled(), false, 'a login-wall page must never reach page.pdf()');
  assert.deepEqual(jdsFiles(), [], 'nothing was written to jds/');
});

test('a 404 shell is refused, not archived', async () => {
  const { browser, pdfCalled } = makeFakeBrowser({ bodyText: '404 Not Found — this job posting is no longer available.' });
  await assert.rejects(
    () => archiveUrl(browser, 'https://boards.greenhouse.io/acme/jobs/2', {}),
    /refusing to archive.*404/i,
  );
  assert.equal(pdfCalled(), false);
});

test('a real posting is archived normally (control)', async () => {
  const { browser, pdfCalled } = makeFakeBrowser({
    bodyText: 'We are looking for a Senior Backend Engineer to join our platform team and own the checkout service end to end. Requirements: 5+ years experience.',
  });
  const result = await archiveUrl(browser, 'https://boards.greenhouse.io/acme/jobs/3', {});
  assert.equal(pdfCalled(), true, 'a real posting must still be captured');
  assert.match(result.filename, /\.pdf$/);
  assert.ok(jdsFiles().includes(result.filename), 'the file was actually written to jds/');
});

test('a real extraction FAILURE (page.evaluate rejects) fails CLOSED — refuses to archive blind', async () => {
  // Fail closed, not open: a rejected evaluate() means the page's actual
  // content is UNKNOWN, not confirmed empty. Coercing that to '' (as an
  // earlier version of this code did) let a page that genuinely couldn't be
  // inspected reach page.pdf() anyway — the exact capture-time gap this
  // whole check exists to close. The error must propagate.
  const { browser, pdfCalled } = makeFakeBrowser({ bodyText: 'unused — evaluate() rejects before returning it', evaluateRejects: true });
  await assert.rejects(
    () => archiveUrl(browser, 'https://boards.greenhouse.io/acme/jobs/4', {}),
    /page\.evaluate\(\) failed/,
  );
  assert.equal(pdfCalled(), false, 'an extraction failure must not reach page.pdf()');
});

test('a bot-challenge (Cloudflare-style) page is refused, not archived', async () => {
  const { browser, pdfCalled } = makeFakeBrowser({ bodyText: 'Checking your browser before accessing acme.com. This process is automatic. Cloudflare Ray ID: 8f2a1b3c4d5e' });
  await assert.rejects(
    () => archiveUrl(browser, 'https://boards.greenhouse.io/acme/jobs/5', {}),
    /refusing to archive.*bot-verification\/challenge/i,
  );
  assert.equal(pdfCalled(), false);
});

test('a bot-challenge page phrased "Verify that you are human" is refused, not archived', async () => {
  // Regression for the "that"-less bot-challenge regex: a real, common
  // Cloudflare-style challenge phrasing inserts "that" between "verify" and
  // "you are human" ("Verify that you are human"), which the original
  // verify(?:ing)? you are (?:a )?human branch did not match.
  const { browser, pdfCalled } = makeFakeBrowser({ bodyText: 'Verify that you are human by completing the action below.' });
  await assert.rejects(
    () => archiveUrl(browser, 'https://boards.greenhouse.io/acme/jobs/7', {}),
    /refusing to archive.*bot-verification\/challenge/i,
  );
  assert.equal(pdfCalled(), false, 'a "Verify that you are human" challenge page must never reach page.pdf()');
});

test('a bot-challenge page phrased "CAPTCHA verification required to continue" is refused, not archived', async () => {
  // A second real challenge phrasing that names the CAPTCHA mechanism
  // directly, matched on the specific phrase (not the bare word "captcha")
  // so a real posting that merely mentions CAPTCHA as a technology (a
  // security-engineering role's requirements, say) is never mistaken for one.
  const { browser, pdfCalled } = makeFakeBrowser({ bodyText: 'CAPTCHA verification required to continue.' });
  await assert.rejects(
    () => archiveUrl(browser, 'https://boards.greenhouse.io/acme/jobs/8', {}),
    /refusing to archive.*bot-verification\/challenge/i,
  );
  assert.equal(pdfCalled(), false, 'a CAPTCHA-challenge page must never reach page.pdf()');
});

test('a real posting mentioning CAPTCHA as a technology is NOT mistaken for a challenge page (false-positive guard)', async () => {
  // Deliberately kept SHORT (<= NON_CONTENT_PAGE_MAX_CHARS) so this actually
  // exercises detectNonContentMarker()'s own regex specificity — a longer
  // fixture would pass only because it skips the marker check entirely via
  // the length gate, proving nothing about the regex itself. The separate
  // "mixed content" test below covers the length-gate behavior.
  const shortJd = 'Requirements: experience implementing CAPTCHA verification for login flows.';
  assert.ok(shortJd.length <= 600, 'fixture must stay short enough to exercise the marker regex, not the length gate');
  const { browser, pdfCalled } = makeFakeBrowser({ bodyText: shortJd });
  await archiveUrl(browser, 'https://boards.greenhouse.io/acme/jobs/9', {});
  assert.equal(pdfCalled(), true, 'a real JD mentioning CAPTCHA as a topic must not be refused');
});

test('a real posting that ALSO carries an incidental "sign in" prompt is still archived (mixed content)', async () => {
  // The marker check is length-gated specifically so a real, long JD with a
  // small sidebar/footer sign-in nudge next to it doesn't get refused — only
  // a page that IS essentially the wall (short, all-marker) should be.
  const longJd = 'We are looking for a Senior Backend Engineer to join our platform team and own the checkout service end to end. '
    + 'Requirements: 5+ years of experience with distributed systems, strong knowledge of payment processing, and a track record of shipping reliable services at scale. '
    + 'You will collaborate with product, design, and other engineering teams to define and deliver features that directly impact millions of customers every day. '
    + 'We offer competitive compensation, comprehensive benefits, and a hybrid work environment. Apply today to join our growing team. '.repeat(3);
  const bodyText = `${longJd}\n\nSign in to view this job.`;
  assert.ok(bodyText.length > 600, 'fixture must actually exercise the long-page path, not accidentally stay short');
  const { browser, pdfCalled } = makeFakeBrowser({ bodyText });
  const result = await archiveUrl(browser, 'https://boards.greenhouse.io/acme/jobs/6', {});
  assert.equal(pdfCalled(), true, 'a real, long posting must not be refused just because it incidentally carries a sign-in prompt');
  assert.match(result.filename, /\.pdf$/);
});

process.on('exit', () => rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }));
