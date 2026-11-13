// tests/eval-runner-number-settings.test.mjs — ollama-eval, openai-eval and
// openai-tailor reject a numeric setting that is not a whole number, or a
// timeout setTimeout cannot hold.
//
// They read OLLAMA_NUM_CTX, OLLAMA_TIMEOUT_MS and OPENAI_TIMEOUT_MS with
// parseInt, which stops at the first non-digit: "32k" was a 32-token context and
// "5m" or "300s" a timeout of 5 or 300 ms. A timeout above 2^31-1 ms passed too,
// and AbortSignal.timeout() fires such a delay after 1 ms (above 2^32-1 it
// throws). Each case below now stops with "Invalid ..." before any request.
//
// A preload replaces fetch() so no case can reach a server, whichever way the
// script goes: with the bug, the run gets as far as a request and fails there
// (`reached` below), without the "Invalid ..." line.
import { pass, fail, rmSync, ROOT, NODE } from './helpers.mjs';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

console.log('\nModel runners — numeric settings must be whole numbers in range');

const work = mkdtempSync(join(tmpdir(), 'eval-number-settings-'));
const stub = join(work, 'stub-fetch.mjs');
writeFileSync(stub, 'globalThis.fetch = async () => { throw new Error("fetch stubbed in test"); };\n');
writeFileSync(join(work, 'jd.txt'), 'Senior Platform Engineer at Acme. Build and run the payments APIs.');
writeFileSync(join(work, 'report.md'), '# Report\n');
// openai-tailor loads the CV and the profile before it reads its settings.
writeFileSync(join(work, 'cv.md'), '# CV\n');
mkdirSync(join(work, 'config'), { recursive: true });
writeFileSync(join(work, 'config', 'profile.yml'), 'candidate:\n  full_name: Test\n');

// dotenv keeps a variable that is already set, even to '', so inherited
// settings are removed rather than blanked.
const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(OLLAMA_|OPENAI_|CAREER_OPS_)/.test(k)));
base.CAREER_OPS_ROOT = work;

const RUNNERS = {
  // ollama-eval probes the server first; the stub makes that probe fail.
  ollama: { script: 'ollama-eval.mjs', args: ['--no-save', 'Senior Platform Engineer at Acme.'], env: { OLLAMA_BASE_URL: 'http://127.0.0.1:9' }, reached: 'Ollama not reachable' },
  'openai-eval': { script: 'openai-eval.mjs', args: ['--no-save', 'Senior Platform Engineer at Acme.'], env: { OPENAI_BASE_URL: 'http://127.0.0.1:9/v1', OPENAI_MODEL: 'test-model' }, reached: 'fetch stubbed' },
  'openai-tailor': { script: 'openai-tailor.mjs', args: ['--jd', join(work, 'jd.txt'), '--report', join(work, 'report.md')], env: { OPENAI_BASE_URL: 'http://127.0.0.1:9/v1', OPENAI_MODEL: 'test-model' }, reached: 'fetch stubbed' },
};

function run(name, env) {
  const { script, args, env: runnerEnv } = RUNNERS[name];
  const r = spawnSync(NODE, ['--import', pathToFileURL(stub).href, join(ROOT, script), ...args], {
    cwd: work, env: { ...base, ...runnerEnv, ...env }, encoding: 'utf8', input: '', timeout: 60000,
  });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const REJECTED = [
  ['ollama', 'OLLAMA_NUM_CTX', '32k'],
  ['ollama', 'OLLAMA_TIMEOUT_MS', '5m'],
  ['ollama', 'OLLAMA_TIMEOUT_MS', '3000000000'],
  ['openai-eval', 'OPENAI_TIMEOUT_MS', '300s'],
  ['openai-eval', 'OPENAI_TIMEOUT_MS', '3000000000'],
  ['openai-tailor', 'OPENAI_TIMEOUT_MS', '300s'],
  ['openai-tailor', 'OPENAI_TIMEOUT_MS', '3000000000'],
];

try {
  for (const [runner, variable, value] of REJECTED) {
    const r = run(runner, { [variable]: value });
    if (r.status === 1 && r.out.includes(`Invalid ${variable}: "${value}"`) && !r.out.includes(RUNNERS[runner].reached)) {
      pass(`${RUNNERS[runner].script} rejects ${variable}=${value} before any request`);
    } else {
      fail(`${RUNNERS[runner].script} accepted ${variable}=${value}: exit ${r.status}\n${r.out.slice(-600)}`);
    }
  }

  // Whole numbers in range still pass, and the run goes on to its request.
  const accepted = [
    ['ollama', { OLLAMA_NUM_CTX: '16384', OLLAMA_TIMEOUT_MS: '600000' }],
    ['openai-eval', { OPENAI_TIMEOUT_MS: '600000' }],
    ['openai-tailor', { OPENAI_TIMEOUT_MS: '2147483647' }],
  ];
  for (const [runner, env] of accepted) {
    const r = run(runner, env);
    if (!r.out.includes('Invalid ') && r.out.includes(RUNNERS[runner].reached)) {
      pass(`${RUNNERS[runner].script} accepts ${Object.entries(env).map(([k, v]) => `${k}=${v}`).join(' ')}`);
    } else {
      fail(`${RUNNERS[runner].script} rejected ${JSON.stringify(env)}: exit ${r.status}\n${r.out.slice(-600)}`);
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
