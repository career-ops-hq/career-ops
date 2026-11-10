// tests/openrouter-runner-exit-status.test.mjs — openrouter-runner.mjs exits 1
// when a command does not do its job, so a script or scheduler that checks the
// status (`npm run or:eval` from cron) can tell a failed run from a good one.
// Every case below used to exit 0.
//
// Nothing here reaches the network: CAREER_OPS_MODEL pins a model, so the free
// model list is never fetched, OPENROUTER_API_KEY is set empty, so a request
// stops at the key check, and a preload replaces fetch() as a backstop.
import { pass, fail, rmSync, ROOT, NODE } from './helpers.mjs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

console.log('\nopenrouter-runner.mjs — a failed or mistyped command exits 1');

const root = mkdtempSync(join(tmpdir(), 'openrouter-exit-root-'));
const cwd = mkdtempSync(join(tmpdir(), 'openrouter-exit-cwd-'));
const stub = join(cwd, 'stub-fetch.mjs');
writeFileSync(stub, 'globalThis.fetch = async () => { throw new Error("fetch stubbed in test"); };\n');

// A key or model from the developer's shell would change which path runs.
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(OPENROUTER_|CAREER_OPS_)/.test(k)));
env.CAREER_OPS_ROOT = root;
env.CAREER_OPS_MODEL = 'test/model';
// Empty, not absent: the runner fills an absent variable from the checkout's
// .env. On a configured checkout that is a real key, and a profile path would
// point loadContext(), which runs for every command, at the developer's own
// profile. An empty CAREER_OPS_PROFILE reads the profile under `root`.
env.OPENROUTER_API_KEY = '';
env.CAREER_OPS_PROFILE = '';

function run(...args) {
  const r = spawnSync(NODE, ['--import', pathToFileURL(stub).href, join(ROOT, 'openrouter-runner.mjs'), ...args], {
    cwd, env, encoding: 'utf8', input: '', timeout: 60000,
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function expect(label, r, status, test, detail) {
  if (r.status === status && test(r)) pass(label);
  else fail(`${label} — ${detail}: exit ${r.status}\n${(r.stdout + r.stderr).slice(0, 600)}`);
}

try {
  const typo = run('evalute', 'https://example.com/jobs/1');
  expect('an unknown command exits 1 and names it on stderr', typo, 1,
    (r) => r.stderr.includes('unknown command "evalute"') && r.stderr.includes('COMMANDS:'), 'not reported as a failure');

  for (const help of [[], ['help'], ['--help'], ['-h']]) {
    const r = run(...help);
    expect(`${help[0] ?? 'no command'} prints the usage and exits 0`, r, 0,
      (x) => x.stdout.includes('COMMANDS:'), 'usage not printed as a success');
  }

  const noReport = run('apply');
  expect('apply without a report exits 1', noReport, 1,
    (r) => r.stderr.includes('Usage: node openrouter-runner.mjs apply'), 'not reported as a failure');

  const missing = run('apply', '999');
  expect('apply for a report that does not exist exits 1', missing, 1,
    (r) => r.stderr.includes('Report not found: 999'), 'not reported as a failure');

  const unevaluated = run('evaluate', 'Senior Platform Engineer at Acme. Build and run the payments APIs.');
  expect('an evaluation that saves no report exits 1', unevaluated, 1,
    (r) => r.stderr.includes('OPENROUTER_API_KEY not found'), 'not reported as a failure');
} finally {
  rmSync(root, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
}
