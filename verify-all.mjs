#!/usr/bin/env node

/**
 * verify-all.mjs — every pre-send check on one candidate-facing file, one command.
 *
 * Runs the gates that already exist, then adds one that does not:
 *   - facts: verify-cv-facts.mjs (child process, same exit code)
 *   - ats:   verify-ats.mjs, for .html files only
 *   - voice: cv-voice.mjs against cv.md and the candidate's own words; skipped
 *            when the file is cv.md itself, since it is the source
 *   - --links: every http(s) URL in the file answers. A 4xx/5xx or no answer
 *            fails; linkedin.com only warns, because it refuses scripts. When
 *            the file links a github.com/<user> profile and `gh` is signed in,
 *            it also warns about repos the file names that are not pinned
 *            there. Without `gh` that step says so and is skipped.
 *
 * Usage:
 *   node verify-all.mjs cv.md
 *   node verify-all.mjs output/cv-acme.html --links
 *   node verify-all.mjs --self-test
 *
 * Exit 0 when every check passes, 1 when one fails, 2 on a usage error.
 * Warnings never fail. Read-only: it writes nothing.
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isMainModule } from './lib/is-main-module.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { candidateOwnWords, voiceDashWarning, voiceIssues, voiceTellMessage } from './cv-voice.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOFT_HOSTS = /(^|\.)linkedin\.com$/i;

/**
 * Every http(s) URL in the file, plus bare www./github.com/linkedin.com/gitlab.com
 * links. A generic bare-domain match would read "node.js" as a site, so bare
 * links are limited to hosts a CV actually writes without a scheme.
 * @param {string} text
 * @returns {string[]}
 */
export function extractUrls(text) {
  const out = new Set();
  const trim = (u) => u.replace(/&amp;/g, '&').replace(/[.,;:!?)\]'"]+$/, '');
  for (const m of text.matchAll(/https?:\/\/[^\s<>"'`)\]]+/gi)) out.add(trim(m[0]));
  const plain = text.replace(/<[^>]+>/g, ' ').replace(/https?:\/\/\S+/gi, ' ').replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, ' ');
  for (const m of plain.matchAll(/(?<![\w./-])(?:www\.[a-z0-9-]+(?:\.[a-z0-9-]+)+|(?:github|gitlab|linkedin)\.com)(?:\/[^\s<>"'`)\]]*)?/gi)) {
    out.add(`https://${trim(m[0])}`);
  }
  return [...out];
}

/**
 * Loopback, private and link-local hosts are not checked: a CV has no reason
 * to link one, and fetching it would probe the user's own network.
 * @param {string} url
 * @returns {boolean}
 */
export function isPrivateHost(url) {
  let host;
  try { host = new URL(url).hostname.replace(/^\[|\]$/g, '').toLowerCase(); } catch { return true; }
  return host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')
    || /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)
    || host === '::1' || /^f[cd]|^fe80:/.test(host);
}

/**
 * Repos the text names (as whole words) that are not pinned.
 * @param {string} text
 * @param {string[]} publicRepos
 * @param {string[]} pinned
 * @returns {string[]}
 */
export function unpinnedNamed(text, publicRepos, pinned) {
  const words = new Set(text.replace(/<[^>]+>/g, ' ').toLowerCase().match(/[a-z0-9._-]+/g) || []);
  const pin = new Set(pinned.map((r) => r.toLowerCase()));
  return publicRepos.filter((r) => r && words.has(r.toLowerCase()) && !pin.has(r.toLowerCase()));
}

function runGate(script, args) {
  const r = spawnSync(process.execPath, [join(HERE, script), ...args], { stdio: 'inherit' });
  return r.status === 0;
}

function checkVoice(path, text, root) {
  const cvPath = join(root, 'cv.md');
  // Real paths: a symlinked root (macOS /var -> /private/var) is still the same file.
  if (existsSync(cvPath) && realpathSync(path) === realpathSync(cvPath)) {
    console.log('Voice: skipped, the file is the source cv.md');
    return true;
  }
  const source = existsSync(cvPath) ? readFileSync(cvPath, 'utf8') : '';
  const found = voiceIssues(text, `${source}\n${candidateOwnWords(root)}`);
  const label = basename(path);
  const dash = voiceDashWarning(found, label);
  if (dash) console.log(`  [warn] ${dash}`);
  const tell = voiceTellMessage(found, label);
  if (tell) { console.log(`  [fail] ${tell}`); return false; }
  console.log('Voice: passed');
  return true;
}

async function checkLinks(urls) {
  let dead = 0;
  for (const u of urls) {
    if (isPrivateHost(u)) { console.log(`  [info] not checked (private or local host): ${u}`); continue; }
    let status = 'no answer';
    try {
      const res = await fetch(u, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (career-ops verify-all)' }, signal: AbortSignal.timeout(15000) });
      status = res.status;
    } catch { /* reported below */ }
    if (typeof status === 'number' && status < 400) continue;
    const soft = SOFT_HOSTS.test(new URL(u).hostname);
    if (!soft) dead++;
    console.log(`  [${soft ? 'warn' : 'fail'}] ${u}: ${status}`);
  }
  console.log(dead ? `Links: ${dead} dead of ${urls.length}` : `Links: ${urls.length} checked, none dead`);
  return dead === 0;
}

function checkPinned(text, urls) {
  const m = urls.map((u) => u.match(/^https:\/\/(?:www\.)?github\.com\/([A-Za-z0-9-]+)\/?$/i)).find(Boolean);
  if (!m) return;
  const user = m[1];
  const gh = (args) => {
    const r = spawnSync('gh', args, { encoding: 'utf8' });
    return r.status === 0 ? r.stdout.split('\n').filter(Boolean) : null;
  };
  // Public repos only: a private repo cannot be pinned for a reader anyway.
  const repos = gh(['repo', 'list', user, '--visibility', 'public', '--json', 'name', '--limit', '200', '--jq', '.[].name']);
  const pinned = gh(['api', 'graphql', '-f', `query={ user(login:"${user}"){ pinnedItems(first:6){ nodes{ ... on Repository { name } } } } }`, '--jq', '.data.user.pinnedItems.nodes[].name']);
  if (repos === null || pinned === null) { console.log('  [info] gh missing or not signed in; pinned-repo check skipped'); return; }
  const missing = unpinnedNamed(text, repos, pinned);
  if (missing.length) console.log(`  [warn] named in the file but not pinned on github.com/${user}: ${missing.join(', ')}`);
  else console.log(`Pinned: every public repo the file names is pinned on github.com/${user}`);
}

function selfTest() {
  const eq = (got, want, what) => {
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      console.error(`self-test failed (${what}): got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
      process.exit(1);
    }
  };
  eq(extractUrls('<a href="https://x.dev/a?b=1&amp;c=2">site</a>. See linkedin.com/in/jo and github.com/Jo, mail j@x.com, built with node.js (https://jo.github.io).'),
    ['https://x.dev/a?b=1&c=2', 'https://jo.github.io', 'https://linkedin.com/in/jo', 'https://github.com/Jo'], 'extractUrls');
  eq([isPrivateHost('http://localhost:3000'), isPrivateHost('http://192.168.1.4/x'), isPrivateHost('https://example.com')], [true, true, false], 'isPrivateHost');
  eq(unpinnedNamed('Built rootcause and litmus. Also mention-me.', ['rootcause', 'litmus', 'other'], ['Litmus']), ['rootcause'], 'unpinnedNamed');
  console.log('verify-all self-test passed');
}

async function main(args) {
  if (args.includes('--self-test')) { selfTest(); return 0; }
  const unknown = args.filter((a) => a.startsWith('--') && a !== '--links');
  const files = args.filter((a) => !a.startsWith('--'));
  if (unknown.length || files.length !== 1) {
    console.error('Usage: node verify-all.mjs <cv.md|generated.html> [--links]\n       node verify-all.mjs --self-test');
    return 2;
  }
  const path = isAbsolute(files[0]) ? files[0] : resolve(process.cwd(), files[0]);
  if (!existsSync(path)) { console.error(`ERROR: file not found: ${files[0]}`); return 2; }
  const text = readFileSync(path, 'utf8');
  const root = getCareerOpsRoot();
  let ok = true;

  console.log('== facts'); ok = runGate('verify-cv-facts.mjs', [path]) && ok;
  if (/\.html?$/i.test(path)) { console.log('== ats'); ok = runGate('verify-ats.mjs', [path]) && ok; }
  console.log('== voice'); ok = checkVoice(path, text, root) && ok;
  if (args.includes('--links')) {
    console.log('== links');
    const urls = extractUrls(text);
    ok = (await checkLinks(urls)) && ok;
    checkPinned(text, urls);
  }

  console.log(ok ? `\nAll checks passed: ${files[0]}` : `\nChecks failed: ${files[0]}`);
  return ok ? 0 : 1;
}

if (isMainModule(import.meta.url)) {
  // exitCode, not exit(): lets buffered stdout drain first.
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
