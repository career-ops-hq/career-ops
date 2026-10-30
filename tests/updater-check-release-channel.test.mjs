/**
 * updater-check-release-channel.test.mjs — check() offers an update only when
 * a newer career-ops release is published, and a "no" covers one release.
 *
 * The regression: check() compared the install against main's tip as well as
 * VERSION (#2630), so every merge to a system file between releases prompted
 * "system files differ from v{local}. Re-apply v{local} to restore them?" —
 * and, since #3845, apply() installs the release, not main, so accepting that
 * prompt re-installed the same release and the prompt came back next session.
 * And dismiss() silenced check() for good: one "no" meant never hearing about
 * a release again, the next one included.
 *
 * checkStatus() is the fix, driven here through its ctx seams (curlGet,
 * localVersion, readMarker) with no network and no git:
 *   - default channel: the latest release vs VERSION, nothing else; main's
 *     VERSION and main's tip are never read
 *   - a "no" to vX covers vX and older; a newer release asks again
 *   - a legacy timestamp marker covers releases published up to that moment
 *   - --force ignores the marker (the user asked)
 *   - an unusable release (offline, web-v*, malformed tag) is a quiet status,
 *     never an offer and never a throw
 *   - --channel main keeps main's VERSION as a source
 * and dismiss() writes the version it was given, or the latest release's.
 */

import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, rmSync } from './helpers.mjs';
import { checkStatus, dismiss, parseDismissMarker, dismissalCovers } from '../update-system.mjs';

console.log('\n🧪 Testing update check on the release channel (version-only prompt, per-release dismiss)...');

const RELEASE = (tag, publishedAt = '2026-09-30T12:00:00Z', body = 'Release notes') =>
  JSON.stringify({ tag_name: tag, published_at: publishedAt, body });

/** A curlGet double that answers only the releases API and records every URL asked. */
function releasesOnly(answer) {
  const urls = [];
  const fn = async (url) => { urls.push(url); return url.includes('/releases/latest') ? answer : null; };
  return { fn, urls };
}

const run = (argv, { release, local = '1.33.0', marker = null }) => {
  const curl = releasesOnly(release);
  return checkStatus(argv, {}, { curlGet: curl.fn, localVersion: () => local, readMarker: () => marker }).then(res => ({ res, urls: curl.urls }));
};

// ── 1. Same release as installed → up-to-date, and only the releases API is asked ──
{
  const { res, urls } = await run(['check'], { release: RELEASE('career-ops-v1.33.0') });
  if (res.status === 'up-to-date' && res.remote === '1.33.0') pass('same release installed → up-to-date');
  else fail(`same release installed → ${JSON.stringify(res)}`);
  if (urls.length === 1 && urls[0].includes('/releases/latest')) pass("the default channel never reads main's VERSION or main's tip");
  else fail(`the default channel asked: ${JSON.stringify(urls)}`);
}

// ── 2. Newer release → update-available, version-changed, with its notes ──
{
  const { res } = await run(['check'], { release: RELEASE('career-ops-v1.34.0', undefined, 'x'.repeat(900)) });
  if (res.status === 'update-available' && res.remote === '1.34.0' && res.local === '1.33.0' && res.reason === 'version-changed') {
    pass('a newer release → update-available (version-changed)');
  } else {
    fail(`a newer release → ${JSON.stringify(res)}`);
  }
  if (res.changelog?.length === 500) pass('the changelog is the release notes, capped at 500 chars');
  else fail(`changelog length ${res.changelog?.length}`);
}

// ── 3. An install ahead of the latest release (tracked main before) is not offered a downgrade ──
{
  const { res } = await run(['check'], { release: RELEASE('career-ops-v1.33.0'), local: '1.34.0' });
  if (res.status === 'up-to-date') pass('VERSION ahead of the latest release → up-to-date, no downgrade offered');
  else fail(`VERSION ahead → ${JSON.stringify(res)}`);
}

// ── 4. A "no" covers that release, not the next one ──
{
  const marker = JSON.stringify({ version: '1.34.0', at: '2026-09-30T13:00:00Z' });
  const same = (await run(['check'], { release: RELEASE('career-ops-v1.34.0'), marker })).res;
  if (same.status === 'dismissed') pass('dismissed v1.34.0 → v1.34.0 stays quiet');
  else fail(`dismissed v1.34.0, offered v1.34.0 → ${JSON.stringify(same)}`);
  const newer = (await run(['check'], { release: RELEASE('career-ops-v1.35.0'), marker })).res;
  if (newer.status === 'update-available' && newer.remote === '1.35.0') pass('dismissed v1.34.0 → v1.35.0 asks again');
  else fail(`dismissed v1.34.0, offered v1.35.0 → ${JSON.stringify(newer)}`);
}

// ── 5. A legacy marker (bare timestamp) covers what was published before it ──
{
  const marker = '2026-09-20T10:00:00.000Z';
  const before = (await run(['check'], { release: RELEASE('career-ops-v1.34.0', '2026-09-16T13:58:00Z'), marker })).res;
  if (before.status === 'dismissed') pass('legacy marker → a release published before it stays quiet');
  else fail(`legacy marker, release published before → ${JSON.stringify(before)}`);
  const after = (await run(['check'], { release: RELEASE('career-ops-v1.34.0', '2026-09-30T12:00:00Z'), marker })).res;
  if (after.status === 'update-available') pass('legacy marker → a release published after it asks again (no longer silent forever)');
  else fail(`legacy marker, release published after → ${JSON.stringify(after)}`);
  const unplaceable = (await run(['check'], { release: RELEASE('career-ops-v1.34.0'), marker: 'ts' })).res;
  if (unplaceable.status === 'dismissed') pass('a "no" we cannot date keeps covering');
  else fail(`unparseable marker → ${JSON.stringify(unplaceable)}`);
}

// ── 6. --force ignores the marker ──
{
  const marker = JSON.stringify({ version: '1.34.0', at: '2026-09-30T13:00:00Z' });
  const { res } = await run(['check', '--force'], { release: RELEASE('career-ops-v1.34.0'), marker });
  if (res.status === 'update-available') pass('check --force shows a dismissed release');
  else fail(`check --force → ${JSON.stringify(res)}`);
}

// ── 7. Unusable release answers are quiet statuses, never offers, never throws ──
{
  const cases = [
    [null, 'offline'],
    ['not json', 'no-remote-version'],
    [RELEASE('web-v0.12.0'), 'no-remote-version'],
    [RELEASE('career-ops-vpreview-v1.34.0'), 'no-remote-version'],
    [JSON.stringify({}), 'no-remote-version'],
  ];
  for (const [answer, expected] of cases) {
    let res = null, threw = null;
    try { res = (await run(['check'], { release: answer })).res; } catch (err) { threw = err; }
    if (!threw && res.status === expected) pass(`${answer === null ? 'no network' : answer.slice(0, 40)} → ${expected}`);
    else fail(`${String(answer).slice(0, 40)} → ${threw ? 'threw ' + threw.message : JSON.stringify(res)}`);
  }
}

// ── 8. --channel main keeps main's VERSION as a source ──
{
  const urls = [];
  const fakeCurlGet = async (url) => {
    urls.push(url);
    if (url.endsWith('/main/VERSION')) return '1.34.0 # x-release-please-version\n';
    return null;
  };
  const res = await checkStatus(['check', '--channel', 'main'], {}, { curlGet: fakeCurlGet, localVersion: () => '1.33.0', readMarker: () => null });
  if (res.status === 'update-available' && res.remote === '1.34.0' && urls.some(u => u.endsWith('/main/VERSION'))) {
    pass("--channel main still reads main's VERSION");
  } else {
    fail(`--channel main → ${JSON.stringify(res)} after ${JSON.stringify(urls)}`);
  }
}

// ── 9. The marker parser and the coverage rule, directly ──
{
  const m = parseDismissMarker('{"version":"1.34.0","at":"2026-09-30T13:00:00Z"}\n');
  if (m.version === '1.34.0' && m.at === '2026-09-30T13:00:00Z') pass('the JSON marker is read');
  else fail(`JSON marker → ${JSON.stringify(m)}`);
  const legacy = parseDismissMarker('2026-09-20T10:00:00.000Z');
  if (legacy.version === '' && legacy.at === '2026-09-20T10:00:00.000Z') pass('the legacy timestamp marker is read');
  else fail(`legacy marker → ${JSON.stringify(legacy)}`);
  if (parseDismissMarker(null) === null && !dismissalCovers(null, '1.34.0', '')) pass('no marker covers nothing');
  else fail('a missing marker covered something');
  if (dismissalCovers({ version: '1.34.0', at: '' }, '1.33.9', '') && !dismissalCovers({ version: '1.34.0', at: '' }, '1.34.1', '')) {
    pass('a version marker covers that release and older ones only');
  } else {
    fail('a version marker covered the wrong releases');
  }
}

// ── 10. dismiss() records the release: --version, or the latest one ──
{
  const root = mkdtempSync(join(tmpdir(), 'co-dismiss-'));
  // dismiss() prints its confirmation; keep it out of the test output, not pass()/fail()'s.
  const quietly = async (fn) => { const log = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = log; } };
  try {
    let asked = 0;
    await quietly(() => dismiss(['dismiss', '--version', 'v1.34.0'], { root, curlGet: async () => { asked++; return null; }, now: () => new Date('2026-09-30T13:00:00Z') }));
    const written = JSON.parse(readFileSync(join(root, '.update-dismissed'), 'utf-8'));
    if (written.version === '1.34.0' && written.at === '2026-09-30T13:00:00.000Z' && asked === 0) pass('dismiss --version writes that release, without asking the network');
    else fail(`dismiss --version wrote ${JSON.stringify(written)} (network asked ${asked}×)`);

    await quietly(() => dismiss(['dismiss'], { root, curlGet: async (url) => url.includes('/releases/latest') ? RELEASE('career-ops-v1.35.0') : null }));
    const latest = JSON.parse(readFileSync(join(root, '.update-dismissed'), 'utf-8'));
    if (latest.version === '1.35.0') pass('dismiss without --version records the latest release');
    else fail(`dismiss without --version wrote ${JSON.stringify(latest)}`);

    await quietly(() => dismiss(['dismiss'], { root, curlGet: async () => null }));
    const offline = JSON.parse(readFileSync(join(root, '.update-dismissed'), 'utf-8'));
    if (!offline.version && offline.at) pass('dismiss offline records only the moment (publish dates decide later)');
    else fail(`dismiss offline wrote ${JSON.stringify(offline)}`);

    let threw = null;
    try { await quietly(() => dismiss(['dismiss', '--version', 'latest'], { root, curlGet: async () => null })); } catch (err) { threw = err; }
    if (threw && /X\.Y\.Z/.test(threw.message)) pass('dismiss --version with a non-version refuses, writing nothing new');
    else fail('dismiss --version latest was accepted');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
