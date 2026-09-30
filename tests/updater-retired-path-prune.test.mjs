// tests/updater-retired-path-prune.test.mjs — a path retired from the tree must
// stay in SYSTEM_PATHS until no supported install can still be carrying it.
//
// `apply()` deletes files that upstream has removed via `staleSystemFiles`,
// which only considers a local file that is BOTH absent from the remote tree
// AND matched by a SYSTEM_PATHS entry (`pathMatchesManifest`). So the manifest
// entry is what gives the prune its reach, and removing the entry in the same
// change that deletes the file is precisely backwards: the file stops shipping
// to new installs and becomes permanent on existing ones.
//
// #3765 hit this. Moving five root suites into tests/ made their SYSTEM_PATHS
// entries look redundant — `tests/` already covers the destination — so they
// were dropped. Probed against the production function, that left an upgrading
// install holding all five forever, where tests/root-tests-registration.test.mjs
// reports them as unregistered suites and turns a healthy install's
// `node test-all.mjs` red. Found in review by @nikitacometa.
import { readFileSync } from 'fs';
import { join } from 'path';
import { staleSystemFiles } from '../update-system.mjs';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nupdate-system.mjs — retired paths stay prunable');

const RETIRED = [
  'agent-inbox-tests.mjs',
  'followup-seed-tests.mjs',
  'paste-reply-tests.mjs',
  'set-status-tests.mjs',
  'tracker-columns-tests.mjs',
];

const src = readFileSync(join(ROOT, 'update-system.mjs'), 'utf-8');
const block = src.match(/const SYSTEM_PATHS = \[([\s\S]*?)\n\];/);
const systemPaths = block ? Array.from(block[1].matchAll(/'([^']+)'/g), (m) => m[1]) : [];

if (systemPaths.length > 0) {
  pass(`SYSTEM_PATHS parsed (${systemPaths.length} entries)`);
} else {
  fail('could not parse SYSTEM_PATHS — this guard would pass vacuously');
}

// An upgrading install: it still holds the retired files, upstream does not.
const local = [...RETIRED, 'test-all.mjs', 'tests/set-status.test.mjs'];
const remote = ['test-all.mjs', 'tests/set-status.test.mjs'];
const pruned = staleSystemFiles(local, remote, systemPaths);

const missed = RETIRED.filter((p) => !pruned.includes(p));
if (missed.length === 0) {
  pass(`all ${RETIRED.length} retired root suites are still reachable by the stale-file prune`);
} else {
  fail(
    `${missed.length} retired path(s) would survive an upgrade forever — nothing in SYSTEM_PATHS matches them:\n` +
      missed.map((n) => `    ${n}`).join('\n') +
      '\n  Keep the entry in the "Retired paths" block until no supported install can still carry the file.',
  );
}

// The prune must not become indiscriminate: a file gone from the remote tree
// but matched by NO manifest entry is not ours to delete.
const untracked = staleSystemFiles(['some-user-scratch-file.md'], remote, systemPaths);
if (untracked.length === 0) {
  pass('a non-manifest file that vanished upstream is left alone');
} else {
  fail(`prune claimed ${JSON.stringify(untracked)} — it must only touch manifest paths`);
}
