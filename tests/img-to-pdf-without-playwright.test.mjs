import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pass, fail, NODE, ROOT } from './helpers.mjs';

// A static `import` of playwright runs before argv is parsed, so --help and a
// missing image pay to load the browser package and crash when it is absent.
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

function run(args) {
  return spawnSync(NODE, ['--import', SIMULATE_PLAYWRIGHT_NOT_INSTALLED, join(ROOT, 'img-to-pdf.mjs'), ...args], {
    encoding: 'utf-8',
    timeout: 20000,
    env: { ...process.env, FORCE_COLOR: '0' },
  });
}

function crashedAtImport(result) {
  return /ERR_MODULE_NOT_FOUND|node:internal/.test(result.stderr || '');
}

const help = run(['--help']);
if (help.status === 0 && (help.stdout || '').includes('Usage: node img-to-pdf.mjs') && !crashedAtImport(help)) {
  pass('img-to-pdf --help prints usage without loading playwright');
} else {
  fail(`img-to-pdf --help without playwright exited ${help.status}: ${JSON.stringify(`${help.stdout || ''}\n${help.stderr || ''}`.slice(0, 400))}`);
}

const missing = run([join(tmpdir(), 'no-such-image.png'), join(tmpdir(), 'no-such-output.pdf')]);
const missingText = `${missing.stdout || ''}\n${missing.stderr || ''}`;
if (missing.status === 1 && /Image not found/.test(missingText) && !crashedAtImport(missing)) {
  pass('img-to-pdf reports a missing image without loading playwright');
} else {
  fail(`img-to-pdf missing image without playwright exited ${missing.status}: ${JSON.stringify(missingText.slice(0, 400))}`);
}
