// The evaluator user message carries the JD once; context still reserves its tokens.
// Run: node test-all.mjs --only evaluator-prompt-inputs
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { fail, linkRepoPackage, NODE, pass, rmSync, ROOT } from './helpers.mjs';

const exec = promisify(execFile);
const evaluation = 'Synthetic evaluation: caf\u00e9.\n---SCORE_SUMMARY---\nCOMPANY: Example\nROLE: Engineer\nSCORE: 4.2\nARCHETYPE: IC\nLEGITIMACY: High Confidence\n---END_SUMMARY---';
const jd = 'Synthetic JD marker: build reliable software with a team of engineers.\n## Responsibilities\nWrite tests.';
const systemText = message => typeof message.content === 'string' ? message.content : message.content.map(p => p.text).join('');
function write(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
}
async function fixture(engine, scenario, check) {
  const sandbox = mkdtempSync(join(tmpdir(), 'co-eval-contract-'));
  const code = join(sandbox, 'code');
  const data = join(sandbox, 'data');
  let server;
  const requests = [];
  try {
    // Copy the current shared layer so new evaluator imports cannot stale the fixture.
    mkdirSync(code, { recursive: true });
    cpSync(join(ROOT, 'lib'), join(code, 'lib'), { recursive: true });
    for (const file of [
      `${engine}-eval.mjs`, 'path-resolver.mjs', 'profile-language.mjs',
      'reserve-report-num.mjs', 'tracker-parse.mjs', 'tracker-aliases.json',
      'tracker-utils.mjs', 'pipeline-lock.mjs', 'utils/token-tracker.mjs',
    ]) {
      const dest = join(code, file);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(join(ROOT, file), dest);
    }
    linkRepoPackage(code, 'js-yaml');
    write(join(code, 'modes/_shared.md'), '## Scoring System\nUse evidence.\n');
    write(join(code, 'modes/oferta.md'), 'Evaluate the job.\n');
    write(join(data, 'cv.md'), '# Synthetic Candidate\nWrites reliable software.\n');
    write(join(data, 'config/profile.yml'), 'language:\n  output: en\n');
    write(join(data, 'modes/_profile.md'), 'SYNTHETIC_PROFILE_TARGET: engineering roles.\n');
    write(join(data, 'modes/_custom.md'), 'SYNTHETIC_CUSTOM_RULE: use evidence.\n');
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      !/^(CAREER_OPS_|OPENAI_|OLLAMA_|DOTENV_|NODE_OPTIONS$|NODE_PATH$|HTTPS?_PROXY$|ALL_PROXY$)/i.test(key)));
    Object.assign(env, { HOME: sandbox, USERPROFILE: sandbox, CAREER_OPS_ROOT: data, OPENAI_API_KEY: '', OPENAI_TIMEOUT_MS: '10000',
      OLLAMA_TIMEOUT_MS: '10000', OLLAMA_NUM_CTX: '32768' });
    await scenario.setup?.({ code, data, env });
    server = createServer((req, res) => {
      if (req.url === '/api/tags') { res.end('{"models":[]}'); return; }
      let raw = '';
      req.on('data', chunk => { raw += chunk; });
      req.on('end', () => {
        requests.push(JSON.parse(raw));
        res.setHeader('Content-Type', engine === 'openai' ? 'text/event-stream' : 'application/x-ndjson');
        res.end(complete(engine));
      });
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const url = `http://127.0.0.1:${server.address().port}`;
    let output;
    try {
      output = { code: 0, ...await exec(NODE, [join(code, `${engine}-eval.mjs`), '--url',
        engine === 'openai' ? `${url}/v1` : url, '--model', 'synthetic-test',
        ...(scenario.args ?? []), jd], { cwd: sandbox, env, timeout: 20000, maxBuffer: 2 * 1024 * 1024 }) };
    } catch (error) {
      output = { code: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
    }
    await check({ ...output, requests, codeRoot: code, data, env });
    pass(`${engine}: ${scenario.name}`);
  } catch (error) {
    fail(`${engine}: ${scenario.name}: ${error.message}`);
  } finally {
    if (server?.listening) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
    rmSync(sandbox, { recursive: true, force: true });
  }
}
function content(engine, text = evaluation) {
  return engine === 'openai'
    ? `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`
    : JSON.stringify({ message: { content: text }, done: false }) + '\n';
}
function terminal(engine, reason = 'stop') {
  return engine === 'openai'
    ? `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: reason }] })}\n\ndata: [DONE]\n\n`
    : JSON.stringify({ message: { content: '' }, done: true, done_reason: reason, prompt_eval_count: 321, eval_count: 123 }) + '\n';
}
function complete(engine) { return content(engine) + terminal(engine); }

console.log('\nEvaluator prompt inputs');
for (const engine of ['openai', 'ollama']) {
  for (const name of ['external profile', 'absent optional profile', 'marker data root', 'profile override', 'compressed context']) {
    await fixture(engine, { name, args: ['--no-save'], setup: ({ code, data, env }) => {
      if (name === 'absent optional profile') rmSync(join(data, 'modes/_profile.md'));
      if (name === 'profile override') {
        env.CAREER_OPS_PROFILE = join(data, 'alternate-profile.yml');
        write(env.CAREER_OPS_PROFILE, 'language:\n  output: en\nnorth_star: SYNTHETIC_YML_OVERRIDE\n');
      }
      if (name === 'compressed context') {
        write(join(code, 'modes/_shared.md'), '## Writing Style\n' + 'Optional style '.repeat(40000));
      }
      if (name === 'marker data root') {
        delete env.CAREER_OPS_ROOT;
        write(join(code, '.career-ops-data'), '../data\n');
      }
    } }, ({ code, stdout, stderr, requests }) => {
      assert.equal(code, 0, stderr);
      const system = systemText(requests[0].messages[0]);
      const user = requests[0].messages[1].content;
      assert.ok(system.includes('Synthetic Candidate'));
      assert.ok(system.includes('SYNTHETIC_CUSTOM_RULE'));
      if (name === 'profile override') assert.ok(system.includes('SYNTHETIC_YML_OVERRIDE'));
      if (name === 'compressed context') assert.match(stdout, /Trimmed sections:/);
      else assert.doesNotMatch(stdout, /Trimmed sections:/);
      assert.equal(system.includes('SYNTHETIC_PROFILE_TARGET'), name !== 'absent optional profile');
      assert.equal(system.includes(jd), false, 'JD must not also be in system context');
      assert.equal(user.split(jd).length - 1, 1, 'user message carries the one verbatim JD');
    });
  }
}
const { buildBudgetedPrompt, estimateTokens } = await import('../lib/context-budget.mjs');
for (const noCompress of [true, false]) {
  try {
    const longJd = 'Synthetic requirements '.repeat(400);
    const opts = { sharedContent: '## Writing Style\n' + 'Optional style '.repeat(300),
      ofertaContent: 'Score the job', cvContent: 'Synthetic CV', jdText: longJd,
      maxTokens: 4096, safetyMargin: 1500, noCompress };
    const original = buildBudgetedPrompt(opts);
    const separated = buildBudgetedPrompt({ ...opts, jdInContext: false });
    assert.deepEqual(separated.budgetReport, original.budgetReport, 'JD stays budgeted once');
    assert.ok(original.contextBody.includes(longJd), 'default behavior preserved for other engines');
    assert.equal(separated.contextBody.includes(longJd), false);
    assert.ok(separated.budgetReport.afterTokens >= estimateTokens(longJd));
    assert.equal(separated.budgetReport.compressed, !noCompress, 'fixture exercises both assembly paths');
    pass(`separate JD remains budgeted with noCompress=${noCompress}`);
  } catch (error) { fail(error.message); }
}
