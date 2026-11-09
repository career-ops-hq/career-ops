/**
 * tests/updater-reexec-closure.test.mjs — the self-reexec checkout includes the static
 * imports of REEXEC_FALLBACK_FILES, not only of update-system.mjs (#4999).
 *
 * The v1.35.0 → v1.36.0 apply crashed with ERR_MODULE_NOT_FOUND: cv-templates.mjs, a
 * fallback file loaded by the target updater, gained `import … from
 * './lib/template-manifest.mjs'`, and resolveReexecCheckout() appended the fallback
 * files without walking their imports. The tree below reproduces that shape without a
 * repo, through the `readAt` seam.
 */
import { pass, fail } from './helpers.mjs';
import { resolveReexecCheckout, REEXEC_FALLBACK_FILES } from '../update-system.mjs';

const TREE = {
  'update-system.mjs': "import { helper } from './lib/updater-helper.mjs';\n",
  'lib/updater-helper.mjs': "import { readFileSync } from 'fs';\n",
  'cv-templates.mjs': "import { MANIFEST } from './lib/template-manifest.mjs';\nimport { isMainModule } from './lib/is-main-module.mjs';\n",
  'lib/template-manifest.mjs': "import { existsSync } from 'fs';\n",
  'lib/is-main-module.mjs': '',
  'path-resolver.mjs': '',
  // scaffolder/bin/skill-entrypoints.mjs deliberately absent: an older target lacks it.
};
const readAt = (file) => {
  if (!Object.prototype.hasOwnProperty.call(TREE, file)) throw new Error(`absent: ${file}`);
  return TREE[file];
};

if (!REEXEC_FALLBACK_FILES.includes('cv-templates.mjs')) {
  fail('fixture assumes cv-templates.mjs is a REEXEC_FALLBACK_FILES entry — update this test with the list');
} else {
  const files = resolveReexecCheckout('FETCH_HEAD', 'update-system.mjs', readAt);

  if (files.includes('lib/template-manifest.mjs')) pass('a fallback file\'s own static import is checked out before the re-exec (#4999)');
  else fail(`lib/template-manifest.mjs missing from the re-exec checkout: ${JSON.stringify(files)}`);

  if (files.includes('lib/updater-helper.mjs') && files[0] === 'update-system.mjs') pass('the entry and its own imports still come first');
  else fail(`entry closure missing or not first: ${JSON.stringify(files)}`);

  if (!files.includes('scaffolder/bin/skill-entrypoints.mjs')) pass('a fallback absent from the target tree is skipped, not checked out');
  else fail('an absent fallback file was listed for checkout');

  if (new Set(files).size === files.length) pass('each file is listed once, even when reached twice');
  else fail(`duplicates in the re-exec checkout: ${JSON.stringify(files)}`);
}
