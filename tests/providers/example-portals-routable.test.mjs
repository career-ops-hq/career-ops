// tests/providers/example-portals-routable.test.mjs — every enabled entry in
// the SHIPPED template must route to a provider.
//
// Onboarding Step 3 is "Copy templates/portals.example.yml → portals.yml", so
// that file is where every user's scanning starts. An entry no provider claims
// is skipped by scan.mjs on every run while still reading as coverage — the
// failure AGENTS.md calls the highest-value check:
//
//   "no provider claims its careers_url (so scan.mjs skips it silently on
//    every run while it reads as coverage)"
//
// verify-pipeline.mjs check 15 is that audit, but it reads portals.yml — the
// user's gitignored copy — so it can only run after someone has copied the
// template, on their machine, where no CI signal reaches. The template itself
// was unchecked.
//
// Resolution goes through the registry's own resolveProvider with NO skipIds,
// because that is how scan.mjs resolves: an entry with a configured parser
// stanza legitimately routes to local-parser and must not count as unroutable.

import { readFileSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';
import { pass, fail, warn, ROOT } from '../helpers.mjs';
import { loadProviders, resolveProvider } from '../../providers/_registry.mjs';

console.log('\nProvider — every enabled entry in portals.example.yml routes somewhere');

// The entries that do not route today (#4982). An allowlist that may only
// SHRINK, in the shape of KNOWN_WITHOUT_HELP in tests/help-flag-handled.test.mjs.
//
// They are not a mystery: each has a branded careers_url and no `api:`, which
// is unroutable by design — ADDING_A_PROVIDER.md says "a branded/unrecognizable
// domain must not be matched by a URL-pattern", while this template's own
// header prefers the branded URL and uses OpenAI as the ✅ example. Both rules
// are right; an entry needs BOTH a branded careers_url and an api: to be
// scannable, the way Anthropic's does.
//
// Listing them is what makes the check adoptable in one change instead of
// turning it into a 23-entry research task. What to do with them — add an api:,
// set enabled: false, or keep them as documented examples — is a product call,
// and it is tracked in #4982. The rule here is that the list may not grow.
const KNOWN_UNROUTABLE = new Set([
  'Aiven', 'Bosch', 'Cognigy', 'Dialpad', 'Factorial', 'Genesys', 'Gong',
  'Klarna', 'Langfuse', 'LivePerson', 'Make.com (Celonis)', 'Maxim AI',
  'MessageBird', 'OpenAI', 'Revolut', 'Salesforce', 'Shopify', 'Talkdesk',
  'Tiqets', 'Twilio', 'Vinted', 'Zendesk', 'Zep AI',
]);

const TEMPLATE = join(ROOT, 'templates', 'portals.example.yml');
const config = yaml.load(readFileSync(TEMPLATE, 'utf-8'));

// loadProviders reports a skipped module on stderr and carries on; silenced
// here so this test's output is about routing, not about module loading
// (tests/providers/registry-loads-every-provider.test.mjs owns that).
const realError = console.error;
console.error = () => {};
let providers;
try {
  providers = await loadProviders(join(ROOT, 'providers'));
} finally {
  console.error = realError;
}

const enabled = [];
for (const key of ['tracked_companies', 'job_boards']) {
  for (const entry of config?.[key] ?? []) {
    if (entry?.enabled === false) continue;
    enabled.push({ entry, section: key });
  }
}

// A guard on the guard: with no entries, every assertion below holds trivially
// and reports as coverage.
if (enabled.length >= 80) {
  pass(`${enabled.length} enabled entries in the shipped template`);
} else {
  fail(`only ${enabled.length} enabled entries parsed — the template read has lost its subject`);
}

const unroutable = [];
for (const { entry, section } of enabled) {
  const resolved = resolveProvider(entry, providers);
  if (resolved?.provider) continue;
  if (resolved?.error) {
    // An explicit `provider:` naming something that does not exist is a
    // different and louder bug than "nothing claims this URL".
    fail(`${section} / ${entry.name}: ${resolved.error}`);
    continue;
  }
  unroutable.push(entry.name ?? '(unnamed)');
}

// ── The ratchet: the list may only shrink ──────────────────────────────────
{
  const unexpected = unroutable.filter((name) => !KNOWN_UNROUTABLE.has(name));
  if (unexpected.length === 0) {
    pass(`no NEW unroutable entry (${unroutable.length} known, see #4982)`);
  } else {
    fail(
      `these enabled entries route to no provider, so scan.mjs will skip them on every run while they `
      + `read as coverage: ${unexpected.join(', ')}. Give each one an \`api:\` (or a \`provider:\`) the `
      + `scanner can use, or set \`enabled: false\` so it reads as "not scanned" — see `
      + `providers/ADDING_A_PROVIDER.md and #4982.`,
    );
  }
}

// The other end, so the list cannot rot into a description of nothing — the
// same reason KNOWN_WITHOUT_HELP asserts its own shrinkage.
{
  const fixed = [...KNOWN_UNROUTABLE].filter((name) => !unroutable.includes(name));
  if (fixed.length === 0) {
    pass('every KNOWN_UNROUTABLE entry still routes to nothing');
  } else {
    fail(
      `these now route to a provider and should be removed from KNOWN_UNROUTABLE in this file: ${fixed.join(', ')}`,
    );
  }
}

// Not a failure: the count is the backlog, and saying it out loud each run is
// the point — an invisible 19% is how it stayed unnoticed.
if (unroutable.length > 0) {
  warn(
    `${unroutable.length} of ${enabled.length} enabled entries in portals.example.yml are not scannable `
    + `(#4982) — a new user copying this template starts with that many boards silently unscanned`,
  );
}
