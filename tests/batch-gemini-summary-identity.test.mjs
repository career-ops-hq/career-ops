import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const batch = new URL('../batch-evaluate-gemini.mjs', import.meta.url).href;
const merge = fileURLToPath(new URL('../merge-tracker.mjs', import.meta.url));
const url = 'https://jobs.example.com/positions/42';
const originalRow = `| 1 | 2026-11-01 | Example Corp | Platform Engineer | 3.0/5 | Applied | ❌ | — | User note | ${url} |`;
const fixture = `
  const { processOffer, finishPipelineBatch, PATHS } = await import(${JSON.stringify(batch)});
  const url = ${JSON.stringify(url)};
  const line = '- [ ] ' + url + ' | Example Corp | Platform Engineer';
  const page = {
    url: () => url, route: async () => {}, goto: async () => {},
    waitForTimeout: async () => {}, close: async () => {},
    evaluate: async () => 'Build reliable platforms and test production systems. '.repeat(4),
  };
  const result = await processOffer({ newPage: async () => page }, line, 1,
    async () => process.env.FIXTURE_SUMMARY, async () => ({ result: 'active' }));
  await finishPipelineBatch(PATHS.pipeline, [line, ''], new Map([[0, result]]));
`;

for (const { label, identity, valid } of [
  { label: 'missing role', identity: 'COMPANY: Example Corp' },
  { label: 'missing company', identity: 'ROLE: Platform Engineer' },
  { label: 'unknown role', identity: 'COMPANY: Example Corp\nROLE: Unknown' },
  { label: 'unknown company', identity: 'COMPANY: Unknown\nROLE: Platform Engineer' },
  { label: 'identified posting', identity: '**COMPANY:** Example Corp\n**ROLE:** Senior Platform Engineer', valid: true },
]) {
  test(`Gemini batch: ${label}`, (t) => {
    const root = mkdtempSync(join(tmpdir(), 'cops-gemini-summary-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const data = join(root, 'data');
    const tracker = join(data, 'applications.md');
    const pipeline = join(data, 'pipeline.md');
    const pending = `- [ ] ${url} | Example Corp | Platform Engineer\n`;
    mkdirSync(data);
    writeFileSync(tracker, [
      '# Applications Tracker', '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |',
      '|---|---|---|---|---|---|---|---|---|---|', originalRow, '',
    ].join('\n'));
    writeFileSync(pipeline, pending);
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
      !/^(CAREER_OPS_|NODE_OPTIONS$|DOTENV_)/i.test(name)));
    Object.assign(env, {
      CAREER_OPS_ROOT: root,
      CAREER_OPS_BATCH_STATE: join(root, 'batch-state.tsv'),
      DOTENV_CONFIG_QUIET: 'true',
      FIXTURE_SUMMARY: `Offline evaluation\n---SCORE_SUMMARY---\n${identity}\nSCORE: 4.8\nARCHETYPE: IC\nLEGITIMACY: High Confidence\n---END_SUMMARY---`,
    });
    const run = (args) => execFileSync(process.execPath, args, {
      cwd: root, env, encoding: 'utf8', timeout: 30_000,
    });
    run(['--input-type=module', '--eval', fixture]);
    run([merge]);

    const saved = readFileSync(tracker, 'utf8');
    const reportsDir = join(root, 'reports');
    const reports = existsSync(reportsDir) ? readdirSync(reportsDir) : [];
    if (valid) {
      assert.match(saved, /Example Corp \| Senior Platform Engineer \| 4\.8\/5 \| Applied/);
      assert.match(readFileSync(pipeline, 'utf8'), /^- \[x\]/);
      assert.equal(reports.filter((name) => !name.endsWith('-RESERVED.md')).length, 1);
    } else {
      assert.ok(saved.includes(originalRow), `incomplete summary rewrote the applied row:\n${saved}`);
      assert.equal(readFileSync(pipeline, 'utf8'), pending, 'the posting must remain available to retry');
      assert.deepEqual(reports, [], 'incomplete output should not create a report or reserve an ID');
    }
  });
}
