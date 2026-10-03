// tests/provider-user-agent-convention.test.mjs — one place owns the crawler's
// identity.
//
// providers/ADDING_A_PROVIDER.md: "If the source blocks the default UA through a
// WAF/CDN, use BROWSER_LIKE_USER_AGENT from the same module — do not add your own
// constant." That rule is what keeps the User-Agent career-ops sends nameable:
// site owners write robots.txt rules against a product token (RFC 9309 §2.2.1),
// and a per-provider literal makes the fleet's identity unknowable — nobody can
// answer "what does career-ops send?" by reading user-agent.mjs.
//
// This is a CONVENTION check, not a compliance one: importing the shared
// BROWSER_LIKE_USER_AGENT is allowed and several providers legitimately need it.
// What it bans is the raw ingredient — a Mozilla/5.0 literal inside providers/ —
// because a literal is what drifts, and a reviewer cannot be expected to catch
// the next one (same reasoning as tests/main-guard-convention.test.mjs, #3170).
//
// Run:  node --test tests/provider-user-agent-convention.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PROVIDERS_DIR = join(ROOT, 'providers');

// user-agent.mjs is the one file that may hold the literals; _http.mjs re-exports
// them. Nothing under providers/ needs its own.
const EXEMPT = new Set([]);

const UA_LITERAL_RE = /Mozilla\/5\.0/;

test('no provider hardcodes a User-Agent literal', () => {
  const offenders = [];
  for (const name of readdirSync(PROVIDERS_DIR)) {
    if (!name.endsWith('.mjs') || EXEMPT.has(name)) continue;
    const src = readFileSync(join(PROVIDERS_DIR, name), 'utf-8');
    src.split('\n').forEach((line, i) => {
      // A comment explaining the rule is not a violation; a string is.
      const code = line.replace(/\/\/.*$/, '');
      if (UA_LITERAL_RE.test(code)) offenders.push(`${name}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(
    offenders,
    [],
    `providers must use the shared User-Agent from _http.mjs (DEFAULT_USER_AGENT, or BROWSER_LIKE_USER_AGENT when a WAF blocks it) — never their own literal:\n${offenders.join('\n')}`,
  );
});

test('the shared User-Agent identifies career-ops and carries a contact URL', async () => {
  const { DEFAULT_USER_AGENT } = await import(pathToFileURL(join(ROOT, 'user-agent.mjs')).href);
  assert.match(DEFAULT_USER_AGENT, /career-ops/, 'the default UA names the product');
  assert.match(DEFAULT_USER_AGENT, /\+https?:\/\//, 'the default UA carries a URL a site owner can follow');
});
