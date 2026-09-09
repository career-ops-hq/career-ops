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

import { pass, fail, ROOT } from './helpers.mjs';
import { rejectUserLayerPaths, manifestProbes } from '../update-system.mjs';

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
  // Given: entries that MEAN the user layer without spelling it that way.
  // `git checkout <ref> -- ./data` resolves to the same directory as `data/`,
  // and the checkout does not pass --literal-pathspecs, so `:(glob)` magic is
  // honoured too. Every comparison in the rule is literal segment work, so each
  // of these matches nothing and would sail through (CodeRabbit, PR #3947).
  // A NUL is included deliberately: child_process rejects the argument with
  // ERR_INVALID_ARG_VALUE before git starts, so an unrefused one kills apply()
  // with an opaque runtime error rather than naming the bad entry.
  const remote = [
    './data/', './documents', './/data', 'data//', 'documents/./',
    '..\\data', ':(glob)data/**', '/data/', 'data/../data/',
    `data${String.fromCharCode(0)}entry`,
    // Wildcards are magic without the announcing `:`, and the checkout cannot
    // pass --literal-pathspecs because it relies on :(exclude) specs. A default
    // pathspec wildcard matches `/` too, so `modes/*` claims modes/_profile.md.
    'modes/*', 'modes/?_profile.md', 'modes/[_]profile.md', 'mode*/',
  ];

  // When: the manifest is split
  const { kept, refused } = rejectUserLayerPaths(remote, USER_PATHS, probes);

  // Then: all of them are refused as malformed, before any overlap check
  if (refused.length === remote.length && kept.length === 0) {
    pass('non-canonical manifest spellings are refused as malformed');
  } else {
    fail(`non-canonical spellings must be refused — kept=${JSON.stringify(kept)}`);
  }
}

{
  // Given: the ordinary canonical spellings the real manifest actually ships
  const remote = ['modes/pdf/', 'scan.mjs', 'lib/context-budget.mjs', 'docs/FAQ.md'];

  // When: the manifest is split
  const { kept, refused } = rejectUserLayerPaths(remote, USER_PATHS, probes);

  // Then: the canonicality check refuses none of them
  if (refused.length === 0 && kept.length === remote.length) {
    pass('canonical system paths are unaffected by the malformed-path check');
  } else {
    fail(`canonical paths must pass — refused=${JSON.stringify(refused)}`);
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

// manifestProbes() is what apply() actually hands the rule. The blocks above use
// doubles, so they verify the RULE; these verify the WIRING — that the probes read
// the git output they are given. Left inline in apply(), this could only be checked
// by pattern-matching the source, and a source pattern cannot tell
// `trackedFiles.has(path)` from `() => true`.
console.log('\n🧪 Testing manifestProbes (git output -> the rule\'s three questions)...');

{
  // Given: `ls-files -z` output naming two tracked files
  const probes = manifestProbes({
    trackedOutput: 'writing-samples/README.md\0documents/README.md\0',
    upstreamOutput: '',
  });

  // When: the tracked probe is asked about a listed and an unlisted path
  // Then: it answers from that output, not from the surrounding checkout
  if (probes.tracked('writing-samples/README.md') && !probes.tracked('data/applications.md')) {
    pass('tracked() answers from the ls-files output it was given');
  } else {
    fail('tracked() does not read the ls-files output');
  }
}

{
  // Given: a NUL-delimited name that a newline split would mangle. core.quotePath
  // makes this the realistic shape, and it is why -z is used.
  const probes = manifestProbes({
    trackedOutput: 'documents/résumé notes.md\0documents/README.md\0',
    upstreamOutput: '',
  });

  // When/Then: the whole name survives as one entry
  if (probes.tracked('documents/résumé notes.md') && probes.tracked('documents/README.md')) {
    pass('tracked() parses NUL-delimited names whole');
  } else {
    fail('tracked() mangles NUL-delimited names');
  }
}

{
  // Given: an upstream tree that ships files under data/outcomes but not under
  // documents/GUIDE.md, which is a blob
  const probes = manifestProbes({
    trackedOutput: '',
    upstreamOutput: 'data/outcomes/posting.md\0documents/GUIDE.md\0',
  });

  // When/Then: only the path with files beneath it is a subtree claim
  if (probes.claimsSubtree('data/outcomes') && !probes.claimsSubtree('documents/GUIDE.md')) {
    pass('claimsSubtree() distinguishes a tree from a blob using the upstream listing');
  } else {
    fail('claimsSubtree() does not read the upstream listing');
  }
}

{
  // Given: any probes, asked about a trailing-slash entry
  const probes = manifestProbes({ trackedOutput: '', upstreamOutput: '' });

  // When/Then: an explicit slash is a subtree claim without consulting the tree,
  // so an entry upstream ships nothing under yet is still refused
  if (probes.claimsSubtree('documents/')) {
    pass('claimsSubtree() honours an explicit trailing slash with an empty tree');
  } else {
    fail('claimsSubtree() ignores an explicit trailing slash');
  }
}

{
  // Given: the repo root, derived from import.meta.url by helpers.mjs rather
  // than from process.cwd(), so the case does not depend on where the suite
  // was launched from
  const probes = manifestProbes({ trackedOutput: '', upstreamOutput: '', root: ROOT });

  // When/Then: it reports on the real filesystem under that root
  if (probes.exists('update-system.mjs') && !probes.exists('no-such-file-xyz.md')) {
    pass('exists() resolves against the root it was given');
  } else {
    fail('exists() does not resolve against the given root');
  }
}
