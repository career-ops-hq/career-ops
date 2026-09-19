// Exercise the real save paths without models, credentials, or personal data.
// A relocated tracker still owns its IDs when its old report files are absent.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { fail, linkRepoPackage, NODE, pass, rmSync, ROOT } from './helpers.mjs';

const exec = promisify(execFile);
const evaluation = `Synthetic evaluation.
---SCORE_SUMMARY---
COMPANY: Example Company
ROLE: Engineer
SCORE: 4.2
ARCHETYPE: IC
LEGITIMACY: High Confidence
---END_SUMMARY---`;
const postingUrl = 'https://example.invalid/jobs/synthetic';

function write(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf-8');
}

function trackerText(row, report) {
  return '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n'
    + '| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n'
    + `| ${row} | 2026-01-01 | Previous Company | Engineer | 4/5 | Evaluated | - | [${report}](reports/${report}-previous.md) | fixture |\n`;
}

// Copy only the evaluator's code and system inputs. Running from the developer's
// real checkout could let its tracker mask the regression or read their CV.
function prepareCode(codeRoot, engine) {
  const files = [
    `${engine}-eval.mjs`, 'path-resolver.mjs', 'profile-language.mjs',
    'reserve-report-num.mjs', 'tracker-parse.mjs', 'tracker-aliases.json',
    'tracker-utils.mjs', 'pipeline-lock.mjs', 'lib/is-main-module.mjs',
    'lib/context-budget.mjs', 'utils/token-tracker.mjs',
    'modes/_shared.md', 'modes/oferta.md',
  ];
  for (const file of files) {
    const dest = join(codeRoot, file);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(ROOT, file), dest);
  }
  linkRepoPackage(codeRoot, 'js-yaml');
  write(join(codeRoot, 'data/applications.md'), trackerText(7, 7));
}

function isolatedEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^(CAREER_OPS_|OPENAI_|OLLAMA_|DOTENV_|NODE_OPTIONS$|NODE_PATH$|HTTPS?_PROXY$|ALL_PROXY$)/i.test(key),
  ));
}

const cases = [
  { name: 'CAREER_OPS_ROOT', envKey: 'CAREER_OPS_ROOT', expected: 74 },
  { name: 'CAREER_OPS_DATA_DIR', envKey: 'CAREER_OPS_DATA_DIR', expected: 74 },
  { name: 'relative data root', envKey: 'CAREER_OPS_ROOT', relative: true, expected: 74 },
  { name: 'relative marker file', marker: true, expected: 74 },
  { name: 'legacy applications.md', envKey: 'CAREER_OPS_ROOT', legacy: true, expected: 74 },
  { name: 'explicit tracker wins', envKey: 'CAREER_OPS_ROOT', override: true, expected: 109 },
  { name: 'default code/data root', defaultRoot: true, expected: 8 },
  { name: 'first run without tracker', envKey: 'CAREER_OPS_ROOT', noTracker: true, expected: 1 },
  { name: 'report files also reserve IDs', envKey: 'CAREER_OPS_ROOT', existingReport: true, expected: 91 },
];

console.log('\nevaluator report reservations follow the configured data root');
for (const engine of ['openai', 'ollama']) {
  for (const scenario of cases) {
    const sandbox = mkdtempSync(join(tmpdir(), 'co-eval-reservation-'));
    const codeRoot = join(sandbox, 'code');
    const dataRoot = scenario.defaultRoot ? codeRoot : join(sandbox, 'external');
    const requests = [];
    let server;
    try {
      prepareCode(codeRoot, engine);
      write(join(dataRoot, 'cv.md'), '# Synthetic Candidate\nBuilds synthetic test software.\n');
      write(join(dataRoot, 'config/profile.yml'), 'language:\n  output: en\n');
      write(join(dataRoot, 'modes/_profile.md'), '# Synthetic targeting\nEngineering roles.\n');
      const dataTracker = join(dataRoot, scenario.legacy ? 'applications.md' : 'data/applications.md');
      if (!scenario.defaultRoot && !scenario.noTracker) write(dataTracker, trackerText(42, 73));
      const env = {
        ...isolatedEnv(), OPENAI_API_KEY: '', OPENAI_TIMEOUT_MS: '15000',
        OLLAMA_TIMEOUT_MS: '15000', OLLAMA_NUM_CTX: '32768',
      };
      if (scenario.envKey) env[scenario.envKey] = scenario.relative ? '../external' : dataRoot;
      if (scenario.marker) write(join(codeRoot, '.career-ops-data'), '../external\n');
      if (scenario.override) {
        env.CAREER_OPS_TRACKER = join(sandbox, 'custom/applications.md');
        write(env.CAREER_OPS_TRACKER, trackerText(108, 108));
      }
      if (scenario.existingReport) write(join(dataRoot, 'reports/090-existing.md'), 'Existing report.\n');
      const trackerPaths = [join(codeRoot, 'data/applications.md'), dataTracker, env.CAREER_OPS_TRACKER]
        .filter(path => path && existsSync(path));
      const before = new Map(trackerPaths.map(path => [path, readFileSync(path, 'utf-8')]));

      server = createServer((req, res) => {
        if (req.method === 'GET' && req.url === '/api/tags') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ models: [{ name: 'synthetic-test' }] }));
          return;
        }
        const expectedPath = engine === 'ollama' ? '/api/chat' : '/v1/chat/completions';
        if (req.method !== 'POST' || req.url !== expectedPath) {
          res.writeHead(404);
          res.end('Unexpected endpoint');
          return;
        }
        let raw = '';
        req.on('data', chunk => { raw += chunk; });
        req.on('end', () => {
          requests.push(raw);
          if (engine === 'ollama') {
            res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
            res.end([
              { message: { content: evaluation }, done: false },
              { message: { content: '' }, done: true, prompt_eval_count: 100, eval_count: 30 },
            ].map(chunk => JSON.stringify(chunk)).join('\n') + '\n');
          } else {
            res.writeHead(200, { 'Content-Type': 'text/event-stream' });
            res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: evaluation } }] })}\n\n`
              + `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`
              + 'data: [DONE]\n\n');
          }
        });
      });
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      const baseUrl = `http://127.0.0.1:${server.address().port}`;
      const { stdout, stderr } = await exec(NODE, [
        join(codeRoot, `${engine}-eval.mjs`), '--url', engine === 'openai' ? `${baseUrl}/v1` : baseUrl,
        '--model', 'synthetic-test', '--posting-url', postingUrl, 'Synthetic engineering job description.',
      ], { cwd: sandbox, env, timeout: 30000, maxBuffer: 2 * 1024 * 1024 });

      assert.equal(requests.length, 1, 'exactly one evaluation request');
      assert.match(requests[0], /Synthetic Candidate/, 'the request uses the fixture CV');
      assert.doesNotMatch(stdout + stderr, /Could not save report|Could not release report reservation/);
      const prefix = String(scenario.expected).padStart(3, '0');
      const reports = readdirSync(join(dataRoot, 'reports'));
      const created = reports.filter(name => name !== '090-existing.md');
      assert.equal(created.length, 1, `one report, no leftover reservation: ${reports.join(', ')}`);
      assert.ok(created[0].startsWith(`${prefix}-example-company-`),
        `expected report ${prefix}, got ${created[0]}`);
      const additionsDir = join(dataRoot, 'batch/tracker-additions');
      assert.deepEqual(readdirSync(additionsDir), [`${prefix}-example-company.tsv`]);
      const [header, row] = readFileSync(join(additionsDir, `${prefix}-example-company.tsv`), 'utf-8').trim().split('\n');
      const addition = Object.fromEntries(header.split('\t').map((key, i) => [key, row.split('\t')[i]]));
      assert.equal(addition.num, String(scenario.expected));
      assert.equal(addition.report, `[${prefix}](reports/${created[0]})`);
      assert.equal(addition.url, postingUrl);
      for (const [path, original] of before) assert.equal(readFileSync(path, 'utf-8'), original, 'tracker stays unchanged until merge');
      if (!scenario.defaultRoot) {
        assert.equal(existsSync(join(codeRoot, 'reports')), false, 'no report in the installation');
        assert.equal(existsSync(join(codeRoot, 'batch/tracker-additions')), false, 'no addition in the installation');
      }
      pass(`${engine}: ${scenario.name} reserves ${prefix} and saves a matching addition`);
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
}
