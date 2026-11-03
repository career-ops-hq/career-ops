import { pass, fail, NODE, ROOT } from './helpers.mjs';
import { spawnSync } from 'child_process';
import { join } from 'path';

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

const run = (args) => spawnSync(NODE, ['--import', SIMULATE_PLAYWRIGHT_NOT_INSTALLED, join(ROOT, 'check-liveness.mjs'), ...args], {
  encoding: 'utf-8',
  timeout: 30000,
});

console.log('\ncheck-liveness — playwright package not loadable');

const help = run(['--help']);
if (help.status === 0 && (help.stdout || '').includes('Usage:')) pass('--help prints usage without playwright');
else fail(`--help without playwright exited ${help.status}: ${JSON.stringify((help.stderr || '').slice(0, 300))}`);

const batch = run(['--no-record', 'https://careers.example.com/closed/job-1']);
const out = `${batch.stdout || ''}${batch.stderr || ''}`;
if (batch.status === 1) pass('a browser-needing URL without playwright exits 1 (uncertain)');
else fail(`a browser-needing URL without playwright exited ${batch.status}: ${JSON.stringify(out.slice(0, 300))}`);
if (/uncertain/.test(batch.stdout || '') && /browser unavailable/.test(batch.stdout || '') && /npm install/.test(batch.stdout || '') && !/npx playwright install/.test(batch.stdout || '')) pass('the URL is reported uncertain and a missing package points at npm install');
else fail(`the URL was not reported uncertain with npm install: ${JSON.stringify(out.slice(0, 400))}`);
if (!/ERR_MODULE_NOT_FOUND|node:internal/.test(batch.stderr || '')) pass('no module-resolution stack trace');
else fail(`check-liveness crashed at import: ${JSON.stringify((batch.stderr || '').slice(0, 300))}`);
