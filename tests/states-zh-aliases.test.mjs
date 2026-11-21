// tests/states-zh-aliases.test.mjs — Chinese status spellings resolve through
// templates/states.yml, the way the Spanish and Turkish ones do.
//
// Without them a tracker addition whose status was 面试 was merged as
// "Evaluated": merge-tracker.mjs defaults an unknown status to Evaluated, and
// the only trace was one warning line. verify-pipeline, normalize-statuses and
// set-status reported the same spellings as non-canonical.
import { pass, fail, NODE, ROOT, rmSync, isolatedBatchStatePath } from './helpers.mjs';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { loadCanonicalStates, resolveCanonicalState } from '../tracker-utils.mjs';

const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

console.log('\nstates.yml — Chinese status aliases');

// [spelling, canonical label]. Simplified first, then the Traditional form
// where it differs.
const ALIASES = [
  ['已评估', 'Evaluated'], ['已評估', 'Evaluated'],
  ['已投递', 'Applied'], ['已申请', 'Applied'], ['已投遞', 'Applied'], ['已申請', 'Applied'],
  ['已回复', 'Responded'], ['已回覆', 'Responded'],
  ['笔试', 'Assessment'], ['测评', 'Assessment'], ['筆試', 'Assessment'], ['測評', 'Assessment'],
  ['面试', 'Interview'], ['面試', 'Interview'],
  ['录用', 'Offer'], ['錄用', 'Offer'],
  ['已拒绝', 'Rejected'], ['被拒', 'Rejected'], ['已拒絕', 'Rejected'],
  ['已放弃', 'Discarded'], ['放弃', 'Discarded'], ['已关闭', 'Discarded'],
  ['已放棄', 'Discarded'], ['放棄', 'Discarded'], ['已關閉', 'Discarded'],
  ['不投', 'SKIP'], ['跳过', 'SKIP'], ['跳過', 'SKIP'],
  ['已入职', 'Hired'], ['已入職', 'Hired'],
];

const states = loadCanonicalStates(join(ROOT, 'templates', 'states.yml'));

ok('every Chinese spelling resolves to its canonical state', () => {
  for (const [text, label] of ALIASES) {
    assert.strictEqual(resolveCanonicalState(text, states), label, `"${text}"`);
  }
  assert.strictEqual(resolveCanonicalState('**面试**', states), 'Interview', 'bold is stripped');
  assert.strictEqual(resolveCanonicalState('offer', states), 'Offer', 'the label is unchanged');
  assert.strictEqual(resolveCanonicalState('entrevista', states), 'Interview', 'Spanish is unchanged');
  assert.strictEqual(resolveCanonicalState('待定', states), null, 'an unlisted word is still unknown');
});

ok('no Chinese spelling is listed under two states', () => {
  const seen = new Map();
  for (const s of states) {
    for (const a of s.aliases.filter(x => /[一-鿿]/.test(x))) {
      assert.ok(!seen.has(a), `"${a}" is under both ${seen.get(a)} and ${s.id}`);
      seen.set(a, s.id);
    }
  }
  assert.strictEqual(seen.size, ALIASES.length, 'the table above lists every Chinese alias in states.yml');
});

const TRACKER_HEAD = ['# Applications Tracker', '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|-------|'];
const TSV_HEAD = 'num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes';

/** Merge one tracker addition per status and return each row's Status cell. */
function mergeStatuses(statuses) {
  const work = mkdtempSync(join(tmpdir(), 'states-zh-merge-'));
  try {
    const tracker = join(work, 'applications.md');
    const adds = join(work, 'adds');
    mkdirSync(adds);
    writeFileSync(tracker, [...TRACKER_HEAD, ''].join('\n'));
    statuses.forEach((status, i) => {
      const n = i + 1;
      writeFileSync(join(adds, `${n}-example-${n}.tsv`),
        `${TSV_HEAD}\n${n}\t2026-11-0${n}\tExample ${n} Ltd\tBackend Engineer ${n}\t${status}\t4.${n}/5\t❌\t—\tsynthetic row\n`);
    });
    const run = spawnSync(NODE, [join(ROOT, 'merge-tracker.mjs')], {
      encoding: 'utf-8',
      // The data root is the fixture too: the merge reads its ledgers for
      // occupied numbers, and the developer's own would renumber these rows.
      env: { ...process.env, CAREER_OPS_ROOT: work, CAREER_OPS_DATA_DIR: '', CAREER_OPS_FOLLOWUPS: '', CAREER_OPS_TRACKER: tracker, CAREER_OPS_ADDITIONS: adds, CAREER_OPS_BATCH_STATE: isolatedBatchStatePath(adds) },
    });
    assert.strictEqual(run.status, 0, run.stderr);
    const rows = readFileSync(tracker, 'utf-8').split('\n').filter(l => /^\|\s*\d+\s*\|/.test(l));
    const cells = rows.map(l => l.split('|').map(c => c.trim()));
    return { output: run.stdout + run.stderr, byNum: Object.fromEntries(cells.map(c => [c[1], c[6]])) };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

ok('merge-tracker writes a 面试 addition as Interview, not Evaluated', () => {
  const { output, byNum } = mergeStatuses(['面试', 'entrevista', '已投递', '已拒绝', '录用']);
  assert.deepStrictEqual(byNum, { 1: 'Interview', 2: 'Interview', 3: 'Applied', 4: 'Rejected', 5: 'Offer' });
  assert.doesNotMatch(output, /Non-canonical status/);
});

ok('merge-tracker still warns about a status no state lists, and leaves it pending', () => {
  const { output, byNum } = mergeStatuses(['待定']);
  assert.deepStrictEqual(byNum, {});
  assert.match(output, /status "待定" is not a tracker state/);
});

/** Run a tracker script against a data root holding one tracker. */
function withTracker(rows, fn) {
  const root = mkdtempSync(join(tmpdir(), 'states-zh-root-'));
  try {
    mkdirSync(join(root, 'data'));
    writeFileSync(join(root, 'data', 'applications.md'), [...TRACKER_HEAD, ...rows, ''].join('\n'));
    const run = (script, ...args) => spawnSync(NODE, [join(ROOT, script), ...args], {
      encoding: 'utf-8',
      env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_TRACKER: '' },
    });
    fn(run, () => readFileSync(join(root, 'data', 'applications.md'), 'utf-8'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const ZH_ROWS = [
  '| 1 | 2026-11-01 | Example One Ltd | Backend Engineer | 4.2/5 | 已评估 | ❌ | — | |',
  '| 2 | 2026-11-02 | Example Two Ltd | Backend Engineer | 4.0/5 | 面试 | ❌ | — | |',
];

ok('normalize-statuses rewrites Chinese statuses to their labels', () => {
  withTracker(ZH_ROWS, (run, read) => {
    const out = run('normalize-statuses.mjs');
    assert.strictEqual(out.status, 0, out.stderr);
    assert.doesNotMatch(out.stdout + out.stderr, /unknown status/i);
    const text = read();
    assert.match(text, /\| 4\.2\/5 \| Evaluated \|/);
    assert.match(text, /\| 4\.0\/5 \| Interview \|/);
  });
});

ok('set-status accepts a Chinese status and writes the label', () => {
  withTracker(['| 1 | 2026-11-01 | Example One Ltd | Backend Engineer | 4.2/5 | Evaluated | ❌ | — | |'], (run, read) => {
    const out = run('set-status.mjs', '1', '面试');
    assert.strictEqual(out.status, 0, out.stdout + out.stderr);
    assert.match(read(), /\| 4\.2\/5 \| Interview \|/);
  });
});
