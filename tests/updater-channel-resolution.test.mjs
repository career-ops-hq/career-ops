/**
 * updater-channel-resolution.test.mjs — apply() must fetch a reproducible
 * release, not whatever main happens to be at the moment it runs.
 *
 * The regression: apply()'s only fetch call was hardcoded to CANONICAL_REPO's
 * `main`. release-please can bump VERSION on main hours before the matching
 * tag lands (and, rarely, before a fix for a bug introduced in that window
 * lands too), so a same-moment `main` fetch can install an untagged
 * intermediate commit — reproducing a real support case where a user's
 * VERSION file said v1.30.0 but their code was not the v1.30.0 release.
 *
 * resolveTargetRef() is the fix: the default ('release') channel resolves to
 * the newest published release tag via RELEASES_API; `--channel main` (flag
 * or, for the re-exec'd child, CAREER_OPS_UPDATE_CHANNEL=main) opts back into
 * tracking main, with no network call at all. A failed release lookup on the
 * default channel throws — silently falling back to main would reintroduce
 * the exact bug this closes, on exactly the network blip that makes it matter.
 *
 * One more failure mode this pins: this is a manifest-mode monorepo that also
 * releases a sibling `web` component (`web-vX.Y.Z`), and RELEASES_API's
 * `/releases/latest` returns correctly ONLY because release.yml's "Keep the
 * career-ops release marked as Latest" step re-asserts it on every push. If
 * that step ever silently stopped doing its job, `/releases/latest` would
 * hand back a `web-*` tag and, without a guard, apply() would fetch and
 * install it without complaint. resolveTargetRef() rejects any tag not
 * prefixed `career-ops-v` for exactly this reason.
 *
 * These tests drive the real export against an injected ctx.curlGet, the
 * same seam production uses (ctx.git elsewhere in this suite) — no real
 * network, no git fixture needed, since resolveTargetRef never touches git.
 */

import { pass, fail } from './helpers.mjs';
import { resolveTargetRef } from '../update-system.mjs';

console.log('\n🧪 Testing updater channel resolution (release tag vs. main)...');

// ── 1. Default channel resolves to the latest release tag ──────────────────
{
  let calls = 0;
  const fakeCurlGet = async (url) => {
    calls++;
    if (!url.includes('/releases/latest')) return null;
    return JSON.stringify({ tag_name: 'career-ops-v1.32.0' });
  };

  const ref = await resolveTargetRef([], {}, { curlGet: fakeCurlGet });
  if (ref === 'career-ops-v1.32.0') {
    pass('default channel resolves to the release tag verbatim');
  } else {
    fail(`default channel resolved to '${ref}', expected the release tag`);
  }
  if (calls === 1) {
    pass('default channel calls the release lookup exactly once');
  } else {
    fail(`default channel called curlGet ${calls} time(s), expected 1`);
  }
}

// ── 2. --channel main resolves to 'main' WITHOUT any network call ──────────
{
  let calls = 0;
  const fakeCurlGet = async () => { calls++; return JSON.stringify({ tag_name: 'career-ops-v9.9.9' }); };

  const ref = await resolveTargetRef(['apply', '--channel', 'main', '--confirm'], {}, { curlGet: fakeCurlGet });
  if (ref === 'main') {
    pass("--channel main resolves to 'main'");
  } else {
    fail(`--channel main resolved to '${ref}', expected 'main'`);
  }
  if (calls === 0) {
    pass('--channel main never calls curlGet');
  } else {
    fail(`--channel main called curlGet ${calls} time(s), expected 0`);
  }
}

// ── 3. CAREER_OPS_UPDATE_CHANNEL=main (the re-exec'd child's path) ─────────
// The child reads its channel from env, not argv — its own argv is just
// `apply --confirm` (see the reexec spawn in apply()). Same no-network
// contract applies.
{
  let calls = 0;
  const fakeCurlGet = async () => { calls++; return JSON.stringify({ tag_name: 'career-ops-v9.9.9' }); };

  const ref = await resolveTargetRef(['apply', '--confirm'], { CAREER_OPS_UPDATE_CHANNEL: 'main' }, { curlGet: fakeCurlGet });
  if (ref === 'main' && calls === 0) {
    pass('CAREER_OPS_UPDATE_CHANNEL=main resolves to main with no network call');
  } else {
    fail(`env channel=main gave ref='${ref}', curlGet calls=${calls}`);
  }
}

// ── 4. argv --channel wins over env CAREER_OPS_UPDATE_CHANNEL ──────────────
{
  const fakeCurlGet = async () => JSON.stringify({ tag_name: 'career-ops-v1.32.0' });
  const ref = await resolveTargetRef(['apply', '--channel', 'main'], { CAREER_OPS_UPDATE_CHANNEL: 'release' }, { curlGet: fakeCurlGet });
  if (ref === 'main') {
    pass('an explicit --channel flag overrides the inherited env channel');
  } else {
    fail(`expected argv to win over env, got ref='${ref}'`);
  }
}

// ── 5. A failed release lookup on the default channel THROWS ───────────────
// No silent fallback to main — that would defeat the entire point on exactly
// the network blip that makes it matter most.
{
  const fakeCurlGet = async () => null; // curlGet's own null-on-failure contract
  let threw = null;
  try {
    await resolveTargetRef([], {}, { curlGet: fakeCurlGet });
  } catch (err) {
    threw = err;
  }
  if (threw && /--channel main/.test(threw.message)) {
    pass('a failed release lookup throws and names the --channel main escape hatch');
  } else {
    fail(threw ? `threw but without the expected guidance: ${threw.message}` : 'a failed release lookup silently resolved instead of throwing');
  }
}

// ── 6. A release with no usable tag_name also throws, not falls back ───────
{
  const fakeCurlGet = async () => JSON.stringify({ tag_name: '' });
  let threw = null;
  try {
    await resolveTargetRef([], {}, { curlGet: fakeCurlGet });
  } catch (err) {
    threw = err;
  }
  if (threw) {
    pass('an empty tag_name throws instead of silently falling back');
  } else {
    fail('an empty tag_name resolved instead of throwing');
  }
}

// ── 7. An unknown --channel value throws before any network call ──────────
{
  let calls = 0;
  const fakeCurlGet = async () => { calls++; return JSON.stringify({ tag_name: 'career-ops-v1.32.0' }); };
  let threw = null;
  try {
    await resolveTargetRef(['apply', '--channel', 'nightly'], {}, { curlGet: fakeCurlGet });
  } catch (err) {
    threw = err;
  }
  if (threw && /nightly/.test(threw.message) && calls === 0) {
    pass('an unknown channel throws without ever calling curlGet');
  } else {
    fail(threw ? `threw, but curlGet was called ${calls} time(s)` : 'an unknown channel silently resolved');
  }
}

// ── 8. A tag from the sibling `web` component is rejected, not installed ───
// Reproduces release.yml's "Keep the career-ops release marked as Latest"
// step silently not running: /releases/latest hands back web's tag instead.
{
  const fakeCurlGet = async () => JSON.stringify({ tag_name: 'web-v0.10.0' });
  let threw = null;
  try {
    await resolveTargetRef([], {}, { curlGet: fakeCurlGet });
  } catch (err) {
    threw = err;
  }
  if (threw && /web-v0\.10\.0/.test(threw.message) && /--channel main/.test(threw.message)) {
    pass("a 'web' component tag is rejected by name, not silently fetched");
  } else {
    fail(threw ? `threw, but without naming the rejected tag: ${threw.message}` : "a 'web' tag resolved instead of throwing");
  }
}

// ── 9. A correctly-prefixed tag still resolves normally ─────────────────────
// Pins the guard to the sibling-component case specifically, not to every
// tag shape — a real career-ops-v* release must not start tripping this.
{
  const fakeCurlGet = async () => JSON.stringify({ tag_name: 'career-ops-v1.32.0' });
  const ref = await resolveTargetRef([], {}, { curlGet: fakeCurlGet });
  if (ref === 'career-ops-v1.32.0') {
    pass('a correctly-prefixed career-ops tag passes the guard');
  } else {
    fail(`expected the guard to pass a career-ops-v* tag through, got '${ref}'`);
  }
}

// ── 10. A right-prefix, malformed-version tag is rejected too ──────────────
// The prefix check alone would let 'career-ops-vnot-a-version' through —
// same prefix, no real version. SEMVER_RE (shared with the VERSION/tag
// parsing elsewhere in this file) is the same bar a genuine tag must clear.
{
  const fakeCurlGet = async () => JSON.stringify({ tag_name: 'career-ops-vnot-a-version' });
  let threw = null;
  try {
    await resolveTargetRef([], {}, { curlGet: fakeCurlGet });
  } catch (err) {
    threw = err;
  }
  if (threw && /career-ops-vnot-a-version/.test(threw.message) && /--channel main/.test(threw.message)) {
    pass('a right-prefix but non-semver tag is rejected, not silently fetched');
  } else {
    fail(threw ? `threw, but without naming the rejected tag: ${threw.message}` : 'a malformed tag resolved instead of throwing');
  }
}
