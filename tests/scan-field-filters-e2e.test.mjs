// tests/scan-field-filters-e2e.test.mjs — #3438 through the real scan.
//
// The unit test next door checks normalizeFilterOn and the compiler in
// isolation, which cannot notice if scan.mjs stops APPLYING filter_on. This
// runs scan.mjs itself against local-parser fixture boards and asserts on what
// actually reached the pipeline and on the counters the run printed. It covers
// the local-parser passthrough in the same pass: without it `job.noc` never
// reaches the filter at all.
import { pass, fail, ROOT, NODE } from './helpers.mjs';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';

console.log('\nscan.mjs — filter_on end to end');

// Deliberately narrow, and matching NONE of the fixture titles. Anything that
// survives a run therefore survived because of the declared field, not because
// the title net happened to be loose.
const TITLE_FILTER = `title_filter:
  positive:
    - "Help Desk"
`;

function runScan(entryExtra, fixture = 'noc-board.mjs', titleFilter = TITLE_FILTER) {
  const dir = mkdtempSync(join(tmpdir(), 'scan-ff-'));
  try {
    mkdirSync(join(dir, 'data'), { recursive: true });
    writeFileSync(join(dir, 'data', 'applications.md'), `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
`);
    writeFileSync(join(dir, 'data', 'pipeline.md'), '# Pipeline\n\n');
    const portals = join(dir, 'portals.yml');
    writeFileSync(portals, `${titleFilter}field_filters:
  noc:
    positive: ["stem:22"]
tracked_companies:
  - name: Fixture Board
    careers_url: https://example.invalid/jobs
${entryExtra}    parser:
      command: node
      script: tests/fixtures/${fixture}
`);
    const stdout = execFileSync(NODE, [join(ROOT, 'scan.mjs')], {
      cwd: dir,
      env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_PORTALS: portals },
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const p = join(dir, 'data', 'pipeline.md');
    const urls = existsSync(p)
      ? readFileSync(p, 'utf-8').split('\n').filter(l => /^- \[[ x]\]\s+https?:\/\//.test(l))
      : [];
    return { stdout, urls };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// No declaration: today's behaviour. The narrow title filter rejects all three
// postings, occupation code or not.
{
  const { urls } = runScan('');
  if (urls.length === 0) pass('without filter_on the title whitelist still governs — nothing survives');
  else fail(`expected 0 entries, got ${urls.length}: ${JSON.stringify(urls)}`);
}

// filter_on: noc — the fix. 22221 matches stem:22 and is kept; 65102 does not
// and is dropped; the posting carrying no noc passes, because absent is not a
// rejection, and is counted rather than silently swallowed.
{
  const { stdout, urls } = runScan('    filter_on: noc\n');
  if (urls.length === 2) pass('filter_on: noc keeps the matching occupation and the absent-field posting');
  else fail(`expected 2 entries, got ${urls.length}: ${JSON.stringify(urls)}`);

  if (urls.some(u => u.includes('/jobs/1'))) pass('the 22221 posting survived a title filter that never matched it');
  else fail('expected the 22221 posting in the pipeline');

  if (!urls.some(u => u.includes('/jobs/2'))) pass('the 65102 posting was rejected by the noc whitelist');
  else fail('expected the 65102 posting to be filtered out');

  if (urls.some(u => u.includes('/jobs/3'))) pass('a posting with no noc passes rather than being dropped');
  else fail('expected the posting with no noc to pass');

  if (/Filtered by field:\s+1 removed/.test(stdout)) pass('the rejection is attributed to the field, not to title');
  else fail(`expected "Filtered by field: 1 removed" in the summary:\n${stdout}`);

  if (/Passed, field absent:\s+1 ungated/.test(stdout)) pass('the summary counts the posting that passed without a noc');
  else fail(`expected "Passed, field absent: 1 ungated" in the summary:\n${stdout}`);
}

// AND semantics, and attribution: title fails first for every posting here, so
// all three are title rejections and the field counter stays at zero. The
// posting with no noc was rejected, so it did not pass ungated either.
{
  const { stdout, urls } = runScan('    filter_on: [title, noc]\n');
  if (urls.length === 0) pass('filter_on: [title, noc] ANDs — the narrow title filter still rejects everything');
  else fail(`expected 0 entries, got ${urls.length}: ${JSON.stringify(urls)}`);

  if (/Filtered by title:\s+3 removed/.test(stdout)) pass('they are booked as title rejections, since title is what failed');
  else fail(`expected "Filtered by title: 3 removed":\n${stdout}`);

  if (/Passed, field absent:\s+0 ungated/.test(stdout)) pass('a rejected posting is not also counted as passed with the field absent');
  else fail(`expected "Passed, field absent: 0 ungated":\n${stdout}`);
}

// Attribution the other way round: the title matches and the noc does not.
// Only "Guest Experience Associate" (65102) clears this title filter, so it is
// the one field rejection; the other two fail on title.
{
  const associate = `title_filter:
  positive:
    - "Associate"
`;
  const { stdout, urls } = runScan('    filter_on: [title, noc]\n', 'noc-board.mjs', associate);
  if (urls.length === 0) pass('a matching title does not rescue a rejected noc under AND');
  else fail(`expected 0 entries, got ${urls.length}: ${JSON.stringify(urls)}`);

  if (/Filtered by field:\s+1 removed/.test(stdout) && /Filtered by title:\s+2 removed/.test(stdout)) {
    pass('a matching title with a rejected noc is booked to the field, not to title');
  } else {
    fail(`expected field 1 / title 2 in the summary:\n${stdout}`);
  }
}

// The failure the issue is really about: a declared field the provider never
// supplies. Every posting passes and the run says so, instead of looking like
// a working whitelist.
{
  const { stdout, urls } = runScan('    filter_on: noc\n', 'noc-less-board.mjs');
  if (urls.length === 2) pass('a board that never publishes the field drops nothing');
  else fail(`expected 2 entries, got ${urls.length}: ${JSON.stringify(urls)}`);

  if (/Declared field never observed/.test(stdout)) pass('the run warns that the whitelist is effectively off');
  else fail(`expected the dead-declaration warning:\n${stdout}`);

  if (/"noc" absent on all 2 job\(s\)/.test(stdout)) pass('the warning names the single field and the count');
  else fail(`expected the per-field warning line:\n${stdout}`);

  if (/Passed, field absent:\s+2 ungated/.test(stdout)) pass('both postings are counted as passed with the field absent');
  else fail(`expected "Passed, field absent: 2 ungated":\n${stdout}`);
}

// Same, declared alongside title: the warning is per (target, field), so a
// dead noc is reported even when title is declared too.
{
  const { stdout } = runScan('    filter_on: [title, noc]\n', 'noc-less-board.mjs');
  if (/"noc" absent on all 2 job\(s\)/.test(stdout)) pass('a mixed [title, noc] declaration still reports the dead field');
  else fail(`expected the warning for a mixed declaration:\n${stdout}`);
}

// A field declared twice is one field: presence is counted once per job, so
// the warning reports the number of postings, not postings × repetitions.
{
  const { stdout } = runScan('    filter_on: [noc, noc]\n', 'noc-less-board.mjs');
  if (/"noc" absent on all 2 job\(s\)/.test(stdout) && !/absent on all 4/.test(stdout)) {
    pass('a repeated field is counted once per posting');
  } else {
    fail(`expected "absent on all 2 job(s)" for [noc, noc]:\n${stdout}`);
  }
}

// filter_on naming a field with no field_filters block: exit at startup, not a
// silent pass-all at filter time.
{
  let exited = false;
  let detail = '';
  try {
    const { stdout } = runScan('    filter_on: department\n');
    detail = stdout;
  } catch (err) {
    exited = String(err.stderr || err.message).includes('has no field_filters.department block');
    detail = String(err.stderr || err.message);
  }
  if (exited) pass('filter_on naming an undeclared field exits at startup');
  else fail(`expected a startup exit naming the missing block, got:\n${detail}`);
}
