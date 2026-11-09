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
        `jd_prefetch_words=${words}`,
        rescue,
        'echo "words=$jd_prefetch_words"',
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
