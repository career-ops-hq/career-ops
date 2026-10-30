import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { moveInbox } from '../move-inbox.mjs';
import { resolveColumns, parseTrackerRow } from '../tracker-parse.mjs';

const URL = 'https://jobs.example.com/roles/ai-intern';
function fixture(t, legacyTracker = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'career-inbox-move-'));
  fs.mkdirSync(path.join(root, 'data'));
  fs.writeFileSync(path.join(root, 'data/pipeline.md'), `# Pipeline\n\n## Pending\n- [ ] ${URL} | Example Company | AI Intern | Hamburg\n\n## Processed\n`);
  if (legacyTracker) fs.writeFileSync(path.join(root, 'data/applications.md'), '# Applications\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n| 1 | 2026-01-01 | Existing | Engineer | 4.0/5 | Applied | ❌ | — | Keep this note |\n');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function applications(root) {
  const lines=fs.readFileSync(path.join(root, 'data/applications.md'),'utf8').split('\n');
  const columns=resolveColumns(lines);
  return lines.map(line=>parseTrackerRow(line,columns)).filter(Boolean);
}

test('moving to SKIP creates one unscored tracker entry, preserves existing data, and removes it from Inbox', async t => {
  const root=fixture(t);
  const result=await moveInbox(URL,'SKIP',{dataRoot:root});
  assert.equal(result.status,'SKIP');
  const rows=applications(root);
  assert.equal(rows.length,2);
  assert.equal(rows[0].score,'4.0/5');
  assert.equal(rows[0].notes,'Keep this note');
  assert.equal(rows[1].score,'—');
  assert.equal(rows[1].report,'—');
  assert.equal(rows[1].url,URL);
  assert.match(fs.readFileSync(path.join(root,'data/pipeline.md'),'utf8'),/- \[x\]/);
  await moveInbox(URL,'SKIP',{dataRoot:root});
  assert.equal(applications(root).length,2);
});

test('a job can move to Interview before any evaluation or tracker exists', async t => {
  const root=fixture(t,false);
  await moveInbox(URL,'Interview',{dataRoot:root});
  const [row]=applications(root);
  assert.equal(row.status,'Interview');
  assert.equal(row.score,'—');
  assert.equal(row.location,'Hamburg');
  assert.equal(row.url,URL);
});

test('changing an already-tracked job uses its existing row without duplicates', async t => {
  const root=fixture(t,false);
  await moveInbox(URL,'Interview',{dataRoot:root});
  await moveInbox(URL,'SKIP',{dataRoot:root});
  assert.equal(applications(root).length,1);
  assert.equal(applications(root)[0].status,'SKIP');
});

test('invalid, missing and unscored Evaluated requests do not change the tracker or inbox', async t => {
  const root=fixture(t);
  const before=fs.readFileSync(path.join(root,'data/applications.md'),'utf8');
  await assert.rejects(moveInbox(URL,'Evaluated',{dataRoot:root}),/Score the job/);
  await assert.rejects(moveInbox(URL,'Imaginary',{dataRoot:root}),/valid application status/);
  await assert.rejects(moveInbox('https://example.com/missing','Interview',{dataRoot:root}),/no longer in the inbox/);
  assert.equal(fs.readFileSync(path.join(root,'data/applications.md'),'utf8'),before);
  assert.match(fs.readFileSync(path.join(root,'data/pipeline.md'),'utf8'),/- \[ \]/);
});

test('concurrent moves for the same posting create one row and release reservations', async t => {
  const root = fixture(t, false);
  const results = await Promise.all([
    moveInbox(URL, 'Interview', { dataRoot: root }),
    moveInbox(URL, 'Interview', { dataRoot: root }),
  ]);
  assert.equal(applications(root).length, 1);
  assert.equal(results[0].n, results[1].n);
  assert.equal(fs.readdirSync(path.join(root, 'reports')).filter(name => name.includes('RESERVED')).length, 0);
  assert.equal(fs.readdirSync(path.join(root, 'batch/tracker-additions')).length, 0);
});

test('CRLF, localized headings, duplicate URL spellings and processed history are preserved', async t => {
  const root = fixture(t, false);
  const pipeline = path.join(root, 'data/pipeline.md');
  const text = `# Pipeline\r\n\r\n## Offen\r\n- [ ] ${URL}?utm_source=alert | Example Company | AI Intern | Hamburg | note: Keep this\r\n- [ ] #-- | ${URL} | Example Company | AI Intern\r\n\r\n## Verarbeitet\r\n- [ ] ${URL} | Historic Company | Historic role\r\n`;
  fs.writeFileSync(pipeline, text);
  await moveInbox(URL, 'SKIP', { dataRoot: root });
  assert.equal(fs.readFileSync(pipeline, 'utf8'), text.replace('- [ ] https:', '- [x] https:').replace('- [ ] #--', '- [x] #--'));
  assert.equal(applications(root).length, 1);
});

test('an entry in Processed is never moved as if it were pending', async t => {
  const root = fixture(t);
  const pipeline = path.join(root, 'data/pipeline.md');
  fs.writeFileSync(pipeline, `## Pending\n\n## Processed\n- [ ] ${URL} | Example Company | AI Intern\n`);
  const tracker = fs.readFileSync(path.join(root, 'data/applications.md'), 'utf8');
  await assert.rejects(moveInbox(URL, 'Interview', { dataRoot: root }), /no longer in the inbox/);
  assert.equal(fs.readFileSync(path.join(root, 'data/applications.md'), 'utf8'), tracker);
});

test('new entries do not reuse a retired application number retained in the status ledger', async t => {
  const root = fixture(t, false);
  fs.writeFileSync(path.join(root, 'data/status-log.tsv'), '42\t2026-10-03\tEvaluated\tApplied\tset-status\t\n');
  await moveInbox(URL, 'Interview', { dataRoot: root });
  assert.equal(Number(applications(root)[0].num), 43);
});

test('the core CLI honors the data root and tracker override without running an evaluator', t => {
  const root = fixture(t, false);
  const tracker = path.join(root, 'custom-applications.md');
  const output = execFileSync(process.execPath, [fileURLToPath(new globalThis.URL('../move-inbox.mjs', import.meta.url)), URL, 'Applied', '--json'], {
    encoding: 'utf8',
    env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_TRACKER: tracker, CAREER_OPS_PIPELINE: path.join(root, 'data/pipeline.md') },
  });
  const result = JSON.parse(output);
  assert.equal(result.ok, true);
  assert.equal(result.status, 'Applied');
  assert.match(fs.readFileSync(tracker, 'utf8'), /Example Company/);
  assert.equal(fs.existsSync(path.join(root, 'data/applications.md')), false);
  assert.deepEqual(fs.readdirSync(path.join(root, 'reports')), []);
});
