// tests/providers/host-guard-anchoring.test.mjs — the SSRF rules in
// providers/ADDING_A_PROVIDER.md, checked across every provider.
//
// Section 2 states four MUSTs, and spells out exactly how each one gets broken:
//
//   "Never pass `redirect: 'follow'` in a provider"
//   "keep the trailing `$` (without it `tenant.vendordomain.com.evil.example`
//    passes), escape the dots (`\.`, or `.` also matches `vendordomainXcom`),
//    and keep the leading dot on a suffix test (`endsWith('vendordomain.com')`
//    also accepts `evilvendordomain.com`)"
//
// All 105 providers comply today — measured before writing this, so it is a
// ratchet rather than a backlog. What was missing is anything that keeps them
// complying. The only existing SSRF test, tests/providers/ats-ssrf-hardening.
// test.mjs, covers two providers BY NAME ("these two were missing it") as a
// regression test for #1440; it says nothing about the 106th provider.
//
// The failure mode is not a wrong number on a screen. A host guard that is a
// no-op lets a `portals.yml` entry — or a redirect from a compromised portal —
// point a server-side fetch at an address the IP guard already cleared for a
// different host.
//
// Comments are stripped before matching. ADDING_A_PROVIDER.md quotes
// `redirect: 'follow'` while forbidding it, and providers/peoplesoft.mjs
// mentions it in a 12-line comment explaining why it follows redirects
// MANUALLY and re-validates every hop — so a raw grep flags the two files that
// document the rule most carefully.

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { pass, fail, ROOT } from '../helpers.mjs';

console.log('\nProvider — SSRF host-guard anchoring (ADDING_A_PROVIDER.md section 2)');

const PROVIDERS_DIR = join(ROOT, 'providers');

/** Source with comments removed, so a rule quoted in prose is not a violation. */
function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

// `_`-prefixed files are shared helpers, not providers; _http.mjs is where the
// redirect default legitimately lives.
const providerFiles = readdirSync(PROVIDERS_DIR)
  .filter((f) => f.endsWith('.mjs') && !f.startsWith('_'))
  .sort();

// A guard on the guard: if this ever stops finding providers, every assertion
// below would pass over an empty list and report as coverage.
if (providerFiles.length >= 80) {
  pass(`${providerFiles.length} providers discovered`);
} else {
  fail(`only ${providerFiles.length} providers discovered — the scan has lost its subject`);
}

const sources = new Map(
  providerFiles.map((f) => [f, codeOnly(readFileSync(join(PROVIDERS_DIR, f), 'utf-8'))]),
);

// ── 1. redirect: 'follow' ──────────────────────────────────────────────────
{
  const offenders = [...sources]
    .filter(([, code]) => /redirect:\s*['"]follow['"]/.test(code))
    .map(([f]) => f);

  if (offenders.length === 0) {
    pass("no provider passes redirect:'follow'");
  } else {
    fail(
      "these providers pass redirect:'follow', so a redirect can reach an address the IP guard "
      + `cleared for a different host (ADDING_A_PROVIDER.md section 2): ${offenders.join(', ')}`,
    );
  }
}

// ── 2. Anchored host regexes ───────────────────────────────────────────────
//
// Only patterns that look like a hostname are considered: an anchored regex
// over a path or an id has different rules and is none of this check's business.
{
  const hostPatternRe = /\/\^([^/\n]*?)\/[a-z]*/g;
  const looksLikeHost = (body) => /[a-z0-9-]\\?\.[a-z]{2,}/.test(body);

  let examined = 0;
  const missingAnchor = [];
  const unescapedDot = [];

  for (const [file, code] of sources) {
    for (const m of code.matchAll(hostPatternRe)) {
      const body = m[1];
      if (!looksLikeHost(body)) continue;
      examined += 1;

      if (!body.trimEnd().endsWith('$')) {
        missingAnchor.push(`${file}: /^${body}/`);
      }
      // An unescaped `.` immediately before a TLD: `.` matches any character,
      // so `vendordomainXcom` would pass.
      if (/(?<!\\)\.(?=[a-z]{2,}(\$|\\|$|\)))/.test(body)) {
        unescapedDot.push(`${file}: /^${body}/`);
      }
    }
  }

  // The detection has to be shown to work, or "0 offenders" is meaningless.
  if (examined >= 10) {
    pass(`${examined} anchored host patterns examined`);
  } else {
    fail(`only ${examined} anchored host patterns found — the pattern detection has rotted`);
  }

  if (missingAnchor.length === 0) {
    pass('every anchored host regex keeps its trailing $');
  } else {
    fail(
      'these host regexes have no trailing $, so tenant.vendordomain.com.evil.example passes: '
      + missingAnchor.join(' | '),
    );
  }

  if (unescapedDot.length === 0) {
    pass('every anchored host regex escapes its dots');
  } else {
    fail(
      'these host regexes leave a dot unescaped, so vendordomainXcom passes: '
      + unescapedDot.join(' | '),
    );
  }
}

// ── 3. endsWith() suffix guards ────────────────────────────────────────────
{
  const endsWithRe = /hostname[^\n;]{0,40}endsWith\(\s*['"]([^'"]+)['"]/g;
  let examined = 0;
  const dotless = [];

  for (const [file, code] of sources) {
    for (const m of code.matchAll(endsWithRe)) {
      const value = m[1];
      if (!/^\.?[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(value)) continue; // not a domain suffix
      examined += 1;
      if (!value.startsWith('.')) {
        dotless.push(`${file}: endsWith('${value}')`);
      }
    }
  }

  if (examined >= 1) {
    pass(`${examined} hostname.endsWith() suffix guards examined`);
  } else {
    fail('no hostname.endsWith() guards found — the suffix detection has rotted');
  }

  if (dotless.length === 0) {
    pass('every hostname.endsWith() guard keeps its leading dot');
  } else {
    fail(
      "these suffix guards omit the leading dot, so evilvendordomain.com passes: "
      + dotless.join(' | '),
    );
  }
}
