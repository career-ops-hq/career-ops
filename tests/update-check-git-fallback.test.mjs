/**
 * update-check-git-fallback.test.mjs — check() must not report "offline"
 * when apply() would succeed.
 *
 * check() probes over curl while apply() fetches over git; on machines where
 * only curl fails (curl missing from PATH, proxy configured only in git
 * config, raw/api hosts filtered while github.com is reachable, TLS
 * interception trusted by git but not curl), check() used to emit a false
 * {"status":"offline"} seconds before a successful apply. The fix falls back
 * to `git ls-remote --tags` — apply()'s transport — before declaring offline.
 *
 * The tag-parsing half is a pure export (highestSemverTag), tested
 * behaviorally. The wiring inside check()/curlGet() is ROOT-bound with
 * subprocess side effects, so it is verified by source-pattern assertions —
 * the updater test convention for such paths (see
 * updater-rollback-behavior.test.mjs's header note).
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { pass, fail } from './helpers.mjs';
import { highestSemverTag, SEMVER_RE } from '../update-system.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

console.log('\n🧪 Testing update-check git fallback...');

// ── highestSemverTag: release-please tag shape ──────────────────────────
{
  const out = [
    'aaaa\trefs/tags/career-ops-v1.3.0',
    'bbbb\trefs/tags/career-ops-v1.25.0',
    'cccc\trefs/tags/career-ops-v1.9.0',
  ].join('\n');
  if (highestSemverTag(out) === '1.25.0') {
    pass('highestSemverTag picks the semver-highest release-please tag (1.25.0 > 1.9.0, not lexical)');
  } else {
    fail(`highestSemverTag release-please shape = ${JSON.stringify(highestSemverTag(out))}`);
  }
}

// ── peeled refs and non-semver tags ─────────────────────────────────────
{
  const out = [
    'aaaa\trefs/tags/career-ops-v1.24.0',
    'bbbb\trefs/tags/career-ops-v1.24.0^{}',
    'cccc\trefs/tags/snapshot-before-migration',
    'dddd\trefs/tags/v20260801',
  ].join('\n');
  if (highestSemverTag(out) === '1.24.0') {
    pass('highestSemverTag collapses peeled ^{} refs and ignores non-semver tags');
  } else {
    fail(`highestSemverTag peeled/non-semver = ${JSON.stringify(highestSemverTag(out))}`);
  }
}

// ── monorepo tag pollution: the prefix filter is load-bearing ───────────
// Upstream is a release-please monorepo (career-ops-v*, web-v*,
// manifesto-v*, historical bare tags). Without the prefix filter, the
// first foreign tag to exceed career-ops' version would be reported as
// the career-ops remote — a permanent false update-available on exactly
// the curl-blocked machines the fallback serves.
{
  const out = [
    'aaaa\trefs/tags/career-ops-v1.25.0',
    'bbbb\trefs/tags/web-v9.9.9',
    'cccc\trefs/tags/manifesto-v8.0.0',
    'dddd\trefs/tags/backup-pre-update-9.9.8',
    'eeee\trefs/tags/v7.7.7',
  ].join('\n');
  if (highestSemverTag(out, 'career-ops-v') === '1.25.0') {
    pass('highestSemverTag("career-ops-v") ignores foreign monorepo components with higher versions');
  } else {
    fail(`highestSemverTag monorepo pollution = ${JSON.stringify(highestSemverTag(out, 'career-ops-v'))}`);
  }
  if (highestSemverTag('aaaa\trefs/tags/web-v9.9.9', 'career-ops-v') === '') {
    pass('highestSemverTag("career-ops-v") returns "" when only foreign tags exist (reachable ≠ has releases)');
  } else {
    fail('highestSemverTag prefix-only-foreign case failed');
  }
}

// ── plain v-prefixed and bare tags (SEMVER_RE's shapes, unfiltered mode) ─
{
  if (highestSemverTag('aaaa\trefs/tags/v2.0.0\nbbbb\trefs/tags/1.9.9') === '2.0.0') {
    pass('highestSemverTag (no prefix) accepts plain v-prefixed and bare semver tags');
  } else {
    fail('highestSemverTag plain-tag shapes failed');
  }
}

// ── CRLF-translated wrapper output ──────────────────────────────────────
{
  if (highestSemverTag('aaaa\trefs/tags/career-ops-v1.25.0\r\nbbbb\trefs/tags/career-ops-v1.24.0\r', 'career-ops-v') === '1.25.0') {
    pass('highestSemverTag strips a trailing \\r so CRLF-translated output still matches');
  } else {
    fail('highestSemverTag CRLF hardening failed');
  }
}

// ── degenerate inputs ───────────────────────────────────────────────────
{
  const empties = [highestSemverTag(''), highestSemverTag(null), highestSemverTag('garbage no tabs')];
  if (empties.every((v) => v === '')) {
    pass('highestSemverTag returns "" on empty/null/tag-less input');
  } else {
    fail(`highestSemverTag degenerate inputs = ${JSON.stringify(empties)}`);
  }
}

// ── SEMVER_RE anchor sanity: the shapes above depend on (?:^|-) ─────────
{
  if (SEMVER_RE.test('career-ops-v1.25.0') && SEMVER_RE.test('v1.2.3') && !SEMVER_RE.test('v1.2.3-beta')) {
    pass('SEMVER_RE anchors release-please and plain tags, rejects suffixed prereleases');
  } else {
    fail('SEMVER_RE anchor expectations changed — revisit highestSemverTag');
  }
}

// ── source-pattern wiring assertions ────────────────────────────────────
{
  const src = readFileSync(join(ROOT, 'update-system.mjs'), 'utf-8');

  if (/if \(bothNetworkFailed\)\s*\{\s*gitProbe = gitRemoteVersion\(\)/.test(src)) {
    pass('check() consults gitRemoteVersion() only inside the both-curls-failed guard (never on the parseable-failure path)');
  } else {
    fail('the git fallback is no longer gated on bothNetworkFailed — it must not run on the no-remote-version path');
  }

  if (/ls-remote', '--tags', CANONICAL_REPO/.test(src) && /highestSemverTag\(out, 'career-ops-v'\)/.test(src)) {
    pass('gitRemoteVersion() queries CANONICAL_REPO over git and filters to the career-ops-v tag prefix');
  } else {
    fail('gitRemoteVersion() lost the CANONICAL_REPO query or the career-ops-v prefix filter (monorepo tag pollution)');
  }

  if (/GIT_TERMINAL_PROMPT: '0'/.test(src)) {
    pass('the ls-remote probe suppresses interactive credential prompts (GIT_TERMINAL_PROMPT=0)');
  } else {
    fail('GIT_TERMINAL_PROMPT=0 missing — a captive portal can pop a GUI prompt from a silent check');
  }

  if (/payload\.detail = `curl VERSION: /.test(src) && /git ls-remote reachable but returned no career-ops release tags/.test(src)) {
    pass('offline/no-remote-version JSON distinguishes git-failed from git-reachable-but-tagless in detail');
  } else {
    fail('detail field no longer distinguishes git transport failure from a tagless remote');
  }

  if (/console\.log\(JSON\.stringify\(payload\)\);\s*return;/.test(src)) {
    pass('the offline/no-remote-version branch returns after emitting — single-JSON-line contract holds');
  } else {
    fail('the offline branch no longer returns immediately — check may emit two JSON lines');
  }

  if (/function curlGet[\s\S]{0,1400}?catch \((?:error|err)\)\s*\{\s*resolve\(\{ ok: false/.test(src)) {
    pass('curlGet() catches synchronous execFile throws (broken curl on PATH: spawn EFTYPE) instead of crashing check()');
  } else {
    fail('curlGet() no longer guards the synchronous execFile throw path');
  }
}
