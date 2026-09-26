// tests/user-layer-untracked.test.mjs
//
// A .gitignore rule does not remove a file that was already committed. Parse the
// canonical User Layer table and ask Git for files that are both tracked and
// ignored, which is the signature of that late-rule privacy leak.

import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';

/**
 * Parse repo-relative paths from DATA_CONTRACT.md's User Layer table.
 *
 * @param {string} markdown
 * @returns {string[]}
 */
export function parseUserLayerPaths(markdown) {
  const section = markdown.match(/^## User Layer \(NEVER auto-updated\)\s*$([\s\S]*?)(?=^##?\s|(?![\s\S]))/m)?.[1];
  if (!section) throw new Error('DATA_CONTRACT.md is missing the User Layer section');

  const paths = [];
  for (const line of section.split(/\r?\n/)) {
    const path = line.match(/^\|\s*`([^`]+)`/)?.[1];
    if (!path) continue;
    if (path.startsWith('/') || path.split('/').includes('..')) {
      throw new Error(`unsafe User Layer path in DATA_CONTRACT.md: ${path}`);
    }
    paths.push(path);
  }
  if (paths.length === 0) throw new Error('DATA_CONTRACT.md User Layer table contains no paths');
  return [...new Set(paths)];
}

/**
 * Convert a contract entry to a Git pathspec. Placeholder/glob rows protect the
 * whole containing directory; exact file rows remain exact.
 *
 * @param {string} path
 * @returns {string}
 */
function toPathspec(path) {
  const wildcard = path.search(/[\*{]/);
  if (wildcard === -1) return path;
  const slash = path.lastIndexOf('/', wildcard);
  return slash === -1 ? '.' : path.slice(0, slash + 1);
}

/**
 * Return User Layer files that Git still tracks despite an ignore rule.
 *
 * @param {string} root
 * @param {string[]} paths
 * @returns {string[]}
 */
export function trackedIgnoredUserLayerFiles(root, paths) {
  const pathspecs = [...new Set(paths.map(toPathspec))];
  const result = spawnSync(
    'git',
    ['ls-files', '--cached', '--ignored', '--exclude-standard', '-z', '--', ...pathspecs],
    { cwd: root, encoding: 'utf-8' },
  );
  if (result.status !== 0) {
    const detail = (result.stderr || result.error?.message || `git exited ${result.status}`).trim();
    throw new Error(`git ls-files could not audit tracked User Layer files: ${detail}`);
  }
  return result.stdout.split('\0').filter(Boolean).sort();
}

console.log('\n🔒 user-layer files are absent from the Git index');

try {
  const contract = readFileSync(join(ROOT, 'DATA_CONTRACT.md'), 'utf-8');
  const paths = parseUserLayerPaths(contract);
  pass(`parsed ${paths.length} user-layer paths from DATA_CONTRACT.md`);

  const violations = trackedIgnoredUserLayerFiles(ROOT, paths);
  if (violations.length === 0) {
    pass('no ignored User Layer file remains tracked');
  } else {
    for (const path of violations) {
      fail(`${path} is User Layer, git-ignored, and still tracked — remove it from the index`);
    }
  }
} catch (error) {
  fail(error.message);
}

try {
  const eofContract = [
    '# Data Contract',
    '',
    '## User Layer (NEVER auto-updated)',
    '',
    '| File | Purpose |',
    '|------|---------|',
    '| `cv.md` | Personal CV |',
  ].join('\n');
  const eofPaths = parseUserLayerPaths(eofContract);
  if (eofPaths.length === 1 && eofPaths[0] === 'cv.md') {
    pass('parses a User Layer section at end of file');
  } else {
    fail(`end-of-file fixture expected only cv.md, got: ${eofPaths.join(', ') || '(none)'}`);
  }
} catch (error) {
  fail(`end-of-file User Layer fixture failed: ${error.message}`);
}

// Regression fixture: a rule added after a personal file was committed must be
// detected, while a negated system scaffold inside a protected directory stays
// allowed.
const fixture = mkdtempSync(join(tmpdir(), 'career-ops-user-layer-index-'));
try {
  mkdirSync(join(fixture, 'documents'));
  writeFileSync(join(fixture, 'DATA_CONTRACT.md'), `# Data Contract

## User Layer (NEVER auto-updated)

| File | Purpose |
|------|---------|
| \`cv.md\` | Personal CV |
| \`*.md\` | Root-level personal Markdown files |
| \`documents/*\` | Personal sources; README is system-owned |

## System Layer
`);
  writeFileSync(join(fixture, 'cv.md'), 'private');
  writeFileSync(join(fixture, 'documents', 'README.md'), 'scaffold');
  writeFileSync(join(fixture, '.gitignore'), '*.md\n!DATA_CONTRACT.md\ndocuments/*\n!documents/\n!documents/README.md\n');

  for (const args of [
    ['init', '-q'],
    ['add', '.gitignore', 'DATA_CONTRACT.md', 'documents/README.md'],
    ['add', '-f', 'cv.md'],
  ]) {
    const result = spawnSync('git', args, { cwd: fixture, encoding: 'utf-8' });
    if (result.status !== 0) throw new Error((result.stderr || `git ${args[0]} failed`).trim());
  }

  const paths = parseUserLayerPaths(readFileSync(join(fixture, 'DATA_CONTRACT.md'), 'utf-8'));
  const violations = trackedIgnoredUserLayerFiles(fixture, paths);
  if (violations.length === 1 && violations[0] === 'cv.md') {
    pass('root wildcard finds tracked personal files without flagging a negated scaffold');
  } else {
    fail(`fixture expected only cv.md to remain tracked-and-ignored, got: ${violations.join(', ') || '(none)'}`);
  }
} catch (error) {
  fail(`tracked User Layer regression fixture failed: ${error.message}`);
} finally {
  rmSync(fixture, { recursive: true, force: true });
}

// Regression fixture: the supported route for a fork that runs the suite in CI
// (#4128). The coverage guard needs `config/local-paths.txt` visible to CI, and
// this guard forbids a User Layer file that is ignored AND tracked. Un-ignoring
// it satisfies both — it is then tracked and NOT ignored — and that has to keep
// being true, or the documented escape stops working without anything saying so.
const forkFixture = mkdtempSync(join(tmpdir(), 'career-ops-fork-local-paths-'));
try {
  mkdirSync(join(forkFixture, 'config'));
  writeFileSync(join(forkFixture, 'DATA_CONTRACT.md'), `# Data Contract

## User Layer (NEVER auto-updated)

| File | Purpose |
|------|---------|
| \`config/local-paths.txt\` | Fork-local declarations |

## System Layer
`);
  writeFileSync(join(forkFixture, 'config', 'local-paths.txt'), 'nightly.mjs\n');
  // The upstream rule, then the fork's negation — order matters to Git.
  writeFileSync(join(forkFixture, '.gitignore'), 'config/local-paths.txt\n!config/local-paths.txt\n');

  for (const args of [['init', '-q'], ['add', '.gitignore', 'DATA_CONTRACT.md', 'config/local-paths.txt']]) {
    const result = spawnSync('git', args, { cwd: forkFixture, encoding: 'utf-8' });
    if (result.status !== 0) throw new Error((result.stderr || `git ${args[0]} failed`).trim());
  }

  const forkPaths = parseUserLayerPaths(readFileSync(join(forkFixture, 'DATA_CONTRACT.md'), 'utf-8'));
  const forkViolations = trackedIgnoredUserLayerFiles(forkFixture, forkPaths);
  if (forkViolations.length === 0) {
    pass('a fork that un-ignores config/local-paths.txt may commit it (#4128)');
  } else {
    fail(`negated local-paths fixture expected no violation, got: ${forkViolations.join(', ')}`);
  }

  // The control: without the negation the same commit IS the leak this guard is for.
  writeFileSync(join(forkFixture, '.gitignore'), 'config/local-paths.txt\n');
  const stillTracked = trackedIgnoredUserLayerFiles(forkFixture, forkPaths);
  if (stillTracked.length === 1 && stillTracked[0] === 'config/local-paths.txt') {
    pass('committing it while it stays ignored is still flagged (#4128 control)');
  } else {
    fail(`ignored-and-tracked control expected config/local-paths.txt, got: ${stillTracked.join(', ') || '(none)'}`);
  }
} catch (error) {
  fail(`fork local-paths fixture failed: ${error.message}`);
} finally {
  rmSync(forkFixture, { recursive: true, force: true });
}
