// tests/liveness-request-refused.test.mjs — an HTTP 401 or 451 job page is
// unconfirmed, not closed.
//
// classifyLiveness() already reads 403, 429, 503 and every 5xx as `uncertain`:
// they describe the request being refused or the origin failing, not the
// posting. 401 (a sign-in wall) and 451 (withheld for legal reasons, usually by
// region) are the same kind of answer, but they fell through to the
// content-length heuristic. Their bodies are short error pages, so they read as
// `expired` / insufficient_content, and `scan --verify` writes an expired
// verdict as `skipped_expired`, which every later scan dedup-skips. AGENTS.md:
// "a login/error page is **unconfirmed**, not closed".
import { pass, fail } from './helpers.mjs';
import assert from 'node:assert';
import { classifyLiveness } from '../liveness-core.mjs';

const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };
const URL = 'https://jobs.example.com/careers/jobs/4821';
const verdict = (status, bodyText) => classifyLiveness({ status, requestedUrl: URL, finalUrl: URL, bodyText });

console.log('\nliveness — a refused request is not a closed posting');

ok('401: a sign-in wall is uncertain, not expired', () => {
  const v = verdict(401, 'Unauthorized. Please sign in to continue.');
  assert.strictEqual(v.result, 'uncertain', JSON.stringify(v));
  assert.strictEqual(v.code, 'access_blocked');
  assert.match(v.reason, /^HTTP 401/);
});

ok('451: a posting withheld for legal reasons is uncertain, not expired', () => {
  const v = verdict(451, 'Unavailable For Legal Reasons');
  assert.strictEqual(v.result, 'uncertain', JSON.stringify(v));
  assert.strictEqual(v.code, 'access_blocked');
  assert.match(v.reason, /^HTTP 451/);
});

ok('premise: a 404 or 410 is still closure evidence', () => {
  for (const status of [404, 410]) assert.strictEqual(verdict(status, 'Not Found').result, 'expired', `HTTP ${status}`);
});
