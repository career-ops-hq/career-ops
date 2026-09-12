// tests/scan-ats-full-title-filter-full.test.mjs — optional `title_filter_full`
// override: the reverse sweep may run a stricter title profile than scan.mjs
// without either scanner's config being a compromise between the two.
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nscan-ats-full — title_filter_full override');

const mod = await import(pathToFileURL(join(ROOT, 'scan-ats-full.mjs')).href);
const { resolveTitleFilterConfig } = mod;

const broad = { positive: ['Backend', 'Solana'] };
const strict = { positive: ['Solana', 'Smart Contract'] };

// Absent key: byte-identical to pre-override behaviour. This is the case every
// existing portals.yml is in, so it is the one that must never regress.
{
  const got = resolveTitleFilterConfig({ title_filter: broad });
  if (got === broad) pass('absent title_filter_full falls back to title_filter');
  else fail(`expected the title_filter object, got ${JSON.stringify(got)}`);
}

// Present key wins, and does NOT merge: a strict profile that inherited the
// broad profile's keywords would defeat the entire purpose.
{
  const got = resolveTitleFilterConfig({ title_filter: broad, title_filter_full: strict });
  if (got === strict) pass('title_filter_full overrides title_filter outright');
  else fail(`expected the title_filter_full object, got ${JSON.stringify(got)}`);
}

// scan.mjs must be unaffected — it reads config.title_filter directly and has
// no knowledge of the override, so the broad profile survives for the scanner
// whose curated corpus makes a keyword like "Backend" safe.
{
  const config = { title_filter: broad, title_filter_full: strict };
  if (config.title_filter === broad) pass('title_filter left untouched for scan.mjs');
  else fail('resolution mutated title_filter');
}

// Missing/empty config must not throw — main() calls this before the
// "no positive keywords" warning, which is what should report the problem.
{
  try {
    if (resolveTitleFilterConfig({}) !== undefined) fail('empty config did not resolve to undefined');
    else if (resolveTitleFilterConfig(null) !== undefined) fail('null config did not resolve to undefined');
    else if (resolveTitleFilterConfig(undefined) !== undefined) fail('undefined config did not resolve to undefined');
    else pass('missing config resolves to undefined without throwing');
  } catch (err) {
    fail(`threw on missing config: ${err.message}`);
  }
}

// An explicitly empty override is a real choice, not a typo to fall back from:
// `??` must not treat it as absent or the user silently gets the broad profile.
{
  const empty = { positive: [] };
  const got = resolveTitleFilterConfig({ title_filter: broad, title_filter_full: empty });
  if (got === empty) pass('an empty title_filter_full is honoured, not silently ignored');
  else fail(`empty override fell back to ${JSON.stringify(got)}`);
}
