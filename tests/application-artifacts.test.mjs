import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { applicationArtifactPaths, ensureApplicationArtifactDirs, slugifySegment, writeReuseDecision } from '../application-artifacts.mjs';
import { repoRelativeManifestPath, workspaceRelativeManifestPath } from '../generate-pdf.mjs';

function expectError(label, action, pattern) {
  try {
    action();
  } catch (error) {
    if (pattern.test(error.message)) {
      console.log(`  ✅ ${label}`);
      return;
    }
    throw new Error(`${label}: unexpected error: ${error.message}`);
  }
  throw new Error(`${label}: expected an error`);
}

const root = mkdtempSync(join(tmpdir(), 'career-ops-application-artifacts-'));
try {
  const paths = applicationArtifactPaths({ reportNum: 7, company: 'Acme AI', role: 'Senior AI Engineer', version: 2, root });
  if (paths.key === '007-acme-ai-senior-ai-engineer'
      && paths.cv.source.html === join(paths.root, 'cv', 'source', 'original.html')
      && paths.cv.tailored.pdf === join(paths.root, 'cv', 'tailored', 'v002', 'cv.pdf')) {
    console.log('  ✅ application artifacts use a stable report/company/role bundle');
  } else {
    throw new Error(`unexpected artifact paths: ${JSON.stringify(paths)}`);
  }

  ensureApplicationArtifactDirs(paths);
  if (existsSync(join(paths.root, 'jd'))
      && existsSync(join(paths.root, 'cv', 'source'))
      && existsSync(join(paths.root, 'cv', 'tailored', 'v002'))
      && existsSync(join(paths.root, 'decision'))) {
    console.log('  ✅ application artifact directories initialize together');
  } else {
    throw new Error('application artifact directories were not created');
  }

  writeReuseDecision(paths, {
    decision: 'reuse-with-edits',
    score: 0.81,
    sourceCv: paths.cv.source.html,
    currentJd: paths.jd.current,
    previousSource: paths.jd.previous,
    changedSections: ['Summary', 'Skills'],
  });
  const decision = JSON.parse(readFileSync(paths.decision.reuse, 'utf8'));
  if (decision.decision === 'reuse-with-edits' && decision.changed_sections.length === 2) {
    console.log('  ✅ reuse decisions are recorded beside the artifact bundle');
  } else {
    throw new Error(`unexpected reuse decision: ${JSON.stringify(decision)}`);
  }

  expectError('report numbers must be numeric', () => applicationArtifactPaths({ reportNum: 'x', company: 'Acme', role: 'Engineer', root }), /reportNum must be a numeric report number/);
  expectError('versions must be positive integers', () => applicationArtifactPaths({ reportNum: 7, company: 'Acme', role: 'Engineer', version: 0, root }), /version must be a positive integer/);
  expectError('reuse decisions reject unknown values', () => writeReuseDecision(paths, { decision: 'maybe' }), /decision must be one of/);
  expectError('changed sections must be an array', () => writeReuseDecision(paths, { decision: 'reuse', changedSections: 'Summary' }), /changedSections must be an array/);
  if (slugifySegment('!!!') === 'application') console.log('  ✅ punctuation-only slugs use the application fallback');
  else throw new Error('punctuation-only slug did not use the application fallback');

  const repoPaths = applicationArtifactPaths({ reportNum: 7, company: 'Acme AI', role: 'Senior AI Engineer', version: 2, root: join(process.cwd(), 'output') });
  if (workspaceRelativeManifestPath(repoPaths.cv.tailored.html) === 'output/007-acme-ai-senior-ai-engineer/cv/tailored/v002/cv.html'
      && workspaceRelativeManifestPath(repoPaths.cv.tailored.pdf) === 'output/007-acme-ai-senior-ai-engineer/cv/tailored/v002/cv.pdf'
      && repoRelativeManifestPath(repoPaths.cv.tailored.pdf) === workspaceRelativeManifestPath(repoPaths.cv.tailored.pdf)) {
    console.log('  ✅ nested application HTML and PDF paths remain manifest-safe');
  } else {
    throw new Error('nested application paths were not preserved as repo-relative manifest entries');
  }

  const cli = spawnSync(process.execPath, [
    fileURLToPath(new URL('../application-artifacts.mjs', import.meta.url)),
    '--report', 'bad', '--company', 'Acme', '--role', 'Engineer', '--init',
  ], { encoding: 'utf8' });
  if (cli.status === 1
      && /application-artifacts: reportNum must be a numeric report number/.test(cli.stderr)
      && !/\n\s+at /.test(cli.stderr)) {
    console.log('  ✅ CLI validation failures exit cleanly without a stack trace');
  } else {
    throw new Error(`CLI failure was not clean: status=${cli.status} stderr=${JSON.stringify(cli.stderr)}`);
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
