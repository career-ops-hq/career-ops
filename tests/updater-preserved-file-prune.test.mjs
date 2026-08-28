/**
 * updater-preserved-file-prune.test.mjs — a file `apply()` just KEPT because
 * this install modified it (locallyModifiedSystemFiles → preservedPaths) must
 * never also be deleted by the separate stale-file prune step, and an asset a
 * kept file still references (e.g. a custom cv-template's font) must survive
 * too even when upstream no longer ships it.
 *
 * Reproduces the real-world failure: a user's own custom CV template (no
 * upstream counterpart at all) was backed up to .bak as "kept", then unlinked
 * by the stale-file prune step in the same `apply()` run, because the two
 * checks ran independently. The fonts that template's @font-face rules
 * pointed at were pruned right alongside it, for the same underlying reason.
 */

import { pass, fail } from './helpers.mjs';
import { staleSystemFiles, isReferencedByPreservedFile } from '../update-system.mjs';

console.log('\n🧪 Testing preserved-file vs. stale-file prune interaction...');

// ── 1. a preserved (locally-modified) file must not also be pruned as stale ──
{
  // Mirrors the real incident: a user's custom template has no upstream
  // counterpart at all, so a presence-only stale check flags it — exactly
  // what locallyModifiedSystemFiles already decided to keep and back up.
  const local = ['templates/cv-template.custom.html', 'templates/cv-template.html', 'fonts/eb-garamond-400.ttf'];
  const remote = ['templates/cv-template.html'];
  const system = ['templates/', 'fonts/'];
  const preserved = ['templates/cv-template.custom.html'];

  const withoutFix = staleSystemFiles(local, remote, system);
  if (withoutFix.includes('templates/cv-template.custom.html')) {
    pass('reproduces the bug: an un-widened stale check flags a file that was separately preserved');
  } else {
    fail('setup assumption broke: the un-widened stale check no longer flags the preserved file');
  }

  const withFix = staleSystemFiles(local, remote, system, preserved);
  if (!withFix.includes('templates/cv-template.custom.html')) {
    pass('a preserved file is excluded from the stale-file prune candidates');
  } else {
    fail('a preserved file was still selected for pruning');
  }
  if (withFix.includes('fonts/eb-garamond-400.ttf')) {
    pass('an unrelated stale file (no preserved counterpart) is still a prune candidate');
  } else {
    fail('the fix over-excluded: an unrelated stale file was dropped too');
  }
}

// ── 2. an asset referenced by a preserved file is protected even though it, ──
// ──    itself, was never locally modified (only orphaned by upstream)      ──
{
  const preserved = ['templates/cv-template.custom.html'];
  const fakeTemplateSource = `
    <style>
      @font-face { font-family: 'EB Garamond'; src: url('./fonts/eb-garamond-400.ttf') format('truetype'); }
    </style>
  `;
  const readFile = (path) => {
    if (path.endsWith('cv-template.custom.html')) return fakeTemplateSource;
    throw new Error(`ENOENT: ${path}`);
  };

  if (isReferencedByPreservedFile('fonts/eb-garamond-400.ttf', preserved, readFile)) {
    pass('a font referenced by a preserved template is detected as still needed');
  } else {
    fail('a referenced font was not detected — would still be pruned out from under the preserved template');
  }

  if (!isReferencedByPreservedFile('fonts/eb-garamond-700.ttf', preserved, readFile)) {
    pass('a font NOT mentioned in the preserved template is correctly reported as unreferenced');
  } else {
    fail('an unreferenced font was reported as referenced (false positive)');
  }

  // Scoping: only html/css preserved files are ever read for references — a
  // preserved .mjs/.md file with the same substring by coincidence must not
  // count, since system scripts/docs are not known to reference fonts by path.
  const preservedScript = ['build-cv-html.mjs'];
  const readScript = (path) => {
    if (path.endsWith('build-cv-html.mjs')) return "// mentions eb-garamond-400.ttf in a comment, not a real reference";
    throw new Error(`ENOENT: ${path}`);
  };
  if (!isReferencedByPreservedFile('fonts/eb-garamond-400.ttf', preservedScript, readScript)) {
    pass('a non-html/css preserved file is never consulted for asset references');
  } else {
    fail('a .mjs preserved file was incorrectly treated as an asset-reference source');
  }

  // A preserved path whose file cannot be read (e.g. already gone) must not
  // throw — the caller still needs to reach the other prune candidates.
  const readThrows = () => { throw new Error('EACCES'); };
  if (isReferencedByPreservedFile('fonts/eb-garamond-400.ttf', preserved, readThrows) === false) {
    pass('an unreadable preserved file fails closed (treated as no reference) instead of throwing');
  } else {
    fail('an unreadable preserved file should fail closed, not throw or report a false reference');
  }
}
