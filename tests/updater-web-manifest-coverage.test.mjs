/**
 * updater-web-manifest-coverage.test.mjs — reproduce the stale-web updater gap.
 *
 * The updater fetches the target updater source, extracts SYSTEM_PATHS, and then
 * checks out only the merged manifest pathspecs. If `web/` is missing from all
 * updater path manifests, an upgraded install can keep an older `web/` tree
 * forever while the core moves on, and the post-checkout verification cannot
 * flag it because it only checks target-declared paths.
 */

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';
import { extractArrayFromSource } from '../update-system.mjs';

console.log('\n🧪 Testing updater web manifest coverage...');

const source = readFileSync(join(ROOT, 'update-system.mjs'), 'utf8');
const manifests = [
  ['SYSTEM_PATHS', extractArrayFromSource(source, 'SYSTEM_PATHS') || []],
  ['BOOTSTRAP_PATHS', extractArrayFromSource(source, 'BOOTSTRAP_PATHS') || []],
  ['USER_PATHS', extractArrayFromSource(source, 'USER_PATHS') || []],
];

const webEntries = manifests.flatMap(([name, paths]) =>
  paths.filter((entry) => entry === 'web/' || entry.startsWith('web/')).map((entry) => `${name}:${entry}`),
);

const webRoot = join(ROOT, 'web');
if (readdirSync(webRoot).length > 0) {
  pass('control: web/ exists in the repository and is non-empty');
} else {
  fail('control failed: web/ is unexpectedly empty, so the updater-coverage assertion proves nothing');
}

if (webEntries.length > 0) {
  pass(`updater manifest coverage includes web paths: ${webEntries.join(', ')}`);
} else {
  fail('web/ is absent from SYSTEM_PATHS, BOOTSTRAP_PATHS, and USER_PATHS, so apply() cannot refresh it on upgrade');
}
