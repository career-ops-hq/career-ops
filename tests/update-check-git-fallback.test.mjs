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

// ── plain v-prefixed and bare tags (SEMVER_RE's other accepted shapes) ──
{
  if (highestSemverTag('aaaa\trefs/tags/v2.0.0\nbbbb\trefs/tags/1.9.9') === '2.0.0') {
    pass('highestSemverTag accepts plain v-prefixed and bare semver tags');
  } else {
    fail('highestSemverTag plain-tag shapes failed');
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

  if (/bothNetworkFailed[\s\S]{0,80}?remote = gitRemoteVersion\(\)/.test(src)) {
    pass('check() consults gitRemoteVersion() on the both-curls-failed path before reporting offline');
  } else {
    fail('check() no longer falls back to gitRemoteVersion() when both curl probes fail');
  }

  if (/ls-remote', '--tags', CANONICAL_REPO/.test(src)) {
    pass('gitRemoteVersion() queries CANONICAL_REPO over git — the same transport apply() uses');
  } else {
    fail('gitRemoteVersion() does not query CANONICAL_REPO via ls-remote');
  }

  if (/payload\.detail = `curl VERSION: /.test(src)) {
    pass('offline JSON carries a detail field with the curl failure reasons');
  } else {
    fail('offline JSON detail field missing — offline reports are undiagnosable again');
  }

  const curlGetSrc = src.slice(src.indexOf('function curlGet'), src.indexOf('export function highestSemverTag'));
  if (/try\s*\{[\s\S]*execFile\(/.test(curlGetSrc) && /catch \(error\)\s*\{\s*resolve\(\{ ok: false/.test(curlGetSrc)) {
    pass('curlGet() catches synchronous execFile throws (broken curl on PATH: spawn EFTYPE) instead of crashing check()');
  } else {
    fail('curlGet() no longer guards the synchronous execFile throw path');
  }
}
