// tests/liveness-core.test.mjs — classifyLiveness must treat the "filled"
// phrasing SPA ATSs inject (Phenom, e.g. careers.icf.com) as expired.
//
// Regression for the false-active reported on careers.icf.com: Phenom-hosted
// career pages return HTTP 200 with a generic "Apply" control in the shell,
// while the true status — "the job you are trying to apply for has been
// filled" — is rendered into the main content. The old HARD_EXPIRED pattern
// was /position has been filled/, which does not match that phrasing, so the
// generic apply control won and the posting was classified active. The
// generalized pattern requires any job noun within 60 chars of "has been
// filled" and rejects "filled out" (a candidate completing a form).
import { pass, fail } from './helpers.mjs';
import { classifyLiveness } from '../liveness-core.mjs';

console.log('\nliveness-core — "filled" reqs (incl. Phenom/ICF phrasing) classify as expired');

const expired = (bodyText, applyControls = ['Apply']) =>
  classifyLiveness({ status: 200, finalUrl: 'https://careers.example.com/job/123', bodyText, applyControls }).result;

// The reported bug: Phenom/ICF phrasing, HTTP 200, with a generic Apply control.
expired('We’re sorry… the job you are trying to apply for has been filled. Apply')
  === 'expired'
  ? pass('Phenom/ICF "the job ... has been filled" -> expired (was: active)')
  : fail('Phenom/ICF "the job ... has been filled" NOT classified expired');

// Regression: the original phrasing still classifies as expired.
expired('This position has been filled. Apply') === 'expired'
  ? pass('"position has been filled" still -> expired')
  : fail('"position has been filled" regressed');

// Regression: a genuinely active posting is NOT swept up by the new pattern.
classifyLiveness({
  status: 200,
  finalUrl: 'https://boards.greenhouse.io/acme/jobs/123',
  bodyText: 'Senior Program Manager. You will own the enterprise AI roadmap and lead delivery across teams. Apply now.',
  applyControls: ['Apply now'],
}).result === 'active'
  ? pass('active posting with an apply control stays active')
  : fail('new pattern over-triggered on an active posting');

// False-positive guard: "has been filled out" (a form) must NOT read as expired.
classifyLiveness({
  status: 200,
  finalUrl: 'https://careers.example.com/job/123',
  bodyText: 'Once the job application form has been filled out, submit it below. Apply',
  applyControls: ['Apply'],
}).result !== 'expired'
  ? pass('"job application form has been filled out" is NOT expired (form, not req)')
  : fail('false positive: "filled out" (a form) read as an expired req');

// False-positive guard (no "out"): "application form has been filled" must NOT
// read as expired — "job" satisfies the noun but the thing filled is the form,
// not the req. Reading a live posting as expired is the worse error.
classifyLiveness({
  status: 200,
  finalUrl: 'https://careers.example.com/job/123',
  bodyText: 'Please confirm the job application form has been filled and accurate before submitting. Apply',
  applyControls: ['Apply'],
}).result !== 'expired'
  ? pass('"job application form has been filled" (no "out") is NOT expired')
  : fail('false positive: "application form has been filled" read as an expired req');

console.log('\nliveness-core — transient 5xx must not classify as expired');

// Regression: a 502 with a typical short gateway body used to fall through to
// the insufficient-content heuristic and read as expired, which dedup-blocks
// the posting from every future scan. Any 5xx is transient, never "gone".
for (const status of [500, 502, 504]) {
  const verdict = classifyLiveness({
    status,
    requestedUrl: 'https://careers.example.com/job/123',
    finalUrl: 'https://careers.example.com/job/123',
    bodyText: `${status} Bad Gateway\nnginx`,
    applyControls: [],
  });
  verdict.result === 'uncertain' && verdict.code === 'server_error'
    ? pass(`HTTP ${status} -> uncertain/server_error (was: expired via insufficient_content)`)
    : fail(`HTTP ${status} classified ${verdict.result}/${verdict.code}, expected uncertain/server_error`);
}

// 503 keeps its more specific access-blocked classification: the 5xx guard
// sits below it, so both halves of the verdict must hold, not just the code.
const blocked = classifyLiveness({ status: 503, finalUrl: 'https://careers.example.com/job/123', bodyText: 'checking your browser', applyControls: [] });
blocked.result === 'uncertain' && blocked.code === 'access_blocked'
  ? pass('HTTP 503 still classifies as uncertain/access_blocked, not server_error')
  : fail(`HTTP 503 classified ${blocked.result}/${blocked.code}, expected uncertain/access_blocked`);

// 429 is throttling, never evidence the posting is gone. Its body is a short
// "Too Many Requests" — under MIN_CONTENT_CHARS — so before the guard covered it
// the verdict fell through to insufficient_content and read as `expired`, which
// scan-history records as skipped_expired and every later scan dedup-skips.
const throttled = classifyLiveness({
  status: 429,
  requestedUrl: 'https://boards.greenhouse.io/acme/jobs/1234567',
  finalUrl: 'https://boards.greenhouse.io/acme/jobs/1234567',
  bodyText: 'Too Many Requests. Please retry after some time.',
  applyControls: [],
});
throttled.result === 'uncertain' && throttled.code === 'access_blocked'
  ? pass('HTTP 429 classifies as uncertain/access_blocked, not expired')
  : fail(`HTTP 429 classified ${throttled.result}/${throttled.code}, expected uncertain/access_blocked`);

// A real 404/410 is still authoritative expiry — both statuses, both halves.
for (const status of [404, 410]) {
  const gone = classifyLiveness({
    status,
    finalUrl: 'https://careers.example.com/job/123',
    bodyText: 'Not found',
    applyControls: [],
  });
  gone.result === 'expired' && gone.code === 'http_gone'
    ? pass(`HTTP ${status} still -> expired/http_gone`)
    : fail(`HTTP ${status} classified ${gone.result}/${gone.code}, expected expired/http_gone`);
}

console.log('\nliveness-core — Chinese application controls classify active postings');

const chineseApply = classifyLiveness({
  status: 200,
  requestedUrl: 'https://careers.example.com/job/1234567',
  finalUrl: 'https://careers.example.com/job/1234567',
  bodyText: '岗位职责：负责模型研发、系统优化和跨团队协作。'.repeat(20),
  applyControls: ['申请职位'],
});
chineseApply.result === 'active' && chineseApply.code === 'apply_control_visible'
  ? pass('“申请职位” marks an otherwise valid Chinese posting active')
  : fail(`“申请职位” classified ${chineseApply.result}/${chineseApply.code}, expected active/apply_control_visible`);

const chineseSubmit = classifyLiveness({
  status: 200,
  requestedUrl: 'https://careers.example.com/job/7657115156241418501',
  finalUrl: 'https://careers.example.com/job/7657115156241418501',
  bodyText: '职位描述：负责安全系统、检测算法和工程平台建设。'.repeat(20),
  applyControls: ['投递'],
});
chineseSubmit.result === 'active' && chineseSubmit.code === 'apply_control_visible'
  ? pass('exact “投递” button marks a Feishu posting active')
  : fail(`exact “投递” button classified ${chineseSubmit.result}/${chineseSubmit.code}, expected active/apply_control_visible`);

console.log('\nliveness-core — role/position "is closed" and bare "Job Expired" banners classify as expired');

// Reported on agentic-engineering-jobs.com (111 of 111 uncertain postings
// contain this exact phrase). Old pattern was /this job (listing )?is closed/i,
// which hardcoded the noun "job"; "role" fell through to no_apply_control ->
// uncertain, and uncertain postings never filter out of future scans, so a
// dead board stayed live in scan-history forever.
expired('We are sorry, this role is closed. Please check our other openings.') === 'expired'
  ? pass('"This role is closed" -> expired (was: uncertain/no_apply_control)')
  : fail('"This role is closed" NOT classified expired');

// Same widening covers "position", per the reporter's suggested regex.
expired('We are sorry, this position is closed. Please check our other openings.') === 'expired'
  ? pass('"This position is closed" -> expired')
  : fail('"This position is closed" NOT classified expired');

// Regression: the original phrasings must keep matching after widening the noun.
expired('This job is closed to new applicants.') === 'expired'
  ? pass('"This job is closed" still -> expired (regression)')
  : fail('"This job is closed" regressed');

expired('This job listing is closed as of today.') === 'expired'
  ? pass('"This job listing is closed" still -> expired (regression)')
  : fail('"This job listing is closed" regressed');

// The reported failure mode is a page with a body but NO apply control (see
// the "× 3" rows in the issue). Verify the fix also holds in that scenario:
// body over MIN_CONTENT_CHARS, applyControls: [], the closure banner alone
// must decide expired -- not fall through to insufficient_content or
// no_apply_control.
//
// The two banners carry DIFFERENT codes on purpose: "This role is closed"
// is a hard-expired signal (strong enough to override an apply control),
// so it fires from HARD_EXPIRED_PATTERNS with code expired_body. Bare
// "JOB EXPIRED" is a weak signal (a "Similar jobs" carousel entry on a
// LIVE page carries the same string), so it fires from SOFT_EXPIRED_PATTERNS
// after the apply-control branch and carries code expired_body_soft. The
// distinction is measured here, not just in the tier assertion below,
// because a future refactor that put both banners back in one tier would
// keep the surface result === 'expired' green while breaking the whole
// invariant santifer's #4194 review is about.
const padding = 'Job description follows. '.repeat(20);
for (const { text, expectedCode, label } of [
  {
    text: `This role is closed. ${padding}`,
    expectedCode: 'expired_body',
    label: '"This role is closed" (no apply control, padded body)',
  },
  {
    text: `JOB EXPIRED. ${padding}`,
    expectedCode: 'expired_body_soft',
    label: 'bare "JOB EXPIRED" (no apply control, padded body)',
  },
]) {
  const verdict = classifyLiveness({
    status: 200,
    finalUrl: 'https://careers.example.com/job/123',
    bodyText: text,
    applyControls: [],
  });
  verdict.result === 'expired' && verdict.code === expectedCode
    ? pass(`${label} -> expired/${expectedCode}`)
    : fail(`${label} classified ${verdict.result}/${verdict.code}, expected expired/${expectedCode}`);
}

// False-positive guard: real JD copy mentions "role" and "position"
// constantly. The pattern anchors on "this ... is closed", so descriptive
// use in an active posting must stay active.
classifyLiveness({
  status: 200,
  finalUrl: 'https://careers.example.com/job/123',
  bodyText: 'This role is a hands-on senior IC position on the platform team, based in Toronto. You will own reliability for the inference stack. Apply now.',
  applyControls: ['Apply now'],
}).result === 'active'
  ? pass('active posting with "role"/"position" in descriptive prose stays active')
  : fail('false positive: descriptive "role"/"position" prose read as expired');

// False-positive guard for the "job expired" pattern: \b boundaries mean it
// only matches those two words adjacent. Split across a sentence, an active
// posting must stay active. Belt-and-suspenders against the SOFT tier —
// even before the tier move, adjacency alone should keep this active.
classifyLiveness({
  status: 200,
  finalUrl: 'https://careers.example.com/job/123',
  bodyText: 'This job is open to remote candidates. Applications from candidates whose visas have expired will still be considered.',
  applyControls: ['Apply now'],
}).result === 'active'
  ? pass('active posting with non-adjacent "job" / "expired" stays active')
  : fail('false positive: non-adjacent "job" / "expired" read as expired');

console.log('\nliveness-core — SOFT_EXPIRED_PATTERNS tier: weak signals must lose to a visible apply control (#4194)');

// santifer's #4194 review fixtures. Each is a body a live posting can
// legitimately carry (carousel item, filter chip, footer FAQ), and each
// has a working apply control. Before the tier move, the bare "\bjob
// expired\b" pattern lived in HARD_EXPIRED and fired here BEFORE the
// apply-control branch, returning expired -- filtering a live posting
// out of scans permanently (see the 5xx-guard comment in liveness-core
// for the underlying dedup mechanism).
//
// The tests below fail on 117aea0 (the first PR commit) and pass on the
// follow-up. Verified in the docker container before pushing.
const softApplyPresent = 'Job description follows. '.repeat(20);
for (const { text, label } of [
  {
    text: `Senior AI Engineer\n${softApplyPresent}\nSimilar jobs: Software Engineer at Contoso — Job Expired`,
    label: '"Similar jobs" carousel entry reading "Job Expired" (live posting)',
  },
  {
    text: `Filters: Hide job expired · Remote only · Posted this week\n${softApplyPresent}`,
    label: '"Hide job expired" filter chip on a live posting',
  },
  {
    text: `${softApplyPresent}\nFAQ: What happens when a job expired? See our archive policy.`,
    label: 'footer FAQ mentioning "when a job expired?" on a live posting',
  },
]) {
  const verdict = classifyLiveness({
    status: 200,
    finalUrl: 'https://careers.example.com/job/123',
    bodyText: text,
    applyControls: ['Apply now'],
  });
  verdict.result === 'active' && verdict.code === 'apply_control_visible'
    ? pass(`${label} -> active/apply_control_visible (SOFT_EXPIRED loses to Apply)`)
    : fail(`${label} classified ${verdict.result}/${verdict.code}, expected active/apply_control_visible`);
}

// Closed-loop / closed-form compound guard on the closed pattern. Real
// engineering JDs commonly say "closed-loop control" or "closed-form
// solution"; the earlier /this (?:job|role|position)(?: listing)? is
// closed/i (no trailing boundary) matched the "is closed" fragment from
// "is closed-loop" and returned expired. \b(?!-) closes it.
for (const { text, label } of [
  {
    text: 'This role is closed-loop control of the platform, integrating sensor feedback with actuation. Apply now.',
    label: '"This role is closed-loop control..." (control-systems JD)',
  },
  {
    text: 'This position is closed-form solvable, unlike the general case that requires numerical methods.',
    label: '"This position is closed-form solvable..." (ML/math JD)',
  },
]) {
  const verdict = classifyLiveness({
    status: 200,
    finalUrl: 'https://careers.example.com/job/123',
    bodyText: text,
    applyControls: ['Apply now'],
  });
  verdict.result === 'active' && verdict.code === 'apply_control_visible'
    ? pass(`${label} -> active/apply_control_visible`)
    : fail(`${label} classified ${verdict.result}/${verdict.code}, expected active/apply_control_visible`);
}
