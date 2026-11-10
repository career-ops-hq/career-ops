// @ts-check
// lib/templates-registry.mjs — the curated template-pack registry (the trust
// root), the analog of plugins/_registry.mjs. Pure, side-effect-free import
// (node:fs only). The registry is a SYSTEM-layer area: an entry exists only
// because a maintainer reviewed and merged it at an exact pinned commit.
//
// Storage: one file per pack under templates-registry/<id>.json. Each PR adds
// or bumps its own file, so two registry PRs never touch the same lines and
// can merge in any order.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

export const KINDS = ['cv', 'cover'];
export const NAME_PREFIX = 'career-ops-template-';
// Exactly owner/repo: no query, fragment, trailing slash or deeper path.
// "." and ".." are rejected as segments: URL normalization would resolve them
// away from owner/repo.
export const REPO_RE = /^https:\/\/github\.com\/(?!\.{1,2}\/)[A-Za-z0-9_.-]+\/(?!\.{1,2}$)[A-Za-z0-9_.-]+$/;

export function registryDirPath(root) {
  return path.join(root, 'templates-registry');
}

/**
 * Read every entry file in templates-registry/, with its filename (so callers
 * like the validator can enforce filename === "<id>.json"). A malformed file
 * yields a null entry but keeps its filename for reporting.
 * @returns {Array<{file: string, entry: any}>}
 */
export function loadRegistryFiles(root) {
  const dir = registryDirPath(root);
  if (!existsSync(dir)) return [];
  const out = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    let entry = null;
    try { entry = JSON.parse(readFileSync(path.join(dir, file), 'utf8')); } catch { /* reported by the validator */ }
    out.push({ file, entry });
  }
  return out;
}

/** Load the curated registry. An absent directory is an empty registry. */
export function loadRegistry(root) {
  const packs = loadRegistryFiles(root)
    .map(({ entry }) => entry)
    .filter((e) => e && typeof e === 'object' && !Array.isArray(e));
  return { registryVersion: 1, packs };
}

/**
 * Validate one registry entry's shape. Returns an array of problems (empty =
 * valid). `idRe` is passed in so the module stays free of policy constants.
 */
export function validateRegistryEntry(e, { idRe }) {
  const errs = [];
  if (typeof e.name !== 'string' || !e.name.startsWith(NAME_PREFIX)) errs.push(`name must start with "${NAME_PREFIX}"`);
  if (typeof e.id !== 'string' || !idRe.test(e.id)) errs.push('invalid id');
  if (e.name && e.id && e.name !== `${NAME_PREFIX}${e.id}`) errs.push(`name must equal ${NAME_PREFIX}<id>`);
  // typeof first: RegExp.test coerces, so a one-element array holding a valid
  // URL or sha would otherwise pass.
  if (typeof e.repo !== 'string' || !REPO_RE.test(e.repo)) errs.push('repo must be a https://github.com/<owner>/<repo> URL');
  // The installer requires the repo to be named for the pack id, so a mismatch
  // is caught here at registration rather than at every install.
  else if (typeof e.id === 'string' && e.repo.replace(/\.git$/, '').split('/').pop() !== `${NAME_PREFIX}${e.id}`) errs.push(`repo name must equal ${NAME_PREFIX}<id>`);
  if (typeof e.sha !== 'string' || !/^[0-9a-f]{40}$/.test(e.sha)) errs.push('sha must be a 40-hex commit');
  if (!Array.isArray(e.kind) || e.kind.length === 0 || e.kind.some((k) => !KINDS.includes(k))) errs.push(`kind must be a non-empty subset of ${JSON.stringify(KINDS)}`);
  if (!Number.isInteger(e.themes) || e.themes < 1) errs.push('themes must be a positive integer');
  if (typeof e.ats !== 'boolean') errs.push('ats must be a boolean');
  if (typeof e.license !== 'string' || !e.license) errs.push('license is required');
  if (typeof e.version !== 'string' || !e.version) errs.push('version is required');
  return errs;
}
