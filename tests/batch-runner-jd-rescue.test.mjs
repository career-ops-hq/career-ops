// tests/batch-runner-jd-rescue.test.mjs — the jd-rescue wiring in
// batch/batch-runner.sh. The bash snippet is extracted from the script and run
// against a stub jd-rescue.mjs, so the test and the implementation cannot drift.
import { pass, fail, rmSync, getBash } from './helpers.mjs';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'batch/batch-runner.sh'), 'utf-8').replace(/\r\n/g, '\n');

console.log('\nbatch-runner.sh — zero-token JD rescue before the thin-page fallback');

const rescue = SRC.match(/      if \[\[ -f "\$BATCH_DIR\/jd-rescue\.mjs" && -s "\$jd_raw_file" \]\]; then[\s\S]*?\n      rm -f "\$jd_raw_file"\n/)?.[0] ?? null;
if (rescue) pass('batch-runner.sh has the jd-rescue block'); else fail('the jd-rescue block is missing from batch-runner.sh');

// ── ordering ───────────────────────────────────────────────────────────────
const rawAt = SRC.indexOf('cp "$jd_file" "$jd_raw_file"');
const stripAt = SRC.indexOf('jd_prefetch_words=$(node -e');
const rescueAt = SRC.indexOf('jd-rescue.mjs" "$url"');
const thinAt = SRC.indexOf('thin content (${jd_prefetch_words} words) — worker will WebFetch');
const apiAt = SRC.indexOf('local jd_api_words=0');
if (rawAt !== -1 && rawAt < stripAt && stripAt < rescueAt && rescueAt < thinAt && thinAt < apiAt) {
  pass('raw copy → strip → rescue → thin check → ATS API fallback, in that order');
} else {
  fail('the order must be: copy raw bytes, strip, rescue, thin check, fetch-jd.mjs fallback');
}
if (/jd-rescue\.mjs" "\$url" "\$jd_raw_file" "\$jd_file" "\$jd_prefetch_words"/.test(SRC)) pass('the URL reaches jd-rescue.mjs as a quoted argument, never in a shell string');
else fail('jd-rescue.mjs must be called with quoted arguments');

// ── functional ─────────────────────────────────────────────────────────────
const bash = getBash();
if (!bash || !rescue) {
  if (rescue) pass('functional checks skipped: no bash available on this platform');
} else {
  const work = mkdtempSync(join(tmpdir(), 'co-jd-rescue-'));
  try {
    const batchDir = join(work, 'batch');
    mkdirSync(batchDir);
    const long = Array.from({ length: 120 }, (_, i) => `word${i}`).join(' ');
    writeFileSync(join(batchDir, 'jd-rescue.mjs'), [
      "import { writeFileSync, appendFileSync } from 'node:fs';",
      "appendFileSync(process.env.STUB_TRACE, JSON.stringify(process.argv.slice(2)) + '\\n');",
      "const mode = process.env.STUB_MODE;",
      "if (mode === 'crash') process.exitCode = 2;",
      "else if (mode === 'closed') { process.stdout.write('0\\tclosed:Ashby isListed: false\\n'); process.exitCode = 3; }",
      "else if (mode === 'miss') { process.stdout.write('0\\tnone\\n'); process.exitCode = 1; }",
      "else if (mode === 'thin') { process.stdout.write('12\\tld+json:thin\\n'); process.exitCode = 1; }",
      "else { writeFileSync(process.argv[4], process.env.STUB_JD); process.stdout.write('120\\tld+json\\n'); }",
      '',
    ].join('\n'));

    let n = 0;
    const run = ({ mode, raw = '<html>raw</html>', stripped = 'JS shell', words = 3, withStub = true }) => {
      n += 1;
      const jd = join(work, `jd-${n}.txt`);
      const trace = join(work, `trace-${n}.txt`);
      writeFileSync(jd, stripped); writeFileSync(`${jd}.raw`, raw); writeFileSync(trace, '');
      const script = join(work, `case-${n}.sh`);
      writeFileSync(script, [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        `jd_file=${JSON.stringify(jd)}`,
        `jd_raw_file=${JSON.stringify(`${jd}.raw`)}`,
        `BATCH_DIR=${JSON.stringify(withStub ? batchDir : join(work, 'none'))}`,
        'url="https://jobs.example.com/acme/1"',
        'prefetch_min_words=80',
        'jd_rescue_closed_note=""',
        `jd_prefetch_words=${words}`,
        rescue,
        'echo "words=$jd_prefetch_words"',
        'echo "closed=$jd_rescue_closed_note"',
      ].join('\n'));
      const out = execFileSync(bash, [script], { encoding: 'utf-8', timeout: 30000, cwd: work, env: { ...process.env, STUB_MODE: mode, STUB_TRACE: trace, STUB_JD: long } });
      return { out, jd: readFileSync(jd, 'utf-8'), trace: readFileSync(trace, 'utf-8'), rawLeft: existsSync(`${jd}.raw`) };
    };

    const ok = run({ mode: 'hit' });
    if (ok.jd === long && /words=120/.test(ok.out) && /JD rescue: recovered 120 words/.test(ok.out)) pass('a thin page is replaced by the rescued JD and the word count follows it');
    else fail(`rescue hit not applied: words line=${ok.out.trim().split('\n').pop()}, jd length=${ok.jd.length}`);
    if (!ok.rawLeft) pass('the raw copy is removed after the rescue decision'); else fail('the raw copy was left behind');
    if (ok.trace.includes('"https://jobs.example.com/acme/1"') && ok.trace.includes('.raw')) pass('rescue gets url, raw file, jd file and the stripped word count');
    else fail(`unexpected rescue arguments: ${ok.trace}`);

    for (const mode of ['miss', 'thin', 'crash']) {
      const r = run({ mode });
      if (r.jd === 'JS shell' && /words=3/.test(r.out) && !r.rawLeft) pass(`rescue "${mode}" fails open: stripped text and word count untouched`);
      else fail(`rescue "${mode}" changed state: jd=${JSON.stringify(r.jd)} ${r.out.trim().split('\n').pop()}`);
    }
    // Control flow: exit 3 from the rescue is terminal. The JD file is emptied (the page text is
    // not handed to a worker) and the closure note is set for the runner's skip decision.
    const closed = run({ mode: 'closed', stripped: Array.from({ length: 150 }, (_, i) => `w${i}`).join(' '), words: 150 });
    if (closed.jd === '' && /words=0/.test(closed.out) && /closed=posting closed \(jd-rescue\): Ashby isListed: false/.test(closed.out)) pass('rescue exit 3: JD file emptied and the closure note is recorded for the skip');
    else fail(`rescue exit 3 not terminal: jd=${JSON.stringify(closed.jd.slice(0, 20))} ${closed.out.trim().split('\n').slice(-2).join(' | ')}`);
    const none = run({ mode: 'hit', withStub: false });
    if (none.jd === 'JS shell' && none.trace === '') pass('jd-rescue.mjs absent: no rescue, no error');
    else fail('absent rescue script changed behaviour');
    const empty = run({ mode: 'hit', raw: '' });
    if (empty.jd === 'JS shell' && empty.trace === '') pass('an empty raw download is never sent to the rescue');
    else fail('empty raw file reached the rescue');
  } finally {
    try { rmSync(work, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

// ── end to end: rescue says closed → fetch-jd is not called, the offer is skipped, no worker ──
if (bash && rescue) {
  const work = mkdtempSync(join(tmpdir(), 'co-jd-rescue-e2e-'));
  try {
    const batchDir = join(work, 'batch'); const projectDir = join(work, 'project');
    mkdirSync(batchDir); mkdirSync(projectDir);
    writeFileSync(join(batchDir, 'jd-rescue.mjs'), "process.stdout.write('0\\tclosed:Ashby isListed: false\\n'); process.exitCode = 3;\n");
    const trace = join(work, 'fetch-trace.txt'); writeFileSync(trace, '');
    writeFileSync(join(projectDir, 'fetch-jd.mjs'), "import { appendFileSync } from 'node:fs'; appendFileSync(process.env.STUB_TRACE, 'called\\n');\n");
    const apiBlk = SRC.match(/  local jd_api_words=0\n  if \[\[ ! -s "\$jd_file"[\s\S]*?\n  fi\n/)?.[0];
    const decide = SRC.match(/  local jd_thin_skip=0 jd_thin_note="" jd_thin_retryable=0\n  if \[\[ -n "\$jd_closed_note" \]\]; then[\s\S]*?jd_thin_note="\$jd_closed_note"\n/)?.[0];
    const skipBlk = SRC.match(/  if \[\[ "\$jd_thin_skip" == "1" \]\]; then[\s\S]*?\n    return 0\n  fi\n/)?.[0];
    if (!apiBlk || !decide || !skipBlk) fail('could not extract the runner blocks for the end-to-end closure test');
    else {
      const jd = join(work, 'jd.txt'); writeFileSync(jd, 'full visible text of the closed page'); writeFileSync(`${jd}.raw`, '<html></html>');
      const script = join(work, 'e2e.sh');
      writeFileSync(script, [
        '#!/usr/bin/env bash', 'set -euo pipefail',
        `jd_file=${JSON.stringify(jd)}; jd_raw_file=${JSON.stringify(`${jd}.raw`)}; BATCH_DIR=${JSON.stringify(batchDir)}; PROJECT_DIR=${JSON.stringify(projectDir)}`,
        'url="https://jobs.ashbyhq.com/acme/1"; prefetch_min_words=80; THIN_ACTION=webfetch; retries=0; MAX_RETRIES=2; id=7; started_at=t; report_num=042',
        'update_state_retrying() { echo "STATE:$3"; }', 'release_report_num() { echo "RELEASED:$1"; }',
        'f() {', '  local jd_prefetch_words=150 jd_rescue_closed_note=""', rescue, '  local jd_closed_note="$jd_rescue_closed_note"', apiBlk, decide + '  fi\n', skipBlk, '  echo "WORKER-REACHED"', '}', 'f',
      ].join('\n'));
      const out = execFileSync(bash, [script], { encoding: 'utf-8', timeout: 30000, cwd: work, env: { ...process.env, STUB_TRACE: trace, TMPDIR: work } });
      const calls = readFileSync(trace, 'utf-8').trim();
      if (/STATE:skipped/.test(out) && /RELEASED:042/.test(out) && !/WORKER-REACHED/.test(out) && calls === '' && !existsSync(jd)) pass('closed rescue: fetch-jd is not called, the offer is recorded skipped, no worker is reached');
      else fail(`closed rescue end-to-end wrong: fetchCalls=${JSON.stringify(calls)} out=${out.trim()}`);
    }
  } finally { try { rmSync(work, { recursive: true, force: true }); } catch { /* best effort */ } }
}
