/**
 * updater-remote-manifest-user-paths.test.mjs — BEHAVIORAL coverage for the
 * guard on the FETCHED manifest.
 *
 * apply() reads SYSTEM_PATHS out of the updater it just fetched and merges it
 * into updatePaths, the list the per-path `git checkout FETCH_HEAD -- <path>`
 * walks. An entry naming user territory therefore writes upstream's content over
 * the user's own, and an UNTRACKED local file is invisible to the diff-based
 * #2337 detector — so it gets no .bak, is not preserved, and is then deleted by
 * the abort path as an addition HEAD lacks, while the run prints "your content
 * was NOT overwritten". Refusing the entry is what stops that sequence starting.
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

// Deterministic stand-ins for the three local-state questions the rule asks.
// Every block passes these: without them rejectUserLayerPaths falls back to a
// real `git ls-files` and existsSync against whatever checkout the suite happens
// to run in, which makes the outcome depend on the developer's tree and throws
// outright where there is no git. The values below deliberately DISAGREE with
// this repo — documents/GUIDE.md and data/outcomes/posting.md do not exist here —
// so a regression to the real probes cannot keep these assertions green.
const TRACKED = new Set(['writing-samples/README.md', 'documents/README.md',
  'documents/.gitkeep', 'interview-prep/sessions/.gitkeep']);
const ON_DISK = new Set([...TRACKED, 'data/applications.md', 'interview-prep/story-bank.md']);
const UPSTREAM = ['data/outcomes/posting.md', 'documents/README.md', 'modes/pdf/hm-audit.md'];
const probes = {
  tracked: (p) => TRACKED.has(p),
  exists: (p) => ON_DISK.has(p),
  claimsSubtree: (p) => p.endsWith('/')
    || UPSTREAM.some((f) => f.startsWith(`${p.replace(/\/$/, '')}/`)),
};

console.log('\n🧪 Testing rejectUserLayerPaths (fetched manifest vs local user layer)...');

{
  // Given: upstream's manifest names a declared user FILE
  const remote = ['modes/oferta.md', 'cv.md'];

  // When: the manifest is split against the local user layer
  const { kept, refused } = rejectUserLayerPaths(remote, USER_PATHS, probes);

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
  const { kept, refused } = rejectUserLayerPaths(remote, USER_PATHS, probes);

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
  const { kept, refused } = rejectUserLayerPaths(remote, USER_PATHS, probes);

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
  const { kept, refused } = rejectUserLayerPaths(remote, USER_PATHS, probes);

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
  const { kept, refused } = rejectUserLayerPaths(remote, USER_PATHS, probes);

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
  const { kept, refused } = rejectUserLayerPaths(remote, USER_PATHS, probes);

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
  const { kept, refused } = rejectUserLayerPaths(remote, USER_PATHS, probes);

  // Then: it passes through untouched, in input order
  if (refused.length === 0 && kept.join('\n') === remote.join('\n')) {
    pass('an ordinary manifest passes through unchanged and in order');
  } else {
    fail(`an ordinary manifest must pass through unchanged — kept=${JSON.stringify(kept)}`);
  }
}

{
  // Given: the SAME claims spelled without a trailing slash. `git checkout <ref>
  // -- documents` and `-- documents/` name one tree, so a rule keyed on the slash
  // is bypassed by dropping one character (CodeRabbit, PR #3947).
  const remote = ['documents', 'data', 'modes', 'interview-prep'];

  // When: the manifest is split
  const { kept, refused } = rejectUserLayerPaths(remote, USER_PATHS, probes);

  // Then: every one is refused, exactly as its slashed spelling would be
  if (refused.length === remote.length && kept.length === 0) {
    pass('slashless user-directory entries are refused (documents, data, modes, interview-prep)');
  } else {
    fail(`slashless entries must be refused — kept=${JSON.stringify(kept)}`);
  }
}

{
  // Given: a directory nested in user territory, spelled without a slash. Its
  // directory-ness is knowable only from the tree being checked out.
  const remote = ['data/outcomes'];

  // When: the manifest is split
  const { kept, refused } = rejectUserLayerPaths(remote, USER_PATHS, probes);

  // Then: refused — a subtree claim is open-ended, so it cannot be adjudicated once
  if (refused.includes('data/outcomes') && kept.length === 0) {
    pass('a slashless nested directory is refused via the upstream tree');
  } else {
    fail(`a slashless nested directory must be refused — kept=${JSON.stringify(kept)}`);
  }
}

{
  // Given: single files inside user directories that are the USER's own work —
  // untracked and present. Path shape cannot tell these from a system-owned doc.
  const remote = ['data/applications.md', 'interview-prep/story-bank.md'];

  // When: the manifest is split
  const { kept, refused } = rejectUserLayerPaths(remote, USER_PATHS, probes);

  // Then: refused. Untracked-and-present is precisely the unrecoverable case —
  // no .bak, nothing in the stash, nothing on the backup branch.
  if (refused.length === remote.length && kept.length === 0) {
    pass('an untracked user file inside a user directory is refused');
  } else {
    fail(`an untracked user file must be refused — kept=${JSON.stringify(kept)}`);
  }
}

{
  // Given: a system-owned doc inside a user directory, tracked by this install
  const remote = ['writing-samples/README.md', 'documents/README.md'];

  // When: the manifest is split
  const { kept, refused } = rejectUserLayerPaths(remote, USER_PATHS, probes);

  // Then: kept — git can restore it, and refusing it is the #958 non-arrival
  if (kept.length === remote.length && refused.length === 0) {
    pass('a tracked system-owned doc inside a user directory is kept');
  } else {
    fail(`a tracked system doc must be kept — refused=${JSON.stringify(refused)}`);
  }
}

{
  // Given: a new upstream file inside a user directory, absent from this install
  const remote = ['documents/GUIDE.md'];

  // When: the manifest is split
  const { kept, refused } = rejectUserLayerPaths(remote, USER_PATHS, probes);

  // Then: kept — there is nothing local to lose, so refusing it would only stop
  // new upstream files from ever arriving (#958)
  if (kept.includes('documents/GUIDE.md') && refused.length === 0) {
    pass('a new upstream file absent from this install is kept');
  } else {
    fail(`a new absent upstream file must be kept — refused=${JSON.stringify(refused)}`);
  }
}

{
  // Given: an empty fetched manifest, the older-target fallback path where
  // extractArrayFromSource() found nothing
  const remote = [];

  // When: the manifest is split
  const { kept, refused } = rejectUserLayerPaths(remote, USER_PATHS, probes);

  // Then: both sides are empty and the caller falls back as before
  if (kept.length === 0 && refused.length === 0) {
    pass('an empty fetched manifest yields nothing on either side');
  } else {
    fail('an empty fetched manifest must yield nothing on either side');
  }
}
