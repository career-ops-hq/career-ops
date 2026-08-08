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
