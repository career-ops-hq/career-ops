// tests/batch-runner-score-locale.test.mjs — scores stay dot-decimal whatever
// locale the machine runs under.
//
// THE BUG THIS PINS
//
// batch/batch-runner.sh hands scores to `awk` in six places: the MIN_SCORE gate
// in process_offer(), and the sum + "%.1f" average in both print_summary() and
// print_status_table(). awk's numeric conversion follows LC_NUMERIC, so on a
// machine set to a comma-decimal locale (de_DE, es_ES, fr_FR, pt_BR...) the
// runner printed
//
//   Average score: 4,5/5 (2 scored)
//
// A decimal comma breaks every downstream reader of that output, and the value
// is fed straight back into the next awk call as a string, so the comma travels
// through the accumulator too. On an awk whose numeric input also honours the
// locale (mawk, the default on Ubuntu, converts through strtod) the MIN_SCORE
// comparison additionally reads "4.5" as 4 — a 4.5 and a 4.0 become the same
// number to the filter and postings are kept or skipped for the wrong reason,
// with no error anywhere.
//
// CI runs under C/en, which is exactly why the existing --status assertion in
// test-all.mjs never saw it.
//
// The fix is `LC_ALL=C` on those awk calls (LC_ALL, not LC_NUMERIC: an LC_ALL
// already exported in the environment outranks LC_NUMERIC, so the narrower
// variable would leave the bug in place for the very users who hit it).
//
// This test has two halves. The static half reads the REAL awk invocations out
// of the script and is unconditional, so the fix cannot be dropped on any
// runner. The behavioural half runs `--status` under a comma-decimal locale and
// only executes where such a locale is actually generated — a guard, not a
// skip-by-default: it is the half that proves the observable output.
import { pass, fail, warn, rmSync, getBash } from './helpers.mjs';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'batch/batch-runner.sh'), 'utf-8').replace(/\r\n/g, '\n');

console.log('\nbatch-runner.sh — locale-independent score parsing');

// --- static half: every numeric awk call carries the C locale --------------
// The score-bearing calls are the ones passing a numeric -v: score, min, sum or
// count. Text-processing awk elsewhere in the script (header extraction, the
// fenced-JSON reader) is deliberately out of scope — it converts no numbers.
const numericAwk = [...SRC.matchAll(/^.*?(\S*)\bawk -v (?:score|min|sum|count)=.*$/gm)];

if (numericAwk.length === 0) {
  fail('found no numeric awk calls in batch/batch-runner.sh — this test needs updating');
} else {
  const unguarded = numericAwk
    .map((m) => m[0].trim())
    .filter((line) => !/\bLC_ALL=C awk -v (?:score|min|sum|count)=/.test(line));

  if (unguarded.length === 0) {
    pass(`all ${numericAwk.length} numeric awk calls run under LC_ALL=C`);
  } else {
    fail(
      `${unguarded.length} numeric awk call(s) without LC_ALL=C — scores will localise:\n  ` +
        unguarded.join('\n  '),
    );
  }

  // LC_NUMERIC alone is the tempting near-miss: it loses to an exported LC_ALL.
  const narrow = numericAwk.map((m) => m[0]).filter((line) => /\bLC_NUMERIC=C awk/.test(line));
  if (narrow.length === 0) {
    pass('no numeric awk call relies on LC_NUMERIC, which an exported LC_ALL would override');
  } else {
    fail(`${narrow.length} numeric awk call(s) use LC_NUMERIC=C, which an exported LC_ALL overrides`);
  }
}

// --- behavioural half: --status under a comma-decimal locale ---------------
function commaDecimalLocale() {
  let available = '';
  try {
    available = execFileSync('locale', ['-a'], { encoding: 'utf-8', timeout: 30000 });
  } catch {
    return null; // no `locale` binary (Windows runners) — the static half still ran
  }
  const names = available.split('\n').map((l) => l.trim());
  for (const wanted of ['de_DE.UTF-8', 'de_DE.utf8', 'fr_FR.UTF-8', 'fr_FR.utf8', 'es_ES.UTF-8', 'es_ES.utf8']) {
    if (names.includes(wanted)) return wanted;
  }
  return null;
}

const locale = commaDecimalLocale();

if (!locale) {
  warn('no comma-decimal locale generated on this machine — ran the static half only');
} else {
  const work = mkdtempSync(join(tmpdir(), 'co-batch-locale-'));
  try {
    const batchDir = join(work, 'batch');
    mkdirSync(batchDir, { recursive: true });
    const runner = join(batchDir, 'batch-runner.sh');
    writeFileSync(runner, SRC);
    chmodSync(runner, 0o755);
    writeFileSync(
      join(batchDir, 'batch-state.tsv'),
      [
        'id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries',
        '1\thttps://example.com/one\tcompleted\t2026-01-01T00:00:00Z\t2026-01-01T00:00:01Z\t001\t4.5\t-\t0',
        '2\thttps://example.com/two\tcompleted\t2026-01-01T00:00:00Z\t2026-01-01T00:00:01Z\t002\t4.5\t-\t0',
      ].join('\n') + '\n',
    );

    const out = execFileSync(getBash(), [runner, '--status'], {
      encoding: 'utf-8',
      timeout: 30000,
      env: { ...process.env, LC_ALL: locale },
    });

    if (out.includes('Average score: 4.5/5 (2 scored)')) {
      pass(`--status prints a dot decimal under ${locale}`);
    } else {
      const line = out.split('\n').find((l) => l.includes('Average score')) || '(no average line)';
      fail(`--status localised the average under ${locale}: ${line.trim()}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
