// tests/providers/example-portals-routable.test.mjs — every enabled entry in
// the SHIPPED template must be reachable by something.
//
// Onboarding Step 3 is "Copy templates/portals.example.yml → portals.yml", so
// that file is where every user's scanning starts. An entry nothing claims is
// skipped by scan.mjs on every run while still reading as coverage — the
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
// "Unclaimed by a provider" is NOT the same as "not scanned", and conflating
// them is how the first version of this test overstated its finding by 22
// entries. findUnclaimedEntries() in audit-portals.mjs already draws the
// distinction scan.mjs draws, so it is reused here rather than reimplemented:
//
//   silent          no provider AND no scan_method -> scan.mjs skips it
//   handoff         no provider but scan_method set -> handed to the agent
//                   (WebSearch), which is mechanism 3 in this template's own
//                   header and entirely intentional
//   unknownProvider an explicit `provider:` naming something absent
//
// Only `silent` is the defect. Today that is one entry.

import { readFileSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';
import { pass, fail, warn, ROOT } from '../helpers.mjs';
import { loadProviders } from '../../providers/_registry.mjs';
import { findUnclaimedEntries } from '../../audit-portals.mjs';

console.log('\nProvider — every enabled entry in portals.example.yml is reachable');

// Entries scan.mjs would skip outright today. An allowlist that may only
// SHRINK, in the shape of KNOWN_WITHOUT_HELP in tests/help-flag-handled.test.mjs.
//
// Vinted has a branded careers_url, no `api:`, no `provider:` and no
// `scan_method:`. A branded domain is unroutable by design —
// ADDING_A_PROVIDER.md says "a branded/unrecognizable domain must not be
// matched by a URL-pattern" — so an entry like this needs an `api:`, a
// `provider:`, or a `scan_method:` to be reachable at all.
const KNOWN_SILENT = new Set(['Vinted']);

const TEMPLATE = join(ROOT, 'templates', 'portals.example.yml');
const config = yaml.load(readFileSync(TEMPLATE, 'utf-8'));
const entries = [...(config?.tracked_companies ?? []), ...(config?.job_boards ?? [])];

// loadProviders reports a skipped module on stderr and carries on; silenced so
// this test's output is about reachability, not module loading
// (tests/providers/registry-loads-every-provider.test.mjs owns that).
const realError = console.error;
console.error = () => {};
let providers;
try {
  providers = await loadProviders(join(ROOT, 'providers'));
} finally {
  console.error = realError;
}

// A guard on the guard: with no entries, every assertion below holds trivially
// and reports as coverage.
const enabledCount = entries.filter((e) => e && typeof e === 'object' && e.enabled !== false).length;
if (enabledCount >= 80) {
  pass(`${enabledCount} enabled entries in the shipped template`);
} else {
  fail(`only ${enabledCount} enabled entries parsed — the template read has lost its subject`);
}

const { silent, handoff, unknownProvider } = findUnclaimedEntries(entries, providers);

// ── An explicit provider: that does not exist is always a bug ──────────────
if (unknownProvider.length === 0) {
  pass('no entry names a provider that does not exist');
} else {
  fail(
    'these entries name a provider that is not loaded, so scan.mjs cannot run them: '
    + unknownProvider.map((r) => `${r.name} (${r.error})`).join(' | '),
  );
}

// ── The ratchet: the silent list may only shrink ───────────────────────────
{
  const unexpected = silent.map((r) => r.name).filter((name) => !KNOWN_SILENT.has(name));
  if (unexpected.length === 0) {
    pass(`no NEW silently-skipped entry (${silent.length} known)`);
  } else {
    fail(
      `these enabled entries have no provider AND no scan_method, so scan.mjs skips them on every run `
      + `while they read as coverage: ${unexpected.join(', ')}. Give each one an \`api:\`, a \`provider:\`, `
      + `or a \`scan_method:\` — see providers/ADDING_A_PROVIDER.md.`,
    );
  }
}

// The other end, so the list cannot rot into a description of nothing — the
// same reason KNOWN_WITHOUT_HELP asserts its own shrinkage.
{
  const names = new Set(silent.map((r) => r.name));
  const fixed = [...KNOWN_SILENT].filter((name) => !names.has(name));
  if (fixed.length === 0) {
    pass('every KNOWN_SILENT entry is still silently skipped');
  } else {
    fail(`these are now reachable and should be removed from KNOWN_SILENT in this file: ${fixed.join(', ')}`);
  }
}

// Not a failure, and deliberately not asserted: a scan_method entry is handed
// to the agent rather than skipped, which is intentional. Reported so the
// number stays visible — it is the line between "unclaimed" and "unscanned",
// and the first version of this test confused the two.
if (handoff.length > 0) {
  warn(
    `${handoff.length} enabled entries have no provider but carry a scan_method, so scan.mjs hands them `
    + `to the agent instead of fetching them (intentional — mechanism 3 in the template header)`,
  );
}
