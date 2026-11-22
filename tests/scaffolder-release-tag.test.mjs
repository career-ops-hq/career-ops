// tests/scaffolder-release-tag.test.mjs — `npx @santifer/career-ops init` says which ref it installs
//
// The scaffolder clones the tag /releases/latest names, and falls back to
// main when it gets none. That fallback used to be silent: the only trace was
// a missing " @ tag" in the "Cloning" line. resolveReleaseTag() now returns a
// reason for every fallback so cli.mjs can print it, and refuses a tag that is
// not a career-ops release (the sibling `web-vX.Y.Z` component).
import { readFileSync } from 'fs';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';
import { resolveReleaseTag, RELEASE_TAG_RE, LATEST_RELEASE } from '../scaffolder/bin/release-tag.mjs';
import { RELEASE_TAG_RE as UPDATER_RELEASE_TAG_RE } from '../update-system.mjs';

console.log('\nscaffolder — resolving the release tag to clone');

const headers = (h = {}) => ({ get: (k) => h[k.toLowerCase()] ?? null });
const respond = ({ status = 200, body, h } = {}) => async () => ({
  ok: status >= 200 && status < 300,
  status,
  headers: headers(h),
  json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
});

async function check(name, fetchImpl, expect) {
  const got = await resolveReleaseTag({ fetchImpl });
  if (expect.tag) {
    if (got.tag === expect.tag && !got.reason) pass(name);
    else fail(`${name}: expected tag ${expect.tag}, got ${JSON.stringify(got)}`);
    return;
  }
  if (got.tag === null && typeof got.reason === 'string' && expect.reason.test(got.reason)) pass(name);
  else fail(`${name}: expected no tag and a reason matching ${expect.reason}, got ${JSON.stringify(got)}`);
}

// 1. A career-ops release is used as-is.
await check('a career-ops-vX.Y.Z release tag is cloned',
  respond({ body: { tag_name: 'career-ops-v1.37.0' } }), { tag: 'career-ops-v1.37.0' });

// 2. Every fallback to main carries a reason the CLI prints.
await check('network failure falls back with a reason',
  async () => { const e = new Error('fetch failed'); e.cause = { code: 'ENOTFOUND' }; throw e; },
  { reason: /could not reach the GitHub API \(ENOTFOUND\)/ });
await check('API rate limit falls back and names the limit',
  respond({ status: 403, h: { 'x-ratelimit-remaining': '0' } }),
  { reason: /HTTP 403 \(rate limit reached\)/ });
await check('other HTTP errors fall back with the status',
  respond({ status: 404 }), { reason: /HTTP 404$/ });
await check('a release with no tag falls back',
  respond({ body: {} }), { reason: /no release tag/ });
await check('an unreadable body falls back',
  respond({ body: 'not json' }), { reason: /no release tag/ });

// 3. A tag that is not a career-ops release is refused, not cloned.
await check('the sibling web-vX.Y.Z release is not cloned',
  respond({ body: { tag_name: 'web-v0.15.0' } }), { reason: /"web-v0\.15\.0", not a career-ops-vX\.Y\.Z release/ });
await check('a malformed career-ops tag is not cloned',
  respond({ body: { tag_name: 'career-ops-vpreview-v1.32.0' } }), { reason: /not a career-ops-vX\.Y\.Z release/ });

// 4. The scaffolder and the updater agree on what a release tag is. The
//    scaffolder cannot import update-system.mjs (the npm package ships only
//    scaffolder/bin), so the rule is duplicated and this keeps the copies equal.
for (const t of ['career-ops-v1.37.0', 'career-ops-v10.0.12', 'web-v0.15.0', 'v1.37.0', 'career-ops-v1.37', 'career-ops-vpreview-v1.32.0', 'career-ops-v1.37.0-rc.1', '']) {
  if (RELEASE_TAG_RE.test(t) === UPDATER_RELEASE_TAG_RE.test(t)) pass(`scaffolder and updater agree on ${JSON.stringify(t)}`);
  else fail(`scaffolder and updater disagree on whether ${JSON.stringify(t)} is a release tag`);
}
if (/\/releases\/latest$/.test(LATEST_RELEASE) && LATEST_RELEASE.includes('/repos/career-ops-hq/career-ops/')) pass('scaffolder reads /releases/latest of career-ops-hq/career-ops');
else fail(`unexpected release endpoint ${LATEST_RELEASE}`);

// 5. cli.mjs prints the reason and names main on the fallback path, rather
//    than only dropping " @ tag" from the Cloning line.
{
  const cli = readFileSync(join(ROOT, 'scaffolder/bin/cli.mjs'), 'utf-8');
  if (/resolveReleaseTag\(\)/.test(cli) && /\$\{reason\}/.test(cli)) pass('cli.mjs prints why it fell back');
  else fail('cli.mjs no longer prints the fallback reason from resolveReleaseTag()');
  if (/main \(unreleased\)/.test(cli)) pass('cli.mjs names main as unreleased when it falls back');
  else fail('cli.mjs does not say it installed main when no release tag resolved');
}
