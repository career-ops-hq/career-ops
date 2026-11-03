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
    // `\s*` on BOTH sides of the colon: without the first one,
    // `redirect : 'follow'` passed. The formatter normalizes it, so this is a
    // one-character hole rather than a live miss, but a check that can be
    // evaded by whitespace is not a check (#4979).
    .filter(([, code]) => /redirect\s*:\s*['"]follow['"]/.test(code))
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

// ── 2. Host-validation regexes ─────────────────────────────────────────────
//
// Collected by how they are USED, not by how they are written. A regex applied
// to a hostname expression — `BAMBOOHR_HOST_RE.test(parsed.hostname)`,
// `/^[a-z0-9-]+\.jibeapply\.com$/i.test(u.hostname)` — is a host guard and is
// in scope. A named constant is resolved to its declaration in the same file,
// which is the dominant idiom: 19 of the 24 guards found today are written
// that way.
//
// The first version of this check collected only literals that began with
// `/^`, which excluded the exact bug it was hunting. A guard that has LOST its
// start anchor no longer begins with `/^`, so it dropped out of the examined
// set entirely and neither the missing-`$` nor the unescaped-dot check could
// fire on it; the examined count fell silently by one and nothing failed
// (#4979, found by review and proved with that mutation).
//
// Scope matters in the other direction too. This directory is full of
// host-shaped regexes that are NOT guards — `/jobs\.ashbyhq\.com\/([^/?#]+)/`
// extracts a tenant slug, `/boards-api.greenhouse.io/` matches a URL
// substring — and 109 host-shaped literals here have no leading `^` for
// exactly that reason. Demanding an anchor on all of them would be ~109 false
// reports, which is how a guard gets switched off. The `.test(<host>)` link is
// what separates a gate from an extractor.
{
  // `X.test(expr)` where X is an inline regex literal or an identifier, and
  // expr mentions a host. The character class tolerates escapes and `[...]`
  // sets so a literal is not cut short at a `/` inside one.
  const REGEX_LITERAL = String.raw`\/(?:[^\/\n\\\[]|\\.|\[(?:[^\]\\]|\\.)*\])+\/[a-z]*`;
  const testedRe = new RegExp(`(${REGEX_LITERAL}|[A-Za-z_$][\\w$]*)\\s*\\.test\\(\\s*([^)]{0,60})`, 'g');
  const literalRe = new RegExp(`^${REGEX_LITERAL}$`);

  // A host guard is anchored at its END, and anchored at its START in one of
  // three ways, all three of which are in the tree today:
  //
  //   ^tenant\.vendor\.com$        18 guards — the plain form
  //   (^|\.)vendor\.com$            5 guards — "this host, or a subdomain of
  //                                            it"; `^` is inside the group
  //   \.vendor\.com$                1 guard  — the suffix form, the regex
  //                                            equivalent of endsWith('.x')
  //
  // The leading dot is what makes the third safe: `evilvendor.com` cannot
  // match `\.vendor\.com$`. A pattern with neither a start anchor nor a
  // leading dot is the dangerous shape — `/[a-z0-9-]+\.taleo\.net/i` accepts
  // `eviltaleo.net`.
  const hasEndAnchor = (body) => /\$$/.test(body.trimEnd());
  const hasStartAnchor = (body) => body.startsWith('^')
    || /^\((?:\?:)?\^\|\\\./.test(body)
    || body.startsWith('\\.');

  // Keyed by file + pattern, because one constant is commonly tested at
  // several call sites (bamboohr validates in both detect() and fetch()). One
  // guard reported twice reads as two problems.
  const byGuard = new Map();
  const unresolved = [];
  const addGuard = (file, body, shown) => {
    byGuard.set(`${file}::${shown}`, { file, body, shown });
  };

  for (const [file, code] of sources) {
    for (const m of code.matchAll(testedRe)) {
      const [, receiver, arg] = m;
      if (!/host/i.test(arg)) continue; // not applied to a hostname

      if (literalRe.test(receiver)) {
        const body = receiver.slice(1, receiver.lastIndexOf('/'));
        addGuard(file, body, receiver);
        continue;
      }
      // A named constant: resolve it where it is declared.
      const decl = code.match(
        new RegExp(`\\b${receiver}\\s*=\\s*(${REGEX_LITERAL})`),
      );
      if (decl) {
        const lit = decl[1];
        addGuard(file, lit.slice(1, lit.lastIndexOf('/')), `${receiver} = ${lit}`);
      } else {
        // Reported rather than skipped. Silently dropping one is how the first
        // version of this check lost its subject without failing.
        unresolved.push(`${file}: ${receiver}.test(${arg.trim()})`);
      }
    }
  }

  const guards = [...byGuard.values()];

  // The detection has to be shown to work, or "0 offenders" means nothing.
  if (guards.length >= 20) {
    pass(`${guards.length} host-validation regexes examined`);
  } else {
    fail(
      `only ${guards.length} host-validation regexes found — the detection has rotted, and the `
      + 'anchor checks below are passing over an empty list',
    );
  }

  if (unresolved.length === 0) {
    pass('every host-validation regex resolved to a pattern');
  } else {
    fail(
      'these regexes are tested against a hostname but their pattern could not be resolved, so '
      + `they are NOT covered by the anchor checks below: ${unresolved.join(' | ')}`,
    );
  }

  const missingEnd = guards.filter((g) => !hasEndAnchor(g.body)).map((g) => `${g.file}: ${g.shown}`);
  if (missingEnd.length === 0) {
    pass('every host-validation regex is anchored at the end');
  } else {
    fail(
      'these host guards have no trailing $, so tenant.vendordomain.com.evil.example passes: '
      + missingEnd.join(' | '),
    );
  }

  const missingStart = guards.filter((g) => !hasStartAnchor(g.body)).map((g) => `${g.file}: ${g.shown}`);
  if (missingStart.length === 0) {
    pass('every host-validation regex is anchored at the start');
  } else {
    fail(
      'these host guards have no leading ^, no (^|\\.) alternation and no leading dot, so '
      + `evilvendordomain.com passes: ${missingStart.join(' | ')}`,
    );
  }

  // An unescaped `.` immediately before a TLD: `.` matches any character, so
  // `vendordomainXcom` would pass.
  const unescapedDot = guards
    .filter((g) => /(?<!\\)\.(?=[a-z]{2,}(\$|\\|$|\)))/.test(g.body))
    .map((g) => `${g.file}: ${g.shown}`);
  if (unescapedDot.length === 0) {
    pass('every host-validation regex escapes its dots');
  } else {
    fail(
      'these host guards leave a dot unescaped, so vendordomainXcom passes: '
      + unescapedDot.join(' | '),
    );
  }
}

// ── 3. endsWith() suffix guards ────────────────────────────────────────────
//
// Matched on the RECEIVER being any identifier, not on the literal word
// `hostname` appearing nearby. The first version required `hostname` within 40
// characters of `endsWith(`, and the dominant idiom aliases first:
//
//   const host = u.host.toLowerCase();
//   if (host !== 'csod.com' && !host.endsWith('.csod.com')) return null;
//
// so it saw 3 of the 17 suffix guards in the tree and 14 were invisible —
// amazon, avature, beesite, csod, dassault, deutschebahn, eploy, gupy,
// hecklerkoch, rheinmetall, softgarden among them. Review proved the gap by
// dropping the leading dot from csod.mjs's aliased guard, a real dotless-suffix
// bug that would let `evilcsod.com` through, with the suite staying green
// (#4979).
//
// What makes it a host guard here is the ARGUMENT's shape — a dotted domain
// suffix — rather than the receiver's name, so `s.endsWith('.json')` and
// `path.endsWith('/')` are not in scope.
{
  const endsWithRe = /([A-Za-z_$][\w$]*)\s*\.endsWith\(\s*['"]([^'"]+)['"]/g;
  let examined = 0;
  const dotless = [];

  for (const [file, code] of sources) {
    for (const m of code.matchAll(endsWithRe)) {
      const [, receiver, value] = m;
      if (!/^\.?[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(value)) continue; // not a domain suffix
      examined += 1;
      if (!value.startsWith('.')) {
        dotless.push(`${file}: ${receiver}.endsWith('${value}')`);
      }
    }
  }

  if (examined >= 12) {
    pass(`${examined} endsWith() suffix guards examined`);
  } else {
    fail(
      `only ${examined} endsWith() suffix guards found — the suffix detection has rotted. It found `
      + '17 when written, and 14 of those were invisible to the version before it.',
    );
  }

  if (dotless.length === 0) {
    pass('every endsWith() suffix guard keeps its leading dot');
  } else {
    fail(
      'these suffix guards omit the leading dot, so evilvendordomain.com passes: '
      + dotless.join(' | '),
    );
  }
}
