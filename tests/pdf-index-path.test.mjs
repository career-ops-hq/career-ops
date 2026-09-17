// tests/pdf-index-path.test.mjs — the PDF manifest must follow the tracker (#2471).
//
// sync-pdf-flags.mjs and find.mjs used to resolve data/pdf-index.tsv from their
// own install directory while resolving the tracker through CAREER_OPS_TRACKER.
// Redirecting the tracker therefore reconciled one workspace's rows against
// another workspace's manifest: the merge-tracker suite read the developer's
// real manifest and flipped an isolated fixture's PDF cells, so `node
// test-all.mjs` failed locally for anyone who had ever generated a PDF while
// staying green in CI (data/ is gitignored).
import { pass, fail } from './helpers.mjs';
import { join } from 'path';
import { resolveWorkspaceRoot, resolvePdfIndexPath } from '../tracker-utils.mjs';

console.log('\nPDF manifest follows the tracker (#2471)');

// Env is process-wide and discovered suites run in-process, so every mutation
// is restored — a leaked CAREER_OPS_PDF_INDEX would silently retarget later
// suites (PIT: each case must stand alone, in any order).
function withPdfIndexEnv(value, body) {
  const previous = process.env.CAREER_OPS_PDF_INDEX;
  if (value === undefined) delete process.env.CAREER_OPS_PDF_INDEX;
  else process.env.CAREER_OPS_PDF_INDEX = value;
  try {
    return body();
  } finally {
    if (previous === undefined) delete process.env.CAREER_OPS_PDF_INDEX;
    else process.env.CAREER_OPS_PDF_INDEX = previous;
  }
}

// Both sides of every path assertion are built with join(), so the separator
// matches on Windows too (the suite runs on windows-latest). Deliberately NOT
// resolve(): resolve() resolves against cwd and so prepends the current drive
// on Windows, while resolveWorkspaceRoot() derives its answer with dirname(),
// which never drive-qualifies — `C:\ws` vs `\ws` would fail there.
const WORKSPACE = join('/ws');

// Given a tracker in the data/ layout, When resolving its workspace root,
// Then it is the tracker's grandparent (where reports/ and data/ live).
{
  const root = resolveWorkspaceRoot(join(WORKSPACE, 'data', 'applications.md'));
  if (root === WORKSPACE) pass('data/ layout: workspace root is the tracker\'s parent directory');
  else fail(`data/ layout: expected ${WORKSPACE}, got ${root}`);
}

// Given a tracker in the root layout, When resolving its workspace root,
// Then it is the tracker's own directory.
{
  const root = resolveWorkspaceRoot(join(WORKSPACE, 'applications.md'));
  if (root === WORKSPACE) pass('root layout: workspace root is the tracker\'s own directory');
  else fail(`root layout: expected ${WORKSPACE}, got ${root}`);
}

// Given no override, When resolving the manifest for a tracker,
// Then it sits under that tracker's workspace in both layouts.
withPdfIndexEnv(undefined, () => {
  const fromData = resolvePdfIndexPath(join(WORKSPACE, 'data', 'applications.md'));
  const fromRoot = resolvePdfIndexPath(join(WORKSPACE, 'applications.md'));
  const expected = join(WORKSPACE, 'data', 'pdf-index.tsv');
  if (fromData === expected && fromRoot === expected) {
    pass('manifest resolves under the tracker\'s workspace in both layouts');
  } else {
    fail(`manifest path wrong: data-layout=${fromData} root-layout=${fromRoot} expected=${expected}`);
  }
});

// Given CAREER_OPS_PDF_INDEX, When resolving, Then the override wins outright.
withPdfIndexEnv('/elsewhere/custom-index.tsv', () => {
  const resolved = resolvePdfIndexPath(join('/ws', 'data', 'applications.md'));
  if (resolved === '/elsewhere/custom-index.tsv') pass('CAREER_OPS_PDF_INDEX overrides the derived path');
  else fail(`override ignored: got ${resolved}`);
});

// THE REGRESSION (#2471). Given a tracker redirected into an isolated
// workspace, When resolving the manifest with no override, Then it must be that
// workspace's own manifest — never the career-ops install directory's, which is
// how an isolated run came to read real user data.
//
// Asserted as exact equality rather than a prefix match: a prefix would also
// accept a wrong filename or a nested path inside the workspace.
withPdfIndexEnv(undefined, () => {
  const isolatedWorkspace = join('/tmp', 'career-ops-fixture');
  const resolved = resolvePdfIndexPath(join(isolatedWorkspace, 'data', 'applications.md'));
  const expected = join(isolatedWorkspace, 'data', 'pdf-index.tsv');
  if (resolved === expected) {
    pass('a redirected tracker resolves its own workspace manifest, not the install directory\'s');
  } else {
    const installManifest = join(process.cwd(), 'data', 'pdf-index.tsv');
    const leaked = resolved === installManifest ? " — that is the install directory's manifest" : '';
    fail(`#2471 regression: expected ${expected}, got ${resolved}${leaked}`);
  }
});
