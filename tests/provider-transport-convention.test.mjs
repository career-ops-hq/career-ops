// tests/provider-transport-convention.test.mjs — one transport owns every
// provider's HTTP.
//
// The SSRF controls in the provider family live in exactly one place:
// providers/_http.mjs defaults `redirect` to 'error' (a 3xx could repoint a
// request at a private address after the fact), caps the body it will buffer,
// checks a literal IP before dialling, and providers/_ip-guard.mjs rejects a
// private resolved address at lookup time so DNS rebinding cannot slip past a
// pre-flight check. None of that reaches a provider that calls the global
// `fetch` itself, and nothing in the suite would notice one appearing.
//
// This is a CONVENTION check, not a proof of exploitability — the same trade as
// tests/provider-user-agent-convention.test.mjs (#3170). A provider that needs a
// different redirect policy passes it per call to ctx.fetchJson and keeps the
// transport; a provider that needs its own transport has to say so here, with a
// reason, so the next one is a review decision instead of an accident.
//
// Run:  node --test tests/provider-transport-convention.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeMask } from './helpers.mjs';
import { fetchJson } from '../providers/_http.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PROVIDERS_DIR = join(ROOT, 'providers');
const TRANSPORT = '_http.mjs';

/**
 * Files allowed to reach the network without the shared transport.
 *
 * The transport itself, because it is the implementation. Anything else added
 * here needs a stated reason, the same rule the user-agent guard applies: an
 * allowlist without reasons is a hardcode wearing a different hat.
 */
const EXEMPT = new Set([TRANSPORT]);

/**
 * `fetch(` calls that are not a method call and not the provider's own
 * `async fetch(entry, ctx)` interface declaration.
 *
 * A method call reads `ctx.fetchJson(...)` and is excluded by the leading dot; a
 * declaration is excluded by the `async` keyword before it. Everything else is
 * the global: `await fetch(`, `fetch(url).then(...)`, `const r = fetch(`, and the
 * qualified spellings `globalThis.fetch(`, `window.fetch(` and `self.fetch(`,
 * which the dot exclusion would otherwise wave through one level of indirection.
 */
const BARE_FETCH_RE = /(?:(?<![\w.$])fetch|(?<![\w.$])(?:globalThis|window|self)\s*\.\s*fetch)\s*\(/g;

/**
 * `redirect: 'follow'` in CODE, with the key quoted or bare.
 *
 * `{ 'redirect': 'follow' }` is the same option as `{ redirect: 'follow' }`, and
 * the match deliberately starts at the `r` so the mask check reads a code
 * position rather than the quoted key, which `codeMask` blanks. A comment
 * explaining why the family does not follow redirects is still not a violation.
 */
const FOLLOW_RE = /redirect['"]?\s*:\s*['"]follow['"]/g;

/**
 * Offending lines for one file's source.
 *
 * Exported so the self-test can drive it with a fixture: a guard whose detector
 * has never been seen to fire is a guard that may be matching nothing.
 *
 * @param {string} source
 * @returns {{bareFetch: number[], follow: number[]}} One-based line numbers.
 */
export function transportViolations(source) {
  const isCode = codeMask(source);
  const lineOf = (index) => source.slice(0, index).split('\n').length;

  const bareFetch = [];
  for (const match of source.matchAll(BARE_FETCH_RE)) {
    if (!isCode[match.index]) continue;
    // Look back over the whole prefix rather than a fixed window. `async  fetch`
    // (two spaces, or a newline after `async`) is the same declaration, and a
    // six-character slice reduced it to `sync  ` and stopped matching, so a
    // perfectly ordinary provider would have been reported as a bypass.
    if (/(?:^|[^\w$])async\s+$/.test(source.slice(0, match.index))) continue; // `async fetch(entry, ctx)` declaration
    bareFetch.push(lineOf(match.index));
  }

  const follow = [];
  for (const match of source.matchAll(FOLLOW_RE)) {
    // The key may be quoted, and a quoted `redirect` sits inside a string that
    // codeMask blanks. The colon after the key is code in every real option and
    // in no comment or string, so that is the position worth asking about:
    // `{ 'redirect': 'follow' }` passes, `// redirect: 'follow' said the docs`
    // does not.
    const colonIndex = match.index + match[0].indexOf(':');
    if (!isCode[colonIndex]) continue;
    follow.push(lineOf(match.index));
  }

  return { bareFetch, follow };
}

test('the detector fires on a real call and ignores declarations and comments', () => {
  const source = [
    'export default {',
    '  id: "x",',
    '  async fetch(entry, ctx) {',
    '  async  fetch(entry, ctx) {', // two spaces after async is the same declaration
    '    const r = await fetch(`https://example.com/${entry.slug}`);',
    '    const g = globalThis.fetch(url);',
    '    // a comment mentioning fetch( and redirect: \'follow\' is not a violation',
    '    const note = "fetch( in a string is not a call";',
    '    return ctx.fetchJson(URL, { \'redirect\': \'follow\' });',
    '  },',
    '};',
  ].join('\n');
  const found = transportViolations(source);
  assert.deepEqual(found.bareFetch, [5, 6], 'the bare call and the qualified global call are both caught, and neither declaration is');
  assert.deepEqual(found.follow, [9], 'a quoted redirect key is caught, the comment is not');
});

test('no provider bypasses the shared transport', () => {
  const files = readdirSync(PROVIDERS_DIR).filter((f) => f.endsWith('.mjs') && !EXEMPT.has(f));
  assert.ok(files.length > 100, `expected the provider fleet, found ${files.length} files — the guard would pass vacuously`);

  const bare = [];
  const follow = [];
  for (const file of files) {
    const found = transportViolations(readFileSync(join(PROVIDERS_DIR, file), 'utf8'));
    for (const line of found.bareFetch) bare.push(`${file}:${line}`);
    for (const line of found.follow) follow.push(`${file}:${line}`);
  }

  assert.deepEqual(bare, [],
    `Provider HTTP must go through ctx.fetchJson / ctx.fetchText / fetchResponse, which is where the redirect, body-cap and resolved-address controls live. Use the transport, or add the file to EXEMPT with a reason:\n  ${bare.join('\n  ')}`);
  assert.deepEqual(follow, [],
    `A provider must not follow redirects: pass a per-call option to the transport instead (the family default is redirect: 'error'). A deliberate exception belongs in EXEMPT, with its reason:\n  ${follow.join('\n  ')}`);
});

test('the transport still owns the safe default the convention rests on', () => {
  const source = readFileSync(join(PROVIDERS_DIR, TRANSPORT), 'utf8');
  assert.match(source, /redirect\s*=\s*'error'/,
    "the shared transport must keep 'error' as the default redirect policy — the provider guard means nothing without it");
});

test('the shared transport forwards that policy to fetch', { skip: process.env.CAREER_OPS_TRUST_PROXY_EGRESS === '1' ? 'proxy egress configured, so the transport dials through undici fetch instead of the global one' : false }, async () => {
  // The assertion above reads a literal. If the default stayed in the signature
  // but stopped being forwarded to fetch, the fleet guard and that assertion
  // would both stay green while every provider request followed redirects.
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), redirect: init.redirect });
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    // Distinct URLs on purpose: the transport caches a body per URL, and a
    // cached second call would assert the first call's options.
    await fetchJson('https://example.com/jobs/default');
    assert.equal(calls.at(-1)?.redirect, 'error', 'the family default must reach fetch');
    await fetchJson('https://example.com/jobs/override', { redirect: 'follow' });
    assert.equal(calls.at(-1)?.redirect, 'follow', 'a per-call policy must reach fetch too');
  } finally {
    globalThis.fetch = realFetch;
  }
});