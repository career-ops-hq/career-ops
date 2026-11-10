/**
 * update-check-git-fallback.test.mjs — `check --channel main` must not report
 * "offline" when apply() would succeed.
 *
 * On `--channel main`, check() asks GitHub over curl while apply() fetches over
 * git. On machines where only curl fails (curl missing from PATH, a proxy
 * configured only in git config, raw/api hosts filtered while github.com is
 * reachable), check() used to emit a false {"status":"offline"} seconds before
 * a successful apply. The fix asks `git ls-remote --tags` before declaring
 * offline.
 *
 * The default channel deliberately has NO git fallback: there apply() resolves
 * its target through the releases API itself (resolveTargetRef) and refuses
 * when curl cannot reach it, so a git-found version would offer an update that
 * apply then declines. It still reports why it is offline.
 *
 * Everything below runs the code through checkStatus()'s ctx seams (curlGet,
 * gitRemoteVersion, localVersion, readMarker) or calls the exported helpers
 * directly, with no network: no assertion reads update-system.mjs's source.
 */

import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pass, fail } from './helpers.mjs';
import { checkStatus, highestReleaseTag, curlGet, gitRemoteVersion } from '../update-system.mjs';

console.log('\n🧪 Testing update-check git fallback...');

const MAIN = ['check', '--channel', 'main'];

/**
 * A curlGet double. `answers` maps a URL substring to a body; any other URL
 * fails with `reason`, reported through the onError callback the way the real
 * curlGet() reports it. Records every URL asked.
 */
function fakeCurl(answers = {}, reason = 'ENOENT') {
  const urls = [];
  const fn = async (url, _extraArgs, onError = () => {}) => {
    urls.push(url);
    for (const [needle, body] of Object.entries(answers)) if (url.includes(needle)) return body;
    onError(reason);
    return null;
  };
  return { fn, urls };
}

/** A gitRemoteVersion double that records whether it was consulted. */
function fakeGit(result) {
  const probe = { calls: 0 };
  probe.fn = () => { probe.calls += 1; return result; };
  return probe;
}

const run = (argv, { curl, git, local = '1.33.0' }) =>
  checkStatus(argv, {}, { curlGet: curl.fn, gitRemoteVersion: git.fn, localVersion: () => local, readMarker: () => null });

// ── 1. highestReleaseTag(): only career-ops release tags count ──────────
{
  const out = [
    'aaa\trefs/tags/career-ops-v1.9.0',
    'bbb\trefs/tags/career-ops-v1.25.0',
    'ccc\trefs/tags/career-ops-v1.25.0^{}',
    'ddd\trefs/tags/web-v99.0.0',
    'eee\trefs/tags/v50.0.0',
    'fff\trefs/tags/career-ops-v1.30.0-preview-v99.0.0',
    'ggg\trefs/tags/career-ops-vpreview-v98.0.0',
    'hhh\trefs/tags/career-ops-v1.24.0\r',
  ].join('\n');
  const got = highestReleaseTag(out);
  if (got === '1.25.0') {
    pass('highestReleaseTag picks the semver-highest career-ops release (1.25.0 > 1.9.0, not lexical)');
  } else {
    fail(`highestReleaseTag → ${JSON.stringify(got)}, expected "1.25.0"`);
  }
  // Each of these alone would win if it were mistaken for a release.
  const decoys = [
    ['the sibling web-v* component', 'x\trefs/tags/web-v99.0.0'],
    ['a historical bare tag', 'x\trefs/tags/v50.0.0'],
    ['a prefixed tag with trailing content', 'x\trefs/tags/career-ops-v1.30.0-preview-v99.0.0'],
    ['a prefixed tag with a non-version body', 'x\trefs/tags/career-ops-vpreview-v98.0.0'],
  ];
  for (const [label, line] of decoys) {
    const res = highestReleaseTag(`a\trefs/tags/career-ops-v1.2.0\n${line}`);
    if (res === '1.2.0') pass(`highestReleaseTag ignores ${label}`);
    else fail(`highestReleaseTag took ${label}: ${JSON.stringify(res)}`);
  }
  if (highestReleaseTag('a\trefs/tags/career-ops-v1.3.0\r\n') === '1.3.0') pass('highestReleaseTag strips a trailing \\r (CRLF-translated output)');
  else fail('highestReleaseTag missed a CRLF-terminated tag');
  if (highestReleaseTag('') === '' && highestReleaseTag(null) === '' && highestReleaseTag('a\trefs/heads/main') === '') {
    pass('highestReleaseTag returns "" on empty, null and tag-less input');
  } else {
    fail('highestReleaseTag invented a version from nothing');
  }
}

// ── 2. --channel main, curl blocked, git reachable → the version git found ──
{
  const curl = fakeCurl();
  const git = fakeGit({ ok: true, version: '1.40.0' });
  const res = await run(MAIN, { curl, git });
  if (res.status === 'update-available' && res.remote === '1.40.0' && res.local === '1.33.0' && git.calls === 1) {
    pass('curl blocked + git reachable → update-available with the version git found, not "offline"');
  } else {
    fail(`curl blocked + git reachable → ${JSON.stringify(res)} (git consulted ${git.calls}x)`);
  }
  if (res.changelog === '') pass('the git path carries an empty changelog (modes/update.md renders the releases link for it)');
  else fail(`the git path carried changelog ${JSON.stringify(res.changelog)}`);

  const current = await run(MAIN, { curl: fakeCurl(), git: fakeGit({ ok: true, version: '1.33.0' }) });
  if (current.status === 'up-to-date' && current.remote === '1.33.0') pass('curl blocked + git reachable + same version → up-to-date');
  else fail(`curl blocked + git at the same version → ${JSON.stringify(current)}`);
}

// ── 3. git reachable but no release tag → no-remote-version, never offline ──
{
  const res = await run(MAIN, { curl: fakeCurl(), git: fakeGit({ ok: true, version: '' }) });
  if (res.status === 'no-remote-version' && /reachable but returned no career-ops release tags/.test(res.detail || '')) {
    pass('git reachable without a release tag → no-remote-version (the network is fine; the version is missing)');
  } else {
    fail(`git reachable without a release tag → ${JSON.stringify(res)}`);
  }
}

// ── 4. git fails too → offline, and the detail names every failure ──────
{
  const res = await run(MAIN, { curl: fakeCurl({}, 'timeout (10s)'), git: fakeGit({ ok: false, detail: 'fatal: unable to access' }) });
  const detail = res.detail || '';
  if (res.status === 'offline') pass('curl and git both failing → offline');
  else fail(`curl and git both failing → ${JSON.stringify(res)}`);
  if (/curl VERSION: timeout \(10s\)/.test(detail) && /curl releases: timeout \(10s\)/.test(detail) && /git ls-remote also failed: fatal: unable to access/.test(detail)) {
    pass('the offline detail names the reason of each curl leg and of git');
  } else {
    fail(`offline detail: ${JSON.stringify(detail)}`);
  }
}

// ── 5. git is consulted ONLY when both curl legs failed at the network ──
{
  const unparseable = fakeGit({ ok: true, version: '9.9.9' });
  const res = await run(MAIN, { curl: fakeCurl({ '/main/VERSION': 'garbage', '/releases/latest': 'not json' }), git: unparseable });
  if (res.status === 'no-remote-version' && unparseable.calls === 0) {
    pass('a source that answered but was unparseable → no-remote-version, git never asked');
  } else {
    fail(`unparseable answers → ${JSON.stringify(res)} (git consulted ${unparseable.calls}x)`);
  }
  const healthy = fakeGit({ ok: true, version: '9.9.9' });
  const ok = await run(MAIN, { curl: fakeCurl({ '/main/VERSION': '1.34.0 # x-release-please-version\n' }), git: healthy });
  if (ok.status === 'update-available' && ok.remote === '1.34.0' && healthy.calls === 0) {
    pass('one curl source answering is enough: git never asked, its version never used');
  } else {
    fail(`one curl source answering → ${JSON.stringify(ok)} (git consulted ${healthy.calls}x)`);
  }
}

// ── 6. The default channel never falls back to git, but says why it is offline ──
{
  const git = fakeGit({ ok: true, version: '1.40.0' });
  const res = await run(['check'], { curl: fakeCurl({}, 'HTTP 403'), git });
  if (res.status === 'offline' && git.calls === 0) {
    pass('default channel: curl failing → offline, git never asked (apply resolves over the same API and would refuse)');
  } else {
    fail(`default channel, curl failing → ${JSON.stringify(res)} (git consulted ${git.calls}x)`);
  }
  if (res.detail === 'curl releases: HTTP 403') pass('default channel: the offline answer carries the curl failure reason');
  else fail(`default channel offline detail: ${JSON.stringify(res.detail)}`);
}

// ── 7. --channel main asks its three curl sources at once ───────────────
// The main-ref lookup used to run after the version sources, so a black-holed
// network paid the curl budget twice before the git probe even began.
{
  let inFlight = 0;
  let peak = 0;
  const slow = async (url, _extraArgs, onError = () => {}) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 20));
    inFlight -= 1;
    onError('timeout (10s)');
    return null;
  };
  await checkStatus(MAIN, {}, { curlGet: slow, gitRemoteVersion: () => ({ ok: false, detail: 'x' }), localVersion: () => '1.33.0', readMarker: () => null });
  if (peak === 3) pass('--channel main: VERSION, releases and the main-ref lookup are in flight together (one curl budget, not two)');
  else fail(`--channel main: peak concurrent curl calls ${peak}, expected 3`);
}

// ── 8. curlGet() never throws on a broken curl, and names the failure ───
// A missing curl is reported through the execFile callback (ENOENT); a
// corrupt curl on PATH is a SYNCHRONOUS spawn throw on Windows (EFTYPE) and
// an async error on POSIX. Both must resolve null and report a reason.
{
  const realPath = process.env.PATH;
  const emptyDir = mkdtempSync(join(tmpdir(), 'uc-curl-missing-'));
  const brokenDir = mkdtempSync(join(tmpdir(), 'uc-curl-broken-'));
  // Garbage bytes: not a valid executable image on Windows (curl.exe) and no
  // shebang on POSIX (curl) — each platform resolves its own file.
  writeFileSync(join(brokenDir, 'curl.exe'), Buffer.from([0x00, 0x01, 0x02, 0x03]));
  writeFileSync(join(brokenDir, 'curl'), Buffer.from([0x00, 0x01, 0x02, 0x03]));
  try { chmodSync(join(brokenDir, 'curl'), 0o755); } catch { /* windows: no-op */ }

  const cases = [
    ['missing curl on PATH (ENOENT callback path)', emptyDir],
    ['corrupt curl binary on PATH (sync-throw path on Windows)', brokenDir],
  ];
  for (const [label, dir] of cases) {
    process.env.PATH = dir;
    let reason = '';
    try {
      const res = await curlGet('http://127.0.0.1:9/unreachable', [], (r) => { reason = r; });
      if (res === null && reason) pass(`curlGet() resolves null and reports ${JSON.stringify(reason.slice(0, 24))} with ${label}`);
      else fail(`curlGet() with ${label} → ${JSON.stringify(res)}, reason ${JSON.stringify(reason)}`);
    } catch (error) {
      fail(`curlGet() with ${label} THREW (${error.code || String(error.message).split('\n')[0]}) — check() would crash on this machine`);
    } finally {
      process.env.PATH = realPath;
    }
  }
  rmSync(emptyDir, { recursive: true, force: true });
  rmSync(brokenDir, { recursive: true, force: true });
}

// ── 9. gitRemoteVersion() reports git's own reason, not the command line ──
// A non-zero git exit puts the exit code in error.status and the diagnosis in
// stderr; error.message is only "Command failed: git …". RFC 2606's `.invalid`
// TLD fails DNS locally and deterministically. Git's wording is
// locale-dependent, so the assertion is the tautology's absence.
{
  const res = gitRemoteVersion('https://this-host-does-not-exist.invalid/repo.git');
  if (res && res.ok === false && res.detail && !/^Command failed/.test(String(res.detail))) {
    pass(`gitRemoteVersion() surfaces git's own failure reason (detail: ${JSON.stringify(String(res.detail).slice(0, 60))})`);
  } else {
    fail(`gitRemoteVersion() against a .invalid host → ${JSON.stringify(res)}`);
  }
}
