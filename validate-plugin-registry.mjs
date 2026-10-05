#!/usr/bin/env node
// @ts-check
// validate-plugin-registry.mjs — deterministic shape gate for the plugin
// registry (plugins-registry/<id>.json, one file per plugin; legacy single-file
// plugins-registry.json still validates via the loader's fallback).
// Run locally + by the registry-validate CI. Shape/uniqueness only (no network);
// the CI additionally clones each changed entry at its pinned SHA and runs the
// min-file + manifest + audit checks in a no-secret, read-only sandbox.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadRegistry, loadRegistryFiles, validateRegistryEntry } from './plugins/_registry.mjs';
import { HOOK_KINDS, RESERVED_ENV } from './plugins/_engine.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

/** @returns {string[]} problems (empty = valid) */
export function validateRegistry(root) {
  const reg = loadRegistry(root);
  const problems = [];
  if (reg.registryVersion !== 1) problems.push(`unsupported registryVersion ${JSON.stringify(reg.registryVersion)}`);
  // Per-plugin-file invariants: every file parses, and the filename equals the
  // entry's id — the filename IS the conflict-free uniqueness guarantee (two
  // plugins can't claim one id without touching the same file).
  for (const { file, entry } of loadRegistryFiles(root)) {
    if (!entry || typeof entry !== 'object') { problems.push(`${file}: not a JSON object`); continue; }
    if (entry.id && `${entry.id}.json` !== file) problems.push(`${file}: filename must equal "<id>.json" (id is "${entry.id}")`);
  }
  const names = new Set(), ids = new Set();
  for (const e of reg.plugins) {
    for (const er of validateRegistryEntry(e, { idRe: ID_RE, hookKinds: HOOK_KINDS, reservedEnv: RESERVED_ENV })) {
      problems.push(`${e.name || e.id || '?'}: ${er}`);
    }
    if (e.name && names.has(e.name)) problems.push(`duplicate name: ${e.name}`);
    if (e.id && ids.has(e.id)) problems.push(`duplicate id: ${e.id}`);
    // A supersedesBundled entry must name a REAL bundled plugin (anti-typo/phantom):
    // its id has to correspond to an in-tree plugins/<id>/ before it can be granted precedence.
    if (e.supersedesBundled === true && e.id && !existsSync(path.join(root, 'plugins', e.id, 'manifest.json'))) {
      problems.push(`${e.name || e.id}: supersedesBundled names "${e.id}" but no bundled plugin (plugins/${e.id}/) exists to supersede`);
    }
    names.add(e.name); ids.add(e.id);
  }
  return problems;
}

const GITHUB_API = 'https://api.github.com';

/** `https://github.com/owner/name` → `owner/name` (the API path segment). */
function repoSlug(repoUrl) {
  const m = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(String(repoUrl || ''));
  if (!m) throw new Error(`unparseable repo URL: ${JSON.stringify(repoUrl)}`);
  return m[1];
}

/** GET a GitHub API URL. null on 404 (the caller decides what an absence means), throws otherwise. */
async function ghJson(url, fetchImpl = fetch) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'career-ops-registry-freshness' };
  // A token only raises the rate limit; the check works unauthenticated, which
  // is what a local run gets. The scheduled workflow passes github.token.
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetchImpl(url, { headers });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

/**
 * Resolve a repo's latest PUBLISHED release to the commit it points at, or
 * null when the repo has published none. Throws on any other failure.
 *
 * The release commit is the comparison target, not the default branch: a pin
 * tracks releases, and HEAD normally carries unreleased commits (dependency
 * bumps, CI edits) that no user of the plugin has ever run. Resolved via
 * /commits/<tag> so an ANNOTATED tag yields the commit it wraps rather than
 * the tag object's own SHA.
 *
 * A 404 from the releases endpoint is AMBIGUOUS and must not be taken at face
 * value: it is returned both by a repo that has published nothing and by a repo
 * that is deleted or private. (A repo that was merely RENAMED or transferred
 * still answers, with a 301 that fetch follows, so it is not part of this case
 * — one registry entry reaches its plugin that way today.) Only the second
 * request below tells the two apart, and only a SUCCESSFUL one proves the
 * absence is real: anything else means "could not tell", which is an error
 * rather than an absence. The cost is one extra request on the 404 path only,
 * so a repo that has a release never pays it.
 *
 * Note this reports no-release for a repo whose only releases are drafts or
 * prereleases, since /releases/latest excludes both. That is the wanted answer:
 * there is no published release for a pin to track.
 */
export async function fetchLatestRelease(repoUrl, { fetchImpl = fetch } = {}) {
  const slug = repoSlug(repoUrl);
  const rel = await ghJson(`${GITHUB_API}/repos/${slug}/releases/latest`, fetchImpl);
  // Only a genuine 404 (null) is ambiguous. A 200 that somehow carries no
  // tag_name is a malformed answer, not an absence, and gets its own error
  // rather than a reachability probe it would always pass.
  if (rel === null) {
    if (!(await ghJson(`${GITHUB_API}/repos/${slug}`, fetchImpl))) {
      throw new Error(`repo not reachable (404): ${slug} — deleted or private`);
    }
    return null;
  }
  if (!rel.tag_name) throw new Error(`malformed release response for ${slug}: no tag_name`);
  const commit = await ghJson(`${GITHUB_API}/repos/${slug}/commits/${encodeURIComponent(rel.tag_name)}`, fetchImpl);
  if (!commit || !commit.sha) throw new Error(`release ${rel.tag_name} resolves to no commit`);
  return { tag: rel.tag_name, sha: commit.sha };
}

/**
 * Compare every registry pin against its plugin's latest published release.
 *
 * Statuses are deliberately four, not two: `no-release` (the author never cut
 * one) is a legitimate resting state and must not read as drift, and `error`
 * must never collapse into `fresh` — a lookup that failed is the one outcome
 * that looks identical to a clean result while proving nothing.
 *
 * @returns {Promise<Array<{id, name, repo, pinnedSha, pinnedVersion, status, releaseTag, releaseSha, detail}>>}
 */
export async function checkRegistryFreshness(root, { fetchRelease = fetchLatestRelease } = {}) {
  const out = [];
  for (const e of loadRegistry(root).plugins) {
    const row = {
      id: e.id, name: e.name, repo: e.repo,
      pinnedSha: e.sha, pinnedVersion: e.version,
      status: 'error', releaseTag: null, releaseSha: null, detail: '',
    };
    try {
      const rel = await fetchRelease(e.repo);
      if (!rel) { row.status = 'no-release'; row.detail = 'no published release to compare against'; }
      else {
        row.releaseTag = rel.tag; row.releaseSha = rel.sha;
        const same = String(rel.sha).toLowerCase() === String(e.sha).toLowerCase();
        row.status = same ? 'fresh' : 'stale';
        row.detail = same ? `pinned at ${rel.tag}` : `pin trails ${rel.tag}`;
      }
    } catch (err) {
      row.status = 'error';
      row.detail = err && err.message ? err.message : String(err);
    }
    out.push(row);
  }
  return out;
}

if (isMainModule(import.meta.url)) {
  const root = process.cwd();
  const deep = process.argv.includes('--deep');
  const problems = validateRegistry(root);
  // --deep: clone each entry at its pinned SHA + statically validate it (no
  // plugin code is executed). Used by the registry-validate CI in a sandbox.
  if (deep && problems.length === 0) {
    const { auditRegistryEntry } = await import('./plugin-install.mjs');
    const { loadRegistry } = await import('./plugins/_registry.mjs');
    for (const e of loadRegistry(root).plugins) {
      for (const p of auditRegistryEntry(e.repo, e.sha, e.id)) problems.push(`${e.name}: ${p}`);
    }
  }
  // --check-stale: compare each pin against the plugin's latest published
  // release. Runs on a SCHEDULE, not on pull_request — the event that makes a
  // pin stale (a plugin cutting a release) touches nothing in this repo, so a
  // PR-triggered check would never once fire.
  if (process.argv.includes('--check-stale') && problems.length === 0) {
    const rows = await checkRegistryFreshness(root);
    const mark = { fresh: '✓', stale: '✗', 'no-release': '–', error: '!' };
    for (const r of rows) {
      console.log(`${mark[r.status] || '?'} ${(r.id || '?').padEnd(20)} ${r.status.padEnd(11)} pin=${String(r.pinnedSha).slice(0, 10)} ${r.detail}`);
    }
    const stale = rows.filter(r => r.status === 'stale');
    const errored = rows.filter(r => r.status === 'error');
    for (const r of stale) problems.push(`${r.name || r.id}: pin ${String(r.pinnedSha).slice(0, 10)} trails release ${r.releaseTag} (${String(r.releaseSha).slice(0, 10)}) — bump plugins-registry/${r.id}.json`);
    // An unreachable repo fails the run rather than passing quietly. A check
    // that cannot see is not a check that found nothing.
    for (const r of errored) problems.push(`${r.name || r.id}: could not resolve latest release — ${r.detail}`);
  }
  if (problems.length) { for (const p of problems) console.error(`✗ ${p}`); process.exit(1); }
  console.log(`✓ plugin registry is valid${deep ? ' (deep: all entries cloned + audited)' : ''}`); process.exit(0);
}
