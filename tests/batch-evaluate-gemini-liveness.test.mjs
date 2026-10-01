import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PATHS, processOffer } from '../batch-evaluate-gemini.mjs';
import { collectSeenUrls, collectSeenCompanyRoles } from '../scan.mjs';
import { pass, fail, rmSync, ROOT } from './helpers.mjs';

const inputLine = '- [ ] https://example.com/job | Acme | Product Manager';
const outcome = (status, reason = 'This posting has expired.') =>
  `---POSTING_OUTCOME---\n${JSON.stringify({ status, reason })}\n---END_POSTING_OUTCOME---`;
const score = `---SCORE_SUMMARY---
COMPANY: Acme
ROLE: Product Manager
SCORE: 4.2
ARCHETYPE: Product
LEGITIMACY: High Confidence
---END_SUMMARY---`;

async function withFixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'gemini-liveness-'));
  const oldPaths = { ...PATHS };
  const envKeys = ['CAREER_OPS_ROOT', 'CAREER_OPS_REPORTS_DIR', 'CAREER_OPS_TRACKER'];
  const oldEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  const tracker = '# Applications\n';
  try {
    PATHS.reports = join(root, 'reports');
    PATHS.trackerAdditions = join(root, 'additions');
    process.env.CAREER_OPS_ROOT = root;
    process.env.CAREER_OPS_REPORTS_DIR = PATHS.reports;
    process.env.CAREER_OPS_TRACKER = join(root, 'applications.md');
    writeFileSync(process.env.CAREER_OPS_TRACKER, tracker);
    const calls = { opened: 0, closed: 0, evaluated: 0 };
    const page = {
      status: 200,
      finalUrl: 'https://example.com/job',
      applyControls: [],
      text: 'Acme careers. This job has expired and no longer accepts applications. Browse our careers page for other available roles.',
    };
    const browser = {
      newPage: async () => {
        calls.opened++;
        return {
          route: async () => {},
          goto: async () => page.status === null ? null : { status: () => page.status },
          url: () => page.finalUrl,
          waitForTimeout: async () => {},
          evaluate: async fn => fn.name === 'extractApplyControls' ? page.applyControls : page.text,
          close: async () => { calls.closed++; },
        };
      },
    };
    const evaluate = text => async jd => {
      calls.evaluated++;
      assert.match(jd, /^URL: https:\/\/example\.com\/job/);
      return text;
    };
    const noArtifacts = () => {
      assert.equal(existsSync(PATHS.reports), false, 'no report directory or reservation');
      assert.equal(existsSync(PATHS.trackerAdditions), false, 'no tracker addition');
      assert.equal(readFileSync(process.env.CAREER_OPS_TRACKER, 'utf8'), tracker);
    };
    await run({ browser, calls, evaluate, noArtifacts, page, root });
  } finally {
    Object.assign(PATHS, oldPaths);
    for (const key of envKeys) {
      if (oldEnv[key] === undefined) delete process.env[key];
      else process.env[key] = oldEnv[key];
    }
    rmSync(root, { recursive: true, force: true });
  }
}

const cases = [
  ['confirmed closed posting is handled once without reports, reservations or TSVs', async fixture => {
    const { browser, evaluate, calls, noArtifacts } = fixture;
    const result = await processOffer(browser, inputLine, 1, evaluate(outcome('closed')));
    assert.equal(result.processed, true);
    assert.equal(result.line, '- [x] ~~https://example.com/job | Acme | Product Manager~~ — posting closed: This posting has expired.');
    assert.deepEqual(calls, { opened: 1, closed: 1, evaluated: 1 });
    noArtifacts();
    const repeated = await processOffer(browser, result.line, 2, evaluate(outcome('closed')));
    assert.equal(repeated.processed, false);
    assert.deepEqual(calls, { opened: 1, closed: 1, evaluated: 1 });
    noArtifacts();
  }],
  ...[
    ['live posting', 200, 'Acme is hiring a Product Manager. Apply now to lead our product roadmap and build useful customer experiences. '.repeat(4)],
    ['access wall', 403, 'Access denied. '.repeat(10)],
    ['401 wall containing stale closure text', 401, 'This job has expired. Sign in to continue. '.repeat(4)],
    ['bot challenge containing stale closure text', 200, 'Checking your browser before continuing. This job has expired. '.repeat(3)],
    ['rate limit containing stale closure text', 429, 'Too many requests. This job has expired. '.repeat(4)],
    ['server error containing stale closure text', 500, 'Service unavailable. This job has expired. '.repeat(4)],
    ['absent navigation response', null, 'This job has expired. '.repeat(8)],
    ['sparse non-closure content', 200, 'Acme Careers. Welcome to our company. '.repeat(4)],
    ['generic listing page', 200, '100 jobs found. Browse careers at Acme. '.repeat(10)],
  ].map(([label, status, text]) => [`model closed on ${label} remains pending`, async ({ browser, evaluate, noArtifacts, page }) => {
    Object.assign(page, { status, text });
    assert.deepEqual(await processOffer(browser, inputLine, 1, evaluate(outcome('closed'))), { line: inputLine, processed: false });
    noArtifacts();
  }]),
  ...[404, 410].map(status => [`actual HTTP ${status} closes a short page without model calls`, async ({ browser, evaluate, noArtifacts, page, calls }) => {
    Object.assign(page, { status, text: 'Gone' });
    const result = await processOffer(browser, inputLine, 1, evaluate('Must not call the model'));
    assert.equal(result.processed, true);
    assert.ok(result.line.endsWith(`posting closed: HTTP ${status}`));
    assert.deepEqual(calls, { opened: 1, closed: 1, evaluated: 0 });
    noArtifacts();
  }]),
  ...['Apply now', 'Aplikuj', 'Bewerben', '申请职位'].map(label => [`visible ${label} control vetoes a body closure`, async ({ browser, evaluate, noArtifacts, page }) => {
    page.applyControls = [label];
    assert.deepEqual(await processOffer(browser, inputLine, 1, evaluate(outcome('closed'))), { line: inputLine, processed: false });
    noArtifacts();
  }]),
  ['closed entries retain scan URL dedup without reserving company/role or location keys', async ({ browser, evaluate, noArtifacts }) => {
    for (const suffix of ['', ' | Berlin', ' | Berlin | posted: 2026-09-20']) {
      const line = inputLine + suffix;
      assert.equal(collectSeenCompanyRoles({ pipelineText: line }).size, 1, 'live fixture contributes a role key');
      const result = await processOffer(browser, line, 1, evaluate(outcome('closed')));
      assert.equal(result.processed, true);
      assert.ok(collectSeenUrls({ pipelineText: result.line }).seen.has('https://example.com/job'));
      for (const includeLocation of [false, true]) {
        assert.equal(collectSeenCompanyRoles({ pipelineText: result.line }, {}, undefined, { includeLocation }).size, 0);
      }
    }
    noArtifacts();
  }],
  ['plugin ingest recognizes a closed URL on repeated runs', async ({ browser, evaluate, noArtifacts, root }) => {
    const result = await processOffer(browser, inputLine, 1, evaluate(outcome('closed')));
    assert.equal(result.processed, true);
    const urlOnly = await processOffer(browser, '- [ ] https://example.com/job-only', 2, async () => outcome('closed'));
    const pipeline = '# Pipeline\n\n## Pending\n' + result.line + '\n' + urlOnly.line + '\n';
    mkdirSync(join(root, 'data'));
    writeFileSync(join(root, 'data', 'pipeline.md'), pipeline);
    mkdirSync(join(root, 'config'));
    writeFileSync(join(root, 'config', 'plugins.yml'), 'plugins:\n  fixture-ingest: { enabled: true }\n');
    const plugin = join(root, 'plugins', 'fixture-ingest');
    mkdirSync(plugin, { recursive: true });
    writeFileSync(join(plugin, 'manifest.json'), JSON.stringify({
      id: 'fixture-ingest', apiVersion: 1, description: 'Local fixture',
      humanInTheLoop: true, hooks: ['ingest'], entry: 'index.mjs',
    }));
    writeFileSync(join(plugin, 'index.mjs'), 'export default { ingest: async () => [{ title: "Product Manager", company: "Acme", url: "https://example.com/job" }, { title: "Engineer", url: "https://example.com/job-only" }] };');
    // Run the actual plugin CLI against this isolated root. Relocate imports,
    // leaving its parser, dedup filter and writer untouched.
    const require = createRequire(import.meta.url);
    const cli = readFileSync(join(ROOT, 'plugins.mjs'), 'utf8').replace(/from '([^']+)'/g, (match, specifier) => {
      if (specifier.startsWith('.')) return `from '${pathToFileURL(join(ROOT, specifier)).href}'`;
      if (specifier === 'js-yaml') return `from '${pathToFileURL(require.resolve(specifier)).href}'`;
      return match;
    });
    const cliPath = join(root, 'plugins.mjs');
    writeFileSync(cliPath, cli);
    for (let run = 0; run < 2; run++) {
      const output = execFileSync(process.execPath, [cliPath, 'run', 'fixture-ingest'], { cwd: root, encoding: 'utf8', timeout: 15000 });
      assert.match(output, /fixture-ingest ingest: 2 found, 0 new/);
      assert.equal(readFileSync(join(root, 'data', 'pipeline.md'), 'utf8'), pipeline);
    }
    noArtifacts();
  }],
  ['closed reason stays on one pipeline line', async ({ browser, evaluate, noArtifacts }) => {
    const result = await processOffer(browser, inputLine, 1, evaluate(outcome('closed', 'Expired\r\n\tNo longer accepting applications')));
    assert.equal(result.processed, true);
    assert.ok(result.line.endsWith('posting closed: Expired No longer accepting applications'));
    assert.doesNotMatch(result.line, /[\r\n\t]/);
    noArtifacts();
  }],
  ...[
    ['unconfirmed or access-blocked', outcome('unconfirmed', 'Access denied; cannot establish liveness.')],
    ['free-text closed verdict without a marker', 'This posting has expired. No report will be generated.'],
    ['missing both summaries', 'Unable to evaluate this posting.'],
    ['invalid JSON', '---POSTING_OUTCOME---\n{status: closed}\n---END_POSTING_OUTCOME---'],
    ['unknown status', outcome('unknown')],
    ['missing reason', '---POSTING_OUTCOME---\n{"status":"closed"}\n---END_POSTING_OUTCOME---'],
    ['empty reason', outcome('closed', '   ')],
    ['non-string reason', outcome('closed', 404)],
    ['array instead of object', '---POSTING_OUTCOME---\n[]\n---END_POSTING_OUTCOME---'],
    ['duplicate markers', outcome('closed') + '\n' + outcome('closed')],
    ['conflicting outcomes', outcome('closed') + '\n' + outcome('unconfirmed')],
    ['truncated marker', '---POSTING_OUTCOME---\n{"status":"closed","reason":"Expired"}'],
    ['malformed delimiter alongside score', '---POSTING_OUTCOME--\n' + score],
    ['orphan end marker with a score', '---END_POSTING_OUTCOME---\n' + score],
    ['closed plus a score', outcome('closed') + '\n' + score],
    ['closed plus truncated score', outcome('closed') + '\n---SCORE_SUMMARY---\nSCORE: 4.2'],
  ].map(([label, output]) => [label + ' remains pending without artifacts', async ({ browser, evaluate, noArtifacts, calls }) => {
    const result = await processOffer(browser, inputLine, 1, evaluate(output));
    assert.deepEqual(result, { line: inputLine, processed: false });
    assert.equal(calls.closed, 1);
    noArtifacts();
  }]),
  ['short or blocked scrape stays pending without calling the model', async ({ browser, evaluate, noArtifacts, calls }) => {
    const newPage = browser.newPage;
    browser.newPage = async () => ({ ...await newPage(), evaluate: async () => 'Access denied' });
    assert.deepEqual(await processOffer(browser, inputLine, 1, evaluate(outcome('closed'))), { line: inputLine, processed: false });
    assert.equal(calls.evaluated, 0);
    assert.equal(calls.closed, 1);
    noArtifacts();
  }],
  ...['', 'Posting is live, so no POSTING_OUTCOME block is emitted.\n'].map(preamble => ['active score evaluation tolerates incidental protocol-name prose: ' + JSON.stringify(preamble), async ({ browser, evaluate, page }) => {
    page.text = 'Acme is hiring a Product Manager. Apply now to lead our product roadmap and build useful customer experiences. '.repeat(4);
    const result = await processOffer(browser, inputLine, 1, evaluate(preamble + score));
    assert.deepEqual(result, { line: inputLine.replace('[ ]', '[x]'), processed: true });
    const reports = readdirSync(PATHS.reports).filter(name => !name.endsWith('-RESERVED.md'));
    assert.equal(reports.length, 1);
    assert.match(readFileSync(join(PATHS.reports, reports[0]), 'utf8'), /\*\*Score:\*\* 4\.2/);
    const additions = readdirSync(PATHS.trackerAdditions);
    assert.equal(additions.length, 1);
    assert.match(readFileSync(join(PATHS.trackerAdditions, additions[0]), 'utf8'), /Acme\tProduct Manager\tEvaluated\t4\.2\/5/);
  }]),
];

// Await fixtures before returning from the discovered suite: PATHS/env are shared
// with later suites when test-all imports this file in-process.
for (const [name, run] of cases) {
  try {
    await withFixture(run);
    pass(`Gemini liveness: ${name}`);
  } catch (error) {
    fail(`Gemini liveness: ${name}: ${error.message}`);
    process.exitCode = 1;
  }
}
