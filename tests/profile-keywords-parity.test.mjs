// tests/profile-keywords-parity.test.mjs — web/src/lib/profile-keywords.mjs
// must agree with providers/_profile-keywords.mjs on `target_roles`.
//
// The web app cannot import the core helper at build time: Turbopack's root is
// pinned to web/ and refuses modules outside it (see web/next.config.mjs, and
// web/src/lib/tracker-table.mjs's header for the same constraint). So the web
// carries a mirror — and a mirror is exactly the thing that drifts. It already
// did: the inline version this replaced read `primary` as a string when it is a
// list, and spread `archetypes` raw when its entries are objects, so the
// Explorer's profile.yml fallback silently returned [] for every profile the
// app itself writes.
//
// This guard lives in the ROOT suite, not web/tests/, for two reasons:
//   1. web-ci.yml runs `npm ci` inside web/ only. Importing the core module
//      resolves js-yaml from the repo root's node_modules, which does not exist
//      there — the assertion cannot run on that side of the boundary at all.
//   2. .github/workflows/test.yml runs test-all.mjs on every PR and is a
//      required check; web-ci.yml is informative by design.
// Same reach-into-web/ pattern as tests/web-test-layout.test.mjs.
//
// Compared as SETS: the core de-dupes and trims, the web mirror returns raw
// strings for its caller's cleanChips to handle. The contract under test is
// "the same keywords", not "the same post-processing".

import { pass, fail, ROOT } from './helpers.mjs';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';
import { profileTargetKeywords as core } from '../providers/_profile-keywords.mjs';
import { profileTargetKeywords as web } from '../web/src/lib/profile-keywords.mjs';

console.log('\nprofile-keywords — web mirror vs core helper');

// A true set comparison, not a length check: the core de-dupes and the mirror
// does not, so a keyword appearing in both `primary` and an archetype name
// legitimately yields 2 entries on one side and 1 on the other.
const sameSet = (a, b) => {
  const A = new Set(a), B = new Set(b);
  return A.size === B.size && [...A].every((k) => B.has(k));
};

// The shipped example is the shape that actually exists on disk, so it is the
// case that matters most — and it must not be empty, or parity is vacuous.
const example = yaml.load(readFileSync(join(ROOT, 'config', 'profile.example.yml'), 'utf-8'));
const fromExample = web(example);
if (fromExample.length >= 2) pass(`config/profile.example.yml yields ${fromExample.length} keywords (parity is not vacuous)`);
else fail(`config/profile.example.yml yielded ${fromExample.length} keywords — the mirror is returning nothing`);
if (sameSet(fromExample, core(example))) pass('web mirror matches core on config/profile.example.yml');
else fail(`drift on profile.example.yml: web=${JSON.stringify(fromExample)} core=${JSON.stringify(core(example))}`);

// Shapes the two have disagreed on, or could. Each is a documented field form,
// not a synthetic edge case: `primary` as a list is what api/profile/route.ts
// writes; `archetypes` entries are {name, level, fit} objects.
const cases = [
  ['primary as a list', { target_roles: { primary: ['ML Engineer', 'Inference Engineer'] } }],
  ['archetypes contribute .name', { target_roles: { archetypes: [{ name: 'Edge AI Engineer', level: 'Senior', fit: 'primary' }] } }],
  ['both together', { target_roles: { primary: ['A'], archetypes: [{ name: 'B' }] } }],
  ['archetype with no name', { target_roles: { archetypes: [{ level: 'Senior' }] } }],
  ['primary as a bare scalar', { target_roles: { primary: 'Senior AI Engineer' } }],
  ['target_roles absent', {}],
  ['target_roles null', { target_roles: null }],
  ['target_roles is an array', { target_roles: [] }],
];

for (const [label, doc] of cases) {
  let w, c;
  try {
    w = web(doc);
    c = core(doc);
  } catch (e) {
    fail(`${label}: threw — ${e.message}`);
    continue;
  }
  if (sameSet(w, c)) pass(`parity: ${label}`);
  else fail(`parity: ${label} — web=${JSON.stringify(w)} core=${JSON.stringify(c)}`);
}

// Neither side may throw on junk: both are tolerant readers on a seeding path,
// never validators.
for (const junk of [null, undefined, 'a string', 42, []]) {
  try {
    web(junk);
    core(junk);
    pass(`both tolerate ${JSON.stringify(junk) ?? 'undefined'}`);
  } catch (e) {
    fail(`threw on ${JSON.stringify(junk) ?? 'undefined'}: ${e.message}`);
  }
}
