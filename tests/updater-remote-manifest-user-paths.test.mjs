/**
 * updater-remote-manifest-user-paths.test.mjs — BEHAVIORAL coverage for the
 * guard on the FETCHED manifest.
 *
 * apply() reads SYSTEM_PATHS out of the updater it just fetched and merges it
 * into updatePaths. That list decides what the checkout overwrites AND, through
 * `updatePaths.includes(file)` in userLayerViolations(), what is excused from
 * the user-layer safety check — so an upstream entry naming a user path both
 * causes the damage and waives the check written to catch it. The guard is
 * disabled by the same entry that triggers it.
 *
 * rejectUserLayerPaths() is pure and exported for the same reason
 * userLayerViolations() is: apply() is ROOT-bound and full of side effects, so
 * the rule is pinned directly rather than inferred from an end-to-end run.
 *
 * The `writing-samples/README.md` case below is the important one. The obvious
 * implementation reuses the matcher already inlined in userLayerViolations()
 * and filters every remote path that touches the user layer — which silently
 * drops the four system-owned docs that legitimately ship inside user
 * directories today. That failure raises no error and produces no output; it
 * looks exactly like upstream not having changed those files, which is #958.
 */

import { pass, fail } from './helpers.mjs';
import { rejectUserLayerPaths } from '../update-system.mjs';

// A stand-in for effectiveUserPaths() covering both declaration forms: a
// trailing `/` is a directory, anything else is an exact file path.
const USER_PATHS = [
  'cv.md',
  'config/profile.yml',
  'modes/_profile.md',
  'documents/',
  'data/',
  'interview-prep/',
  'writing-samples/',
];

console.log('\n🧪 Testing rejectUserLayerPaths (fetched manifest vs local user layer)...');

{
  // Given: upstream's manifest names a declared user FILE
  const remote = ['modes/oferta.md', 'cv.md'];

  // When: the manifest is split against the local user layer
  const { kept, refused } = rejectUserLayerPaths(remote, USER_PATHS);

  // Then: the user file is refused and never reaches the checkout list
  if (refused.includes('cv.md') && !kept.includes('cv.md')) {
    pass('a declared user file (cv.md) is refused');
  } else {
    fail(`a declared user file (cv.md) must be refused — kept=${JSON.stringify(kept)}`);
  }
}

{
  // Given: upstream broadened a file entry to the user directory that holds it,
  // the realistic manifest-editing mistake this guard exists for
  const remote = ['documents/'];

  // When: the manifest is split
  const { kept, refused } = rejectUserLayerPaths(remote, USER_PATHS);

  // Then: the directory entry is refused
  if (refused.includes('documents/') && kept.length === 0) {
    pass('a user directory (documents/) is refused');
  } else {
    fail(`a user directory (documents/) must be refused — kept=${JSON.stringify(kept)}`);
  }
}

{
  // Given: upstream names a directory NESTED under a user directory, which no
  // exact-match rule would catch
  const remote = ['data/outcomes/'];

  // When: the manifest is split
  const { kept, refused } = rejectUserLayerPaths(remote, USER_PATHS);

  // Then: it is refused too — the overlap test runs in both directions
  if (refused.includes('data/outcomes/') && kept.length === 0) {
    pass('a directory nested under a user directory (data/outcomes/) is refused');
  } else {
    fail(`a nested user directory must be refused — kept=${JSON.stringify(kept)}`);
  }
}

{
  // Given: a directory entry that CONTAINS a declared user file rather than
  // sitting inside a user directory — `modes/` would claim modes/_profile.md
  const remote = ['modes/'];

  // When: the manifest is split
  const { kept, refused } = rejectUserLayerPaths(remote, USER_PATHS);

  // Then: refused, because the overlap is checked in the containing direction
  if (refused.includes('modes/') && kept.length === 0) {
    pass('a directory containing a declared user file (modes/) is refused');
  } else {
    fail(`a directory containing a user file must be refused — kept=${JSON.stringify(kept)}`);
  }
}

{
  // Given: the shipped pattern — system-owned docs living inside user
  // directories, exactly as SYSTEM_PATHS declares them today
  const remote = [
    'writing-samples/README.md',
    'documents/README.md',
    'documents/.gitkeep',
    'interview-prep/sessions/.gitkeep',
  ];

  // When: the manifest is split
  const { kept, refused } = rejectUserLayerPaths(remote, USER_PATHS);

  // Then: every one is kept. Refusing them is the #958 silent-non-arrival bug.
  if (refused.length === 0 && kept.length === remote.length) {
    pass('system-owned files inside user directories are kept (#958 guard)');
  } else {
    fail(`system-owned files inside user dirs must be kept — refused=${JSON.stringify(refused)}`);
  }
}

{
  // Given: upstream ships a genuinely NEW system-owned doc inside a user
  // directory, the case that makes this a filter and not an allowlist
  const remote = ['documents/GUIDE.md'];

  // When: the manifest is split
  const { kept, refused } = rejectUserLayerPaths(remote, USER_PATHS);

  // Then: it is allowed through, so new upstream files still arrive
  if (kept.includes('documents/GUIDE.md') && refused.length === 0) {
    pass('a new system-owned file inside a user directory is kept');
  } else {
    fail(`a new system-owned file must be kept — refused=${JSON.stringify(refused)}`);
  }
}

{
  // Given: an ordinary manifest with nothing touching the user layer
  const remote = ['modes/pdf/', 'modes/de/interview/', 'scan.mjs', 'AGENTS.md'];

  // When: the manifest is split
  const { kept, refused } = rejectUserLayerPaths(remote, USER_PATHS);

  // Then: it passes through untouched, in input order
  if (refused.length === 0 && kept.join('\n') === remote.join('\n')) {
    pass('an ordinary manifest passes through unchanged and in order');
  } else {
    fail(`an ordinary manifest must pass through unchanged — kept=${JSON.stringify(kept)}`);
  }
}

{
  // Given: an empty fetched manifest, the older-target fallback path where
  // extractArrayFromSource() found nothing
  const remote = [];

  // When: the manifest is split
  const { kept, refused } = rejectUserLayerPaths(remote, USER_PATHS);

  // Then: both sides are empty and the caller falls back as before
  if (kept.length === 0 && refused.length === 0) {
    pass('an empty fetched manifest yields nothing on either side');
  } else {
    fail('an empty fetched manifest must yield nothing on either side');
  }
}
