// RED contract reproduction for the web evaluator's trusted persistence path.
// Fictional data, fake children, real scratch report writer; no network/models.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { persistEvaluation } from '../../src/lib/report-persist.mjs';
import { persistEvaluationArtifacts } from '../../../persist-evaluation-report.mjs';

const reportWith = (section) => `# Evaluation: ExampleCo — Technical Product Manager

**URL:** https://jobs.example.test/positions/2468

## Machine Summary
\`\`\`yaml
company: ExampleCo
role: Technical Product Manager
score: 2.9
via: null
\`\`\`

## A) Role Summary
A completed evaluation of the role.

## Job Description (archived verbatim)
${section}
`;

function harness(root, { captureFn = async () => { throw new Error('No trusted JD capture is available in this offline fixture'); } } = {}) {
  const calls = [];
  let merged = false;
  const spawnFn = (_execPath, args, opts) => {
    const script = basename(args[0]);
    const call = { script, args, input: '' };
    calls.push(call);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { write: (x) => { call.input += String(x); }, end() {} };
    queueMicrotask(async () => {
      let stdout = '', stderr = '', code = 0;
      if (script === 'reserve-report-num.mjs') stdout = args.includes('--release') ? '' : '061\n';
      else if (script === 'persist-evaluation-report.mjs') {
        const result = await persistEvaluationArtifacts(opts.cwd, JSON.parse(call.input), { captureFn });
        if (!result.ok) { stderr = result.error; code = 1; }
      } else if (script === 'merge-tracker.mjs') merged = true;
      else { stderr = 'No trusted JD capture is available in this offline fixture'; code = 1; }
      if (stdout) child.stdout.emit('data', Buffer.from(stdout));
      if (stderr) child.stderr.emit('data', Buffer.from(stderr));
      child.emit('close', code);
    });
    return child;
  };
  return { spawnFn, calls, get merged() { return merged; } };
}

for (const [name, section] of [
  ['explicit copyright omission', 'Posted: not visible in source\n\nFull reproduction of the source job description is omitted due to copyright limits. This section is not a completed JD archive. The exact source URL above remains available for the original requirements.'],
  ['dangling canonical archive pointer', 'See jds/061-exampleco-technical-product-manager.md for the full archive (archive-posting.mjs --report=061).'],
]) {
  test(`persistence must not merge or claim completion with ${name} and no capture`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'career-web-jd-archive-red-'));
    try {
      const h = harness(root);
      const result = await persistEvaluation({ spawnFn: h.spawnFn, execPath: process.execPath,
        root, markdown: reportWith(section), url: 'https://jobs.example.test/positions/2468', today: '2026-11-04' });
      const saved = join(root, 'reports', '061-exampleco-2026-11-04.md');
      const observed = { result, merged: h.merged, scripts: h.calls.map(x => x.script),
        reportExists: existsSync(saved), jdsExists: existsSync(join(root, 'jds')),
        savedOmissionUnchanged: existsSync(saved) && readFileSync(saved, 'utf8').includes(section) };
      assert.equal(h.merged, false, `Tracker was merged before a verified full JD archive existed: ${JSON.stringify(observed)}`);
      assert.equal(result.ok, false, 'No trusted capture exists, so completion must not be claimed');
      assert.match(result.error, /archive|job description|JD/i);
      assert.equal(h.calls.filter(x => x.script === 'reserve-report-num.mjs' && x.args.includes('--release')).length, 1,
        'The reservation must be released even when archive capture fails');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}


test('actual reserved-number coordinator captures before native report/TSV and exactly one merge', async () => {
  const root = mkdtempSync(join(tmpdir(), 'career-web-jd-archive-green-'));
  try {
    let captures = 0;
    const h = harness(root, { captureFn: async id => {
      captures++;
      assert.equal(id.num, '061');
      assert.equal(existsSync(join(root, 'reports')), false);
      assert.equal(existsSync(join(root, 'batch', 'tracker-additions')), false);
      return { text: 'The Technical Product Manager owns requirements, roadmap prioritization, customer discovery and delivery with engineers and designers. The team measures quality and customer outcomes, documents decisions and provides appropriate onboarding support. '.repeat(5),
        sourceUrl: id.url, settledUrl: id.url, complete: true, truncated: false, httpStatus: 200 };
    } });
    const result = await persistEvaluation({ spawnFn: h.spawnFn, execPath: process.execPath, root,
      markdown: reportWith('Full reproduction of the source job description is omitted due to copyright limits. This section is not a completed JD archive.'),
      url: 'https://jobs.example.test/positions/2468', today: '2026-11-04' });
    assert.equal(result.ok, true, result.error);
    assert.equal(captures, 1);
    assert.deepEqual(h.calls.map(x => x.script), ['reserve-report-num.mjs', 'persist-evaluation-report.mjs', 'merge-tracker.mjs', 'reserve-report-num.mjs']);
    const md = readFileSync(join(root, 'reports', '061-exampleco-2026-11-04.md'), 'utf8');
    assert.match(md, /See jds\/061-exampleco-.*\.md for the full archive/);
    assert.doesNotMatch(md, /reproduction.*omitted/);
    assert.equal(h.merged, true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
