// tests/doctor-billing-source.test.mjs — the billing-source check in doctor.mjs.
//
// The check exists to tell a user which account their tokens are billed to, so
// a FALSE warning is worse than none: it tells someone who explicitly opted out
// of a cloud provider that they're billing to it. The cloud switches are
// documented as `=1`, which makes `=0` the natural way to turn one off.
import { pass, fail, NODE, ROOT } from './helpers.mjs';
import { execFileSync } from 'child_process';
import { join } from 'path';

console.log('\ndoctor.mjs — billing source');

const DOCTOR = join(ROOT, 'doctor.mjs');

/** Run doctor and return its human output (it exits non-zero when it finds issues). */
function runDoctor(env) {
  try {
    return execFileSync(NODE, [DOCTOR], {
      cwd: ROOT,
      env: { ...process.env, ...env },
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    return String(e.stdout || '');
  }
}

const CLOUD_VARS = ['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'];
// Clear every billing-related var so each case starts from a known state.
const CLEAN = Object.fromEntries(
  [...CLOUD_VARS, 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'].map((v) => [v, '']),
);

const warnsAbout = (out, v) => new RegExp(`${v} is set`).test(out);

// Truthy values must warn — the check's actual job.
for (const value of ['1', 'true']) {
  const out = runDoctor({ ...CLEAN, CLAUDE_CODE_USE_BEDROCK: value });
  if (warnsAbout(out, 'CLAUDE_CODE_USE_BEDROCK')) {
    pass(`CLAUDE_CODE_USE_BEDROCK=${value} warns that requests bill to the cloud account`);
  } else {
    fail(`CLAUDE_CODE_USE_BEDROCK=${value} did not warn`);
  }
}

// Explicit opt-outs must NOT warn. Mere presence used to be enough, so `=0`
// told a user who had just disabled Bedrock that they were billing to it.
for (const value of ['0', 'false', 'no', 'off', '']) {
  const out = runDoctor({ ...CLEAN, CLAUDE_CODE_USE_BEDROCK: value });
  if (!warnsAbout(out, 'CLAUDE_CODE_USE_BEDROCK')) {
    pass(`CLAUDE_CODE_USE_BEDROCK=${JSON.stringify(value)} is an opt-out and stays quiet`);
  } else {
    fail(`CLAUDE_CODE_USE_BEDROCK=${JSON.stringify(value)} produced a false cloud-billing warning`);
  }
}

// The other two switches share the rule.
for (const v of ['CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY']) {
  const on = runDoctor({ ...CLEAN, [v]: '1' });
  const off = runDoctor({ ...CLEAN, [v]: '0' });
  if (warnsAbout(on, v) && !warnsAbout(off, v)) {
    pass(`${v} warns at =1 and stays quiet at =0`);
  } else {
    fail(`${v} truthiness handling is inconsistent with CLAUDE_CODE_USE_BEDROCK`);
  }
}

// An API key still takes precedence and must still be reported.
{
  const out = runDoctor({ ...CLEAN, ANTHROPIC_API_KEY: 'sk-ant-test' });
  if (/ANTHROPIC_API_KEY is set/.test(out)) {
    pass('an API key in the environment is still reported as the billing source');
  } else {
    fail('the API key path regressed');
  }
}
