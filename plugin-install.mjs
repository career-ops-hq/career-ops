#!/usr/bin/env node
// @ts-check
// plugin-install.mjs — clone/scaffold/validate community plugins. Lives at repo
// ROOT (not under plugins/) because it uses node:child_process to run git, which
// test-all's plugin deny-list forbids inside plugins/. Imported by plugins.mjs.
//
// Security (the clone-time-RCE class): git is spawned via execFileSync with an
// ARRAY argv (never a shell string), the URL is strict-allowlisted to
// https://github.com/<owner>/<repo>, alternate transports are disabled
// (protocol.ext/file allow=never), and the EXACT commit SHA is fetched + checked
// out (a moved tag or force-push cannot substitute different code).

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, cpSync, readdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateManifest } from './plugins/_engine.mjs';
import { hashPluginTree } from './plugins/_lock.mjs';
import { auditPlugin } from './plugin-audit.mjs';

const GITHUB_URL_RE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?(?:\.git)?$/;
const NAME_RE = /^career-ops-plugin-([a-z0-9][a-z0-9-]*)$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const MIN_FILES = ['manifest.json', 'index.mjs', 'README.md', 'LICENSE'];

/** Normalize `owner/repo` | full URL into a validated github URL + the plugin id. */
export function parseRepoArg(arg) {
  let url = arg;
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(arg)) url = `https://github.com/${arg}`;
  url = url.replace(/\.git$/, '');
  if (!GITHUB_URL_RE.test(url)) throw new Error(`refusing non-GitHub/unsafe repo URL: ${arg} (expected https://github.com/<owner>/<repo>)`);
  const repoName = url.split('/').pop() || '';
  const m = NAME_RE.exec(repoName);
  if (!m) throw new Error(`repo must be named "career-ops-plugin-<name>" (got "${repoName}")`);
  return { url, id: m[1] };
}

/** Clone the EXACT pinned SHA into a fresh temp dir. Returns the temp dir path. */
export function safeClone(url, sha) {
  if (!SHA_RE.test(sha || '')) throw new Error(`a 40-hex commit --sha is required (got ${JSON.stringify(sha)})`);
  const dir = mkdtempSync(path.join(tmpdir(), 'co-plugin-'));
  const git = (...args) => execFileSync('git', ['-c', 'protocol.ext.allow=never', '-c', 'protocol.file.allow=never', ...args], { stdio: ['ignore', 'ignore', 'pipe'], timeout: 120_000 });
  try {
    git('-C', dir, 'init', '-q');
    git('-C', dir, 'remote', 'add', 'origin', '--', url);
    git('-C', dir, 'fetch', '--depth', '1', '--no-tags', '-q', 'origin', sha);
    git('-C', dir, 'checkout', '-q', 'FETCH_HEAD');
    rmSync(path.join(dir, '.git'), { recursive: true, force: true }); // drop VCS metadata (and any hooks)
    return dir;
  } catch (err) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`clone of ${url}@${sha.slice(0, 10)} failed — ${err.stderr ? String(err.stderr).slice(0, 200) : err.message}`);
  }
}

/** Check the minimum file set + a valid manifest whose id matches `expectId`. */
export function validateInstall(dir, expectId) {
  const problems = [];
  for (const f of MIN_FILES) if (!existsSync(path.join(dir, f))) problems.push(`missing required file: ${f}`);
  if (problems.length) return { ok: false, problems, manifest: null };
  let parsed;
  try { parsed = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')); }
  catch (e) { return { ok: false, problems: [`manifest.json invalid JSON: ${e.message}`], manifest: null }; }
  // validateManifest wants the dir to BE the plugin dir + the basename to equal id.
  const tmpNamed = path.join(path.dirname(dir), expectId);
  if (dir !== tmpNamed) { try { renameSync(dir, tmpNamed); dir = tmpNamed; } catch { /* validate in place using expectId */ } }
  const manifest = validateManifest(parsed, dir, expectId);
  if (!manifest) return { ok: false, problems: ['manifest failed validation (see ⚠️ above)'], manifest: null, dir };
  const audit = auditPlugin(dir);
  if (!audit.ok) return { ok: false, problems: audit.findings.map(f => `${f.file}: ${f.issue}`), manifest, dir };
  return { ok: true, problems: [], manifest, dir };
}

/**
 * Install a community plugin from a github repo at a pinned SHA into
 * plugins.local/<id>. Returns { id, manifest, integrity, dir } WITHOUT enabling
 * it (the caller runs the consent gate). Throws on any validation failure.
 */
export function installFromRepo(root, { url, sha }) {
  const { url: safeUrl, id } = parseRepoArg(url);
  const dest = path.join(root, 'plugins.local', id);
  if (existsSync(dest)) throw new Error(`plugins.local/${id} already exists — \`node plugins.mjs remove ${id}\` first`);
  let cloned = safeClone(safeUrl, sha);
  let result;
  try { result = validateInstall(cloned, id); }
  catch (e) { rmSync(cloned, { recursive: true, force: true }); throw e; }
  if (!result.ok) {
    rmSync(result.dir || cloned, { recursive: true, force: true });
    throw new Error(`plugin rejected:\n  - ${result.problems.join('\n  - ')}`);
  }
  mkdirSync(path.join(root, 'plugins.local'), { recursive: true });
  cpSync(result.dir, dest, { recursive: true });
  rmSync(result.dir, { recursive: true, force: true });
  const tree = hashPluginTree(dest);
  return { id, manifest: { ...result.manifest, dir: dest }, integrity: tree.integrity, files: tree.files, repo: safeUrl, sha };
}

/**
 * Clone + statically validate a registry entry WITHOUT installing it (used by
 * the registry-validate CI). Executes NO plugin code — manifest is parsed, the
 * audit is static. Returns problems (empty = clean).
 * @returns {string[]}
 */
export function auditRegistryEntry(url, sha, expectId) {
  let parsed;
  try { parsed = parseRepoArg(url); } catch (e) { return [e.message]; }
  if (expectId && parsed.id !== expectId) return [`repo "${url}" → id "${parsed.id}" but registry id is "${expectId}"`];
  let dir;
  try { dir = safeClone(parsed.url, sha); } catch (e) { return [e.message]; }
  let result;
  try { result = validateInstall(dir, parsed.id); }
  catch (e) { rmSync(dir, { recursive: true, force: true }); return [e.message]; }
  try { rmSync(result.dir || dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  return result.ok ? [] : result.problems;
}

/** Scaffold a new local plugin from plugins/_template/. */
export function scaffoldNew(root, name) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error(`plugin name must match [a-z0-9-] (got "${name}")`);
  const tpl = path.join(root, 'plugins', '_template');
  if (!existsSync(tpl)) throw new Error('plugins/_template/ not found');
  const dest = path.join(root, 'plugins.local', name);
  if (existsSync(dest)) throw new Error(`plugins.local/${name} already exists`);
  mkdirSync(path.join(root, 'plugins.local'), { recursive: true });
  cpSync(tpl, dest, { recursive: true });
  // Substitute {{NAME}} placeholders in shipped text files.
  const sub = (p) => { if (existsSync(p)) writeFileSync(p, readFileSync(p, 'utf8').replaceAll('{{NAME}}', name), 'utf8'); };
  for (const f of readdirSync(dest, { withFileTypes: true })) {
    if (f.isFile()) sub(path.join(dest, f.name));
  }
  if (existsSync(path.join(dest, 'test'))) for (const f of readdirSync(path.join(dest, 'test'))) sub(path.join(dest, 'test', f));
  return dest;
}
