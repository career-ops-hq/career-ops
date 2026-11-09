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
//
// Review (#4981) found the first version of this file blind to the very case
// its title names, and both gaps are now covered here:
//
//   - A misspelled id VALUE sailed through. `id: 'greenhous'` still loads, the
//     count stays at 105 and no warning is printed, so every assertion passed
//     while `provider: greenhouse` in portals.yml resolved to "unknown
//     provider" and that board was skipped on every scan. Counting modules can
//     never catch this: the module is there, it is registered under the wrong
//     name. Something has to pin the name from OUTSIDE the module, which is
//     what the two id checks below do.
//   - The duplicate-id block could not fail. It iterated the `providers` Map,
//     whose keys are unique by construction, so `seen.has(id)` was unreachable.
//     An assertion that cannot fail is worse than none, because the next reader
//     trusts it. It now reads each module's declared id BEFORE the loader
//     dedups, which is the only place a collision is still visible.

import { readdirSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
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

// Every module's DECLARED id, read before the loader dedups.
//
// `loadProviders` drops a colliding module and keeps the first, so by the time
// it returns, the collision is gone from its result — the Map it hands back
// cannot be asked which ids collided. Reading each module directly is the only
// way to see them. The import cache makes this free: the loader has already
// imported these files, so these are the same module instances, not re-runs.
const declared = [];
const unreadable = [];
for (const file of files) {
  try {
    const mod = await import(pathToFileURL(join(PROVIDERS_DIR, file)).href);
    declared.push({ file, id: mod.default?.id });
  } catch (err) {
    // The loader already warned about this one and the warnings check above
    // owns it; recorded so the id checks below report on a known-short list
    // rather than silently covering fewer files than they claim.
    unreadable.push(`${file}: ${err.message}`);
  }
}

// A guard on the guard, again: the id checks below iterate `declared`, so a
// collection that silently came back short would make all of them vacuous.
if (declared.length === files.length) {
  pass(`read a declared id from all ${declared.length} provider modules`);
} else {
  fail(
    `read ids from only ${declared.length} of ${files.length} modules, so the id checks below `
    + `cover less than they claim: ${unreadable.join(' | ')}`,
  );
}

// Collisions, from the declared ids rather than the deduped Map.
//
// The loader does warn here ("duplicate provider id — keeping first"), and the
// warnings check above would catch it, so this is not the only net. It is the
// one that names BOTH files: the warning names only the module that lost and
// says "keeping first" without saying which file won, which is the thing the
// reader needs in order to fix it.
{
  const byId = new Map();
  for (const { file, id } of declared) {
    if (!id) continue; // shape failure; the loader's own warning owns it
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(file);
  }
  const collisions = [...byId.entries()].filter(([, fs]) => fs.length > 1);
  if (collisions.length === 0) {
    pass(`${byId.size} declared provider ids are unique`);
  } else {
    fail(
      'two modules declare the same provider id, so the later one is dropped and every board it '
      + `claims is skipped: ${collisions.map(([id, fs]) => `"${id}" in ${fs.join(' and ')}`).join('; ')}`,
    );
  }
}

// A provider's id must match its filename.
//
// This is what catches a misspelled id value. The count cannot: the module
// loads fine and registers, just under a name nothing refers to. The filename
// is the external pin — it is what the reader, the docs and `portals.yml`
// entries all spell, and it does not change when someone edits the id string.
//
// True for all 105 today, measured, so this is a ratchet with no allowlist. A
// provider that genuinely needs an id different from its filename is a
// deliberate decision, and belongs here as a named exception rather than as a
// silently loosened rule.
{
  const mismatched = declared
    .filter(({ id }) => id)
    .filter(({ file, id }) => id !== file.replace(/\.mjs$/, ''))
    .map(({ file, id }) => `${file} declares id "${id}"`);
  if (mismatched.length === 0) {
    pass(`all ${declared.length} provider ids match their filenames`);
  } else {
    fail(
      'provider id does not match its filename, so every portals.yml entry naming the file\'s '
      + `spelling resolves to "unknown provider" and is skipped on every scan: ${mismatched.join(', ')}`,
    );
  }
}

// The ids the shipped configuration cannot work without, pinned by name.
//
// Not redundant with the filename rule above: renaming BOTH the file and the
// id keeps them matching, and the whole registry would still load, while every
// `provider: greenhouse` entry in every user's portals.yml stops resolving.
// These three are the high-traffic ATS boards, so this is the check that fails
// loudly if one is ever renamed without a migration.
{
  const CRITICAL_IDS = ['greenhouse', 'lever', 'ashby'];
  const absent = CRITICAL_IDS.filter((id) => !providers.has(id));
  if (absent.length === 0) {
    pass(`the critical provider ids are registered under their exact names: ${CRITICAL_IDS.join(', ')}`);
  } else {
    fail(
      `critical provider id(s) absent from the registry: ${absent.join(', ')}. Every portals.yml `
      + 'entry naming one resolves to "unknown provider", and those boards are skipped on every '
      + 'run while the scan still reports success.',
    );
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
