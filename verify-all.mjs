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
 *            fails; linkedin.com only warns, because it refuses scripts. Each
 *            request carries the same egress guard as lib/jd-page-fetch.mjs:
 *            redirects are followed by hand, and every hop is checked as a
 *            literal, by a DNS pre-check, and again at connect time, so a link
 *            that resolves or redirects to a private address is never dialled.
 *            When
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
import { isIP } from 'node:net';
import { basename, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isMainModule } from './lib/is-main-module.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { resolveUserPath } from './keyword-match.mjs';
import { isBlockedAddress } from './providers/_ip-guard.mjs';
import { candidateOwnWords, voiceDashWarning, voiceIssues, voiceTellMessage } from './cv-voice.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOFT_HOSTS = /(^|\.)linkedin\.com$/i;
const MAX_REDIRECTS = 5;
const LINK_TIMEOUT_MS = 15000;

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
 *
 * This is the literal check only. Address ranges apply to IP literals, so a
 * public name that merely starts like one (fcc.gov, fdic.gov, 127.example.com)
 * is still checked; a name that resolves to a private address is caught by the
 * DNS pre-check and the connect-time guard in guardedStatus().
 * @param {string} url
 * @returns {boolean}
 */
export function isPrivateHost(url) {
  let host;
  try { host = new URL(url).hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase(); } catch { return true; }
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === 'localhost.localdomain') return true;
  return isIP(host) !== 0 && isBlockedAddress(host);
}

/**
 * Repos the text names (as whole words) that are not pinned.
 * @param {string} text
 * @param {string[]} publicRepos
 * @param {string[]} pinned
 * @returns {string[]}
 */
export function unpinnedNamed(text, publicRepos, pinned) {
  const words = new Set();
  for (const w of text.replace(/<[^>]+>/g, ' ').toLowerCase().match(/[a-z0-9._-]+/g) || []) {
    words.add(w);
    // "rootcause." ends a sentence: also try the word without the punctuation
    // around it, keeping inner dots and hyphens (my.repo, litmus-x).
    words.add(w.replace(/^[._-]+|[._-]+$/g, ''));
  }
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

/**
 * Status of one link, through the egress guard lib/jd-page-fetch.mjs uses:
 * redirects followed by hand (at most MAX_REDIRECTS), and on every hop the
 * literal check, the DNS pre-check (validateUrlSecurity) and the connect-time
 * dns.lookup guard (providerFetchContext), so a name that answers
 * public-then-private is refused at the socket, not only at the pre-check.
 *
 * @param {string} url
 * @param {{validateUrlSecurity: Function, providerFetchContext: import('node:async_hooks').AsyncLocalStorage}} guard
 * @returns {Promise<{status: number|string}|{blocked: string}>}
 */
async function guardedStatus(url, guard) {
  const signal = AbortSignal.timeout(LINK_TIMEOUT_MS);
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (isPrivateHost(current)) return { blocked: hop ? `redirects to a private or local host (${current})` : 'private or local host' };
    try {
      await guard.validateUrlSecurity(current);
    } catch (err) {
      // A name with no address is dead for a reader too, so it fails. A DNS
      // filter's 0.0.0.0 answer and a real private address are not dialled.
      if (err?.livenessCode === 'dns_no_addresses') return { status: 'no answer (the name does not resolve)' };
      const why = err?.livenessCode === 'dns_sinkhole' ? 'blocked by a DNS filter' : 'resolves to a private address';
      return { blocked: hop ? `redirects to ${current}, which ${why === 'blocked by a DNS filter' ? 'is ' : ''}${why}` : why };
    }
    const targetHost = new URL(current).hostname.replace(/^\[|\]$/g, '');
    let res;
    try {
      res = await guard.providerFetchContext.run({ url: current, targetHost }, async () => {
        const r = await fetch(current, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (career-ops verify-all)' }, signal });
        await r.body?.cancel().catch(() => {});
        return r;
      });
    } catch {
      return { status: 'no answer' };
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) return { status: res.status };
      try { current = new URL(location, current).href; } catch { return { status: `${res.status} to an invalid location` }; }
      continue;
    }
    return { status: res.status };
  }
  return { status: `more than ${MAX_REDIRECTS} redirects` };
}

async function checkLinks(urls) {
  // Malformed links need no network, so they fail even when the checks below
  // are skipped.
  let dead = 0;
  const valid = [];
  for (const u of urls) {
    try { new URL(u); valid.push(u); } catch {
      dead++;
      console.log(`  [fail] ${u}: not a valid URL`);
    }
  }
  const skipped = (why) => {
    console.log(`  [info] links not checked: ${why}`);
    console.log(dead ? `Links: ${dead} dead of ${urls.length} (the rest not checked)` : `Links: none checked`);
    return dead === 0;
  };
  // The connect-time guard lives in the patched dns.lookup, so the patch has
  // to be in place, and a fetch through an untrusted HTTP proxy would hide the
  // destination from it: fail closed in both cases, as jd-page-fetch does.
  const { dnsLookupPatched } = await import('./providers/_dns-cache.mjs');
  const { providerFetchContext } = await import('./providers/_ip-guard.mjs');
  const { validateUrlSecurity } = await import('./liveness-browser.mjs');
  if (!dnsLookupPatched()) return skipped('the connect-time address guard is off (CAREER_OPS_NO_DNS_CACHE)');
  if (/^(1|true)$/i.test(process.env.NODE_USE_ENV_PROXY ?? '') && process.env.CAREER_OPS_TRUST_PROXY_EGRESS !== '1') {
    return skipped('NODE_USE_ENV_PROXY is set without CAREER_OPS_TRUST_PROXY_EGRESS=1');
  }
  const guard = { validateUrlSecurity, providerFetchContext };
  for (const u of valid) {
    const hostname = new URL(u).hostname;
    const result = await guardedStatus(u, guard);
    if (result.blocked) { console.log(`  [info] not checked (${result.blocked}): ${u}`); continue; }
    const { status } = result;
    if (typeof status === 'number' && status < 400) continue;
    const soft = SOFT_HOSTS.test(hostname);
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
  eq([isPrivateHost('http://localhost:3000'), isPrivateHost('http://192.168.1.4/x'), isPrivateHost('https://example.com'), isPrivateHost('https://fcc.gov')], [true, true, false, false], 'isPrivateHost');
  eq(unpinnedNamed('Built litmus and rootcause. Also mention-me.', ['rootcause', 'litmus', 'other'], ['Litmus']), ['rootcause'], 'unpinnedNamed');
  console.log('verify-all self-test passed');
}

const USAGE = `Usage: node verify-all.mjs <cv.md|generated.html> [--links]
       node verify-all.mjs --self-test

  --links      also check that every http(s) link answers, and warn about
               repos the file names that are not pinned on the linked GitHub profile
  --self-test  run the built-in checks and exit
  -h, --help   show this help

A bare relative path names a file in the data root; ./ or ../ means the working directory.
Exit 0 when every check passes, 1 when one fails, 2 on a usage error.`;

async function main(args) {
  if (args.includes('--help') || args.includes('-h')) { console.log(USAGE); return 0; }
  if (args.includes('--self-test')) { selfTest(); return 0; }
  const unknown = args.filter((a) => a.startsWith('-') && a !== '--links');
  const files = args.filter((a) => !a.startsWith('-'));
  if (unknown.length || files.length !== 1) {
    console.error(USAGE);
    return 2;
  }
  // A bare relative path names a file in the data root (output/cv-acme.html),
  // which can live outside the checkout; ./ or ../ names the working directory.
  const root = getCareerOpsRoot();
  const path = resolveUserPath(files[0], root);
  if (!existsSync(path)) { console.error(`ERROR: file not found: ${path}`); return 2; }
  const text = readFileSync(path, 'utf8');
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
