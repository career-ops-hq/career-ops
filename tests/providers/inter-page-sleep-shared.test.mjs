// tests/providers/inter-page-sleep-shared.test.mjs — providers/_http.mjs
// exports the ctx-aware `sleep(ms, ctx)` helper, and every provider's
// inter-page / inter-request pacing is meant to import it. #2723 predicted
// that a hand-rolled local copy "arrives with the next provider" — it kept
// recurring across 20+ providers until they were all routed through the
// shared export. Prose in ADDING_A_PROVIDER.md ("don't hand-roll a local
// copy") did not hold the line, so this guard fails the build on the next
// one.
//
// Two shapes are the offence: a provider declaring its own `sleep`
// (function/const/let/var) instead of importing it, and a provider
// reimplementing the `ctx.sleep ? ctx.sleep(ms) : new Promise(setTimeout)`
// fallback under any other name (`wait`, or inlined at the `await` call site
// with no name at all) — same duplication, just missed by a name-only search.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { readdirSync, readFileSync } from 'fs';

console.log('\nProviders — inter-page sleep routes through _http.mjs (#2723)');

// A local declaration of `sleep`: `function sleep(`, `function* sleep(`,
// `const sleep =`, `let sleep =`, `var sleep =`. A destructure
// (`const { sleep } = …`) has a brace after `const` and does not match.
const LOCAL_SLEEP_DECL = /(?:function\s*\*?\s+sleep\s*\(|(?:const|let|var)\s+sleep\s*=)/;
// The fallback shape itself, regardless of what (if anything) it is assigned
// to: `ctx.sleep ? ctx.sleep(...) : new Promise(...setTimeout...)`, or the
// same fallback guarded by `typeof ctx?.sleep === 'function'` (the exact
// guard `_http.mjs`'s own `sleep()` uses, copyable verbatim into a provider).
const SLEEP_FALLBACK_SHAPE = /(?:ctx\.sleep|typeof\s+ctx\??\.sleep\s*===\s*['"]function['"])\s*\?\s*ctx\.sleep\([^)]*\)\s*:\s*new Promise\([^;]*setTimeout/;
const SHARED_SLEEP_IMPORT = /\bimport\s*\{[^}]*\bsleep\b[^}]*\}\s*from\s*['"]\.\/_http\.mjs['"]/;

/** @returns {string|null} offender line, or null when the file is clean. */
const classify = (file, src) => {
  if (LOCAL_SLEEP_DECL.test(src)) {
    return SHARED_SLEEP_IMPORT.test(src)
      ? `${file} (declares its own sleep alongside the shared import)`
      : `${file} (declares its own sleep and does not import it from ./_http.mjs)`;
  }
  if (SLEEP_FALLBACK_SHAPE.test(src)) {
    return `${file} (reimplements the ctx.sleep fallback instead of importing sleep from ./_http.mjs)`;
  }
  return null;
};

// ── Positive control ──
// A regex that later matches nothing keeps every run green over a real private
// copy — plant the shapes this guard exists to catch and assert they fire.
{
  const IMPORT_LINE = "import { BROWSER_LIKE_USER_AGENT, sleep } from './_http.mjs';\n";
  const planted = [
    ['function sleep(ms, ctx) { return ctx?.sleep?.(ms); }',
      'x.mjs (declares its own sleep and does not import it from ./_http.mjs)'],
    ['function sleep(ctx, ms) { return ctx?.sleep?.(ms); }',
      'x.mjs (declares its own sleep and does not import it from ./_http.mjs)'],
    ['const sleep = (ms) => new Promise((r) => setTimeout(r, ms));',
      'x.mjs (declares its own sleep and does not import it from ./_http.mjs)'],
    [IMPORT_LINE + 'function sleep(ms, ctx) { return ctx?.sleep?.(ms); }',
      'x.mjs (declares its own sleep alongside the shared import)'],
    ['const wait = (ms) => (ctx.sleep ? ctx.sleep(ms) : new Promise((r) => setTimeout(r, ms)));',
      'x.mjs (reimplements the ctx.sleep fallback instead of importing sleep from ./_http.mjs)'],
    ['await (ctx.sleep ? ctx.sleep(PAGE_DELAY_MS) : new Promise(r => setTimeout(r, PAGE_DELAY_MS)));',
      'x.mjs (reimplements the ctx.sleep fallback instead of importing sleep from ./_http.mjs)'],
    ["const wait = (ms) => (typeof ctx?.sleep === 'function' ? ctx.sleep(ms) : new Promise((r) => setTimeout(r, ms)));",
      'x.mjs (reimplements the ctx.sleep fallback instead of importing sleep from ./_http.mjs)'],
  ];
  const missed = planted.filter(([src, want]) => classify('x.mjs', src) !== want);
  if (missed.length === 0) {
    pass('positive control: every known local-sleep shape is still detected');
  } else {
    fail(`guard no longer fires on: ${JSON.stringify(missed.map(([src]) => src.slice(0, 60)))}`);
  }

  // Negative control: importing and calling the shared helper is correct usage.
  const legitimate = IMPORT_LINE + 'if (page > 0) await sleep(INTER_PAGE_DELAY_MS, ctx);\n';
  if (classify('x.mjs', legitimate) === null) {
    pass('negative control: importing and calling the shared sleep is not an offence');
  } else {
    fail(`guard flags legitimate usage: ${classify('x.mjs', legitimate)}`);
  }

  // Negative control: a `wait` helper with a different fallback (no real
  // setTimeout pacing) is a different shape and stays out of scope.
  const wait = 'const wait = (ms) => (ctx.sleep ? ctx.sleep(ms) : Promise.resolve());\n';
  if (classify('x.mjs', wait) === null) {
    pass('negative control: a `wait` helper with a non-setTimeout fallback is not flagged');
  } else {
    fail(`guard flags an out-of-scope helper: ${classify('x.mjs', wait)}`);
  }
}

let files;
try {
  files = readdirSync(join(ROOT, 'providers'));
} catch (e) {
  files = null;
  fail(`cannot read providers/: ${e.message}`);
}

if (files) {
  const offenders = [];
  for (const file of files) {
    if (!file.endsWith('.mjs') || file.startsWith('_')) continue;
    let src;
    try {
      src = readFileSync(join(ROOT, 'providers', file), 'utf-8');
    } catch (e) {
      offenders.push(`${file} (unreadable: ${e.message})`);
      continue;
    }
    const verdict = classify(file, src);
    if (verdict) offenders.push(verdict);
  }

  if (offenders.length === 0) {
    pass('no provider hand-rolls its own sleep instead of importing it from _http.mjs');
  } else {
    fail(`local sleep helper re-introduced in: ${offenders.join(', ')}`);
  }
}
