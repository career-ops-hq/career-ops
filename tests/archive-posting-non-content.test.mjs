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

function makeFakeBrowser({ bodyText, title = 'Backend Engineer | Acme', h1 = 'Backend Engineer', httpStatus = 200, evaluateRejects = false, hydrateUrl = null, hydrateNavigation = false, pdfUrl = null, hydrateEvents = [], pdfEvents = [] }) {
  let pdfCalled = false;
  const handlers = new Map();
  const frame = {};
  const subframe = {};
  // Playwright emits request for an actual document request; same-document
  // history changes may emit framenavigated without another document request.
  const emit = kind => {
    if (kind === 'frame-main') return handlers.get('framenavigated')?.(frame);
    handlers.get('request')?.({
      isNavigationRequest() { if (kind === 'request-unknown-type') throw new Error('uninspectable request type'); return kind !== 'request-resource'; },
      frame() {
        if (['request-resource', 'request-unknown-frame'].includes(kind)) throw new Error('request frame unavailable');
        return kind === 'request-subframe' ? subframe : frame;
      },
    });
  };
  const page = {
    on(event, handler) { handlers.set(event, handler); },
    mainFrame() { return frame; },
    _landedUrl: null,
    async goto(url) { page._landedUrl = url; emit('request-main'); emit('frame-main'); return { status: () => httpStatus }; },
    url() { return page._landedUrl; },
    async waitForTimeout() {
      if (hydrateUrl) page._landedUrl = hydrateUrl;
      if (hydrateNavigation) { emit('request-main'); emit('frame-main'); }
      hydrateEvents.forEach(emit);
    },
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
    // navigating away, a detached frame, etc.) so the test verifies that
    // archiveUrl() fails closed instead of archiving uninspected content.
    async evaluate() {
      if (evaluateRejects) throw new Error('fake: page.evaluate() failed (simulated extraction failure)');
      return bodyText;
    },
    async pdf() { pdfCalled = true; if (pdfUrl) page._landedUrl = pdfUrl; pdfEvents.forEach(emit); return Buffer.from('%PDF-fake'); },
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

test('an empty rendered page is refused before metadata fallbacks can archive it', async () => {
  const { browser, pdfCalled } = makeFakeBrowser({ bodyText: '   \n\t  ' });
  await assert.rejects(
    () => archiveUrl(browser, 'https://boards.greenhouse.io/acme/jobs/empty', {}),
    /refusing to archive.*no visible text/i,
  );
  assert.equal(pdfCalled(), false, 'an empty page must never reach page.pdf()');
});

test('an HTTP 404 with an unrecognized shell is refused before PDF generation', async () => {
  const { browser, pdfCalled } = makeFakeBrowser({
    bodyText: 'This page is unavailable.',
    httpStatus: 404,
  });
  await assert.rejects(
    () => archiveUrl(browser, 'https://boards.greenhouse.io/acme/jobs/missing', {}),
    /refusing to archive.*HTTP 404/i,
  );
  assert.equal(pdfCalled(), false, 'an unrecognized 404 shell must never reach page.pdf()');
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

// A live Cloudflare managed challenge (#6713): HTTP 403, title "Just a
// moment...", and a site-branded body that is longer than
// NON_CONTENT_PAGE_MAX_CHARS and carries none of the challenge phrases, so the
// body check never fires. The rendered title is what identifies it. Text is a
// real employer-site interstitial with the ray id, IP and token removed.
const CHALLENGE_BODY = 'Humans only\n\n'
  + 'Acme has been built on the contributions of real employees and job seekers. We use advanced security systems to keep our site safe and prevent misuse or unauthorized access.\n\n'
  + 'In rare cases, security protections may mistakenly block legitimate activity from real users. If you have been mistakenly blocked from accessing our site, please review our Help Center article for troubleshooting steps.\n\n'
  + 'Ray ID: 0000000000000000\nTimestamp: 2026-11-09T04:11:42.866Z\nYour IP address: 192.0.2.1\nCloudflare Location: XX\n'
  + 'Requested URL: https://careers.acme.example/jobs/7?__cf_chl_rt_tk=redacted-token-redacted-token-redacted-token-redacted-token-redacted-token-redacted-token-redacted-token-redacted-token-redacted-token';

test('a Cloudflare challenge page ("Just a moment...", HTTP 403) is refused even when its body is long', async () => {
  assert.ok(CHALLENGE_BODY.length > 600, 'fixture must take the long-page path that skips the body markers');
  const { browser, pdfCalled } = makeFakeBrowser({ bodyText: CHALLENGE_BODY, title: 'Just a moment...', h1: 'Humans only', httpStatus: 403 });
  await assert.rejects(
    () => archiveUrl(browser, 'https://careers.acme.example/jobs/7', {}),
    /refusing to archive: HTTP 403 Cloudflare challenge page/i,
  );
  assert.equal(pdfCalled(), false, 'a challenge page must never reach page.pdf()');
});

test('a Cloudflare block page ("Attention Required! | Cloudflare", HTTP 403) is refused', async () => {
  const { browser, pdfCalled } = makeFakeBrowser({
    bodyText: 'Sorry, you have been blocked. You are unable to access careers.acme.example.',
    title: 'Attention Required! | Cloudflare',
    h1: 'Sorry, you have been blocked',
    httpStatus: 403,
  });
  await assert.rejects(
    () => archiveUrl(browser, 'https://careers.acme.example/jobs/8', {}),
    /refusing to archive: HTTP 403 Cloudflare/i,
  );
  assert.equal(pdfCalled(), false);
});

test('a 403 whose challenge solved and rendered the posting is still archived', async () => {
  // The first response is the challenge, but the browser passed it and the
  // page that settled is the real posting, so its title is the posting's.
  const bodyText = 'We are looking for a Senior Backend Engineer to join our platform team and own the checkout service end to end. Requirements: 5+ years experience.';
  const { browser, pdfCalled } = makeFakeBrowser({ bodyText, httpStatus: 403 });
  const result = await archiveUrl(browser, 'https://careers.acme.example/jobs/9', {});
  assert.equal(pdfCalled(), true);
  assert.match(result.filename, /\.pdf$/);
});

test('a 200 page titled "Just a moment..." is not treated as a challenge', async () => {
  // Cloudflare serves its interstitial with a 403 or 503. A site whose own
  // loading title is "Just a moment..." on a 200 keeps the existing checks.
  const bodyText = 'We are looking for a Senior Backend Engineer to join our platform team and own the checkout service end to end. Requirements: 5+ years experience.';
  const { browser, pdfCalled } = makeFakeBrowser({ bodyText, title: 'Just a moment...', httpStatus: 200 });
  await archiveUrl(browser, 'https://careers.acme.example/jobs/10', { company: 'Acme', role: 'backend-engineer' });
  assert.equal(pdfCalled(), true);
});

process.on('exit', () => rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }));

test('trusted capture identity guard receives settled status and rejects before PDF', async () => {
  const { browser, pdfCalled } = makeFakeBrowser({ bodyText: 'A long generic company page. '.repeat(50), httpStatus: 403 });
  let observed;
  await assert.rejects(() => archiveUrl(browser, 'https://boards.greenhouse.io/acme/jobs/101', {
    company: 'Expected company', role: 'Expected role', report: '061', directory: join(tmp, 'private-061'), log() {},
    requirePosting(evidence) { observed = evidence; return evidence.httpStatus === 200; },
  }), /not the exact substantive posting/);
  assert.equal(observed.httpStatus, 403);
  assert.equal(observed.settledUrl, 'https://boards.greenhouse.io/acme/jobs/101');
  assert.equal(pdfCalled(), false);
  assert.equal(existsSync(join(tmp, 'private-061')), false);
});

test('per-call reserved number/private capture directory and typed receipt stay local', async () => {
  const { browser } = makeFakeBrowser({ bodyText: 'Backend Engineer owns service reliability and delivery. '.repeat(30) });
  const dir = join(tmp, 'private-062');
  const result = await archiveUrl(browser, 'https://boards.greenhouse.io/acme/jobs/102', {
    company: 'Acme', role: 'Backend Engineer', report: '062', directory: dir, log() {},
    requirePosting: evidence => evidence.httpStatus === 200 && evidence.title.includes('Backend Engineer'),
  });
  assert.match(result.filename, /^062-/);
  assert.equal(existsSync(join(dir, result.filename)), true);
  assert.equal(result.httpStatus, 200);
  assert.equal(result.settledUrl, 'https://boards.greenhouse.io/acme/jobs/102');
});


for (const [name, changes] of [
  ['hydration redirect', { hydrateUrl: 'https://boards.greenhouse.io/acme/' }],
  ['same-URL replacement document', { hydrateNavigation: true }],
  ['navigation during PDF creation', { pdfUrl: 'https://boards.greenhouse.io/acme/' }],
]) test(`trusted exact capture refuses ${name} instead of attesting the original HTTP status`, async () => {
  const dir = join(tmp, `private-navigation-${name.replace(/[^a-z]/g, '-')}`);
  const { browser } = makeFakeBrowser({ bodyText: 'Backend Engineer owns reliable service delivery and requirements. '.repeat(20), ...changes });
  await assert.rejects(() => archiveUrl(browser, 'https://boards.greenhouse.io/acme/jobs/103', {
    report: '063', directory: dir, log() {}, requirePosting: e => e.httpStatus === 200,
  }), /document navigated/);
  assert.equal(existsSync(dir), false, 'a different document must not create a capture');
});

for (const [name, changes] of [
  ['same-URL history events after HTTP200', { hydrateEvents: ['frame-main', 'frame-main'] }],
  ['same-URL history event during PDF', { pdfEvents: ['frame-main'] }],
  ['subframe navigation and resource requests', { hydrateEvents: ['request-subframe', 'request-resource'] }],
]) test(`trusted exact capture allows ${name} without inventing a new document`, async () => {
  const dir = join(tmp, `same-document-${name.replace(/[^a-z]/g, '-')}`);
  const { browser, pdfCalled } = makeFakeBrowser({ bodyText: 'Backend Engineer owns service reliability and delivery. '.repeat(30), ...changes });
  const result = await archiveUrl(browser, 'https://boards.greenhouse.io/acme/jobs/104', {
    report: '064', directory: dir, log() {}, requirePosting: e => e.httpStatus === 200,
  });
  assert.equal(pdfCalled(), true); assert.equal(result.httpStatus, 200);
  assert.equal(result.settledUrl, 'https://boards.greenhouse.io/acme/jobs/104');
  assert.equal(existsSync(join(dir, result.filename)), true);
});

for (const [name, changes] of [
  ['same-URL document request before its frame event', { hydrateEvents: ['request-main'] }],
  ['same-URL document request during PDF', { pdfEvents: ['request-main'] }],
  ['navigation request with an uninspectable frame', { hydrateEvents: ['request-unknown-frame'] }],
  ['request with an uninspectable navigation type', { hydrateEvents: ['request-unknown-type'] }],
]) test(`trusted exact capture refuses ${name}`, async () => {
  const dir = join(tmp, `new-document-${name.replace(/[^a-z]/g, '-')}`);
  const { browser } = makeFakeBrowser({ bodyText: 'Backend Engineer owns service reliability and delivery. '.repeat(30), ...changes });
  await assert.rejects(() => archiveUrl(browser, 'https://boards.greenhouse.io/acme/jobs/105', {
    report: '065', directory: dir, log() {}, requirePosting: e => e.httpStatus === 200,
  }), /document navigated|cannot inspect.*navigation/);
  assert.equal(existsSync(dir), false, 'no unproved capture is written');
});

test('legacy capture keeps its manual behavior but cannot attest an old HTTP status after a new document request', async () => {
  const { browser } = makeFakeBrowser({ bodyText: 'Backend Engineer owns service reliability and delivery. '.repeat(30), hydrateEvents: ['request-main'] });
  const result = await archiveUrl(browser, 'https://boards.greenhouse.io/acme/jobs/106', { directory: join(tmp, 'legacy-document'), log() {} });
  assert.equal(result.httpStatus, null);
});
