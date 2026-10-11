// tests/providers/registry-loads-every-provider.test.mjs — every provider file
// must actually become a provider.
//
// loadProviders() is deliberately forgiving, and says so:
//
//   "Malformed modules (wrong shape, duplicate id, import error) are logged
//    and skipped, never fatal."
//
// That is right for a plugin loader — one bad module must not take the whole
// scan down. But it means a provider lost to a typo, a renamed import, a
// removed export or an id collision leaves nothing behind except a line on
// stderr, and `scan.mjs` then skips every board that provider claimed on every
// run while the scan still reports success. AGENTS.md names this exact shape as
// the highest-value check for portals.yml:
//
//   "no provider claims its careers_url (so scan.mjs skips it silently on
//    every run while it reads as coverage)"
//
// The same thing one layer down — the provider module itself vanishing — had
// nothing watching it. The existing tests assert `providers.size > 0`, which
// catches an empty registry and not the loss of one provider out of 105: size
// becomes 104, stays > 0, and every assertion passes.
//
// All 105 load today with no warnings, measured, so this is a ratchet.

import { readdirSync } from 'fs';
import { join } from 'path';
import { pass, fail, ROOT } from '../helpers.mjs';
import { loadProviders } from '../../providers/_registry.mjs';

console.log('\nProvider — the registry loads every provider file');

const PROVIDERS_DIR = join(ROOT, 'providers');

// `_`-prefixed files are shared helpers and are never loaded as providers.
const files = readdirSync(PROVIDERS_DIR)
  .filter((f) => f.endsWith('.mjs') && !f.startsWith('_'))
  .sort();

// A guard on the guard: with no files, every comparison below would hold
// trivially and report as coverage.
if (files.length >= 80) {
  pass(`${files.length} provider files on disk`);
} else {
  fail(`only ${files.length} provider files found — the scan has lost its subject`);
}

// loadProviders reports every skip through console.error and carries on, so the
// warnings ARE the signal. Captured rather than inspected afterwards, because
// a skipped provider leaves no other trace.
const warnings = [];
const realError = console.error;
console.error = (...args) => warnings.push(args.join(' '));
let providers;
try {
  providers = await loadProviders(PROVIDERS_DIR);
} finally {
  console.error = realError;
}

if (providers.size === files.length) {
  pass(`all ${providers.size} providers registered`);
} else {
  // Name the missing ones: "104 of 105" sends the reader to diff two lists by
  // hand, which is the work this test exists to have already done.
  const registeredFiles = new Set();
  for (const p of providers.values()) {
    if (p?.sourceFile) registeredFiles.add(p.sourceFile);
  }
  const ids = new Set([...providers.keys()]);
  const unaccounted = files.filter((f) => {
    const stem = f.replace(/\.mjs$/, '');
    return !ids.has(stem) && !registeredFiles.has(f);
  });
  fail(
    `${providers.size} of ${files.length} provider files registered — scan.mjs will skip every board `
    + `the missing one(s) claim, on every run, while still reporting success. `
    + `Unaccounted for (by filename stem; a provider whose id differs from its filename may appear here harmlessly): `
    + `${unaccounted.join(', ') || '(none by stem — compare ids)'}`,
  );
}

if (warnings.length === 0) {
  pass('no provider was skipped with a warning');
} else {
  fail(`loadProviders() skipped ${warnings.length} module(s): ${warnings.join(' | ')}`);
}

// Asserted separately from the count because it fails differently: a duplicate
// id keeps the FIRST file and drops the second, so two providers can collide
// while the id set still looks healthy in isolation.
{
  const seen = new Map();
  const collisions = [];
  for (const [id, p] of providers) {
    if (seen.has(id)) collisions.push(id);
    seen.set(id, p);
  }
  if (collisions.length === 0) {
    pass(`${providers.size} provider ids are unique`);
  } else {
    fail(`duplicate provider ids, so the later file is dropped: ${collisions.join(', ')}`);
  }
}

// Shape, checked here rather than trusted: loadProviders only requires `id` and
// `fetch`, and a provider that registers without a usable detect()/fetch pair
// is in the map but unreachable for an entry that has no explicit `provider:`.
{
  const broken = [];
  for (const [id, p] of providers) {
    if (typeof p.fetch !== 'function') broken.push(`${id}: fetch is not a function`);
    if (p.detect !== undefined && typeof p.detect !== 'function') {
      broken.push(`${id}: detect is present but not a function`);
    }
  }
  if (broken.length === 0) {
    pass('every registered provider exposes a callable fetch (and detect, when present)');
  } else {
    fail(`unusable provider shapes: ${broken.join(' | ')}`);
  }
}
