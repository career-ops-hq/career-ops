import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pass, fail, NODE, ROOT } from './helpers.mjs';

// A static `import` of playwright runs before argv is parsed, so --help,
// --dry-run, and a missing pipeline pay to load the browser package and crash
// when it is absent.
const SIMULATE_PLAYWRIGHT_NOT_INSTALLED = 'data:text/javascript,' + encodeURIComponent(`
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(\`
export async function resolve(specifier, context, next) {
  if (specifier === 'playwright') {
    const err = new Error("Cannot find package 'playwright'");
    err.code = 'ERR_MODULE_NOT_FOUND';
    throw err;
  }
  return next(specifier, context);
}\`));
`);

const emptyRoot = mkdtempSync(join(tmpdir(), 'archive-no-pw-'));

function run(args) {
  return spawnSync(NODE, ['--import', SIMULATE_PLAYWRIGHT_NOT_INSTALLED, join(ROOT, 'archive-posting.mjs'), ...args], {
    encoding: 'utf-8',
    timeout: 20000,
    env: { ...process.env, FORCE_COLOR: '0', CAREER_OPS_ROOT: emptyRoot, CAREER_OPS_TRACKER: '' },
  });
}

function crashedAtImport(result) {
  return /ERR_MODULE_NOT_FOUND|node:internal/.test(result.stderr || '');
}

const help = run(['--help']);
if (help.status === 0 && /USAGE/.test(help.stdout || '') && !crashedAtImport(help)) {
  pass('archive-posting --help prints usage without loading playwright');
} else {
  fail(`archive-posting --help without playwright exited ${help.status}: ${JSON.stringify(`${help.stdout || ''}\n${help.stderr || ''}`.slice(0, 400))}`);
}

const dry = run(['--dry-run', 'https://boards.example.com/jobs/1']);
const dryText = `${dry.stdout || ''}\n${dry.stderr || ''}`;
if (dry.status === 0 && /dry-run/.test(dryText) && !crashedAtImport(dry)) {
  pass('archive-posting --dry-run previews a filename without loading playwright');
} else {
  fail(`archive-posting --dry-run without playwright exited ${dry.status}: ${JSON.stringify(dryText.slice(0, 400))}`);
}

const missing = run(['--pipeline']);
const missingText = `${missing.stdout || ''}\n${missing.stderr || ''}`;
if (missing.status === 1 && /pipeline\.md not found/.test(missingText) && !crashedAtImport(missing)) {
  pass('archive-posting --pipeline reports a missing pipeline without loading playwright');
} else {
  fail(`archive-posting --pipeline without playwright exited ${missing.status}: ${JSON.stringify(missingText.slice(0, 400))}`);
}
