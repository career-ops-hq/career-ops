// tests/batch-runner-prefilter.test.mjs — the dead-URL pre-filter wiring in
// batch/batch-runner.sh. The detection and action snippets are extracted from the
// script and run against a stub prefilter-url.mjs and stub state helpers, so the
// test and the implementation cannot drift apart.
import { pass, fail, rmSync, getBash } from './helpers.mjs';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'batch/batch-runner.sh'), 'utf-8').replace(/\r\n/g, '\n');

console.log('\nbatch-runner.sh — zero-token dead-URL pre-filter');

const detect = SRC.match(/      if \[\[ "\$\{PREFILTER:-true\}" == "true" && -f[\s\S]*?\n      fi\n/)?.[0] ?? null;
const act = SRC.match(/  if \[\[ "\$jd_prefilter_decision" != "proceed" \]\]; then[\s\S]*?\n  fi\n(?=\n  # ATS API fallback)/)?.[0] ?? null;
if (detect && act) pass('batch-runner.sh has the pre-filter detection and action blocks');
else fail('the pre-filter blocks are missing from batch-runner.sh');

const rescueAt = SRC.indexOf('jd_prefilter_decision" == "skip-blocked"');
const actionAt = SRC.indexOf('if [[ "$jd_prefilter_decision" != "proceed" ]]');
const rescueBlock = rescueAt >= 0 && actionAt > rescueAt ? SRC.slice(rescueAt, actionAt) : '';
if (rescueBlock.includes('fetch-jd.mjs') && rescueBlock.includes('prefetch_min_words')) {
  pass('blocked/transient prefilter verdicts get an ATS API rescue before terminal action');
} else {
  fail('blocked/transient prefilter verdicts must try fetch-jd.mjs before being recorded');
}

// ── contract ───────────────────────────────────────────────────────────────
const writeOutAt = SRC.indexOf("--write-out '%{http_code}\\t%{url_effective}'");
const stripAt = SRC.indexOf('jd_prefetch_words=$(node -e');
const detectAt = SRC.indexOf('prefilter-url.mjs" "$jd_http_code"');
const thinAt = SRC.indexOf('thin content (${jd_prefetch_words} words) — worker will WebFetch');
const actAt = SRC.indexOf('if [[ "$jd_prefilter_decision" != "proceed" ]]');
const apiAt = SRC.indexOf('local jd_api_words=0');
if (writeOutAt !== -1 && writeOutAt < stripAt && stripAt < detectAt && detectAt < thinAt && thinAt < actAt && actAt < apiAt) {
  pass('status captured by curl → strip → verdict → thin truncation → skip → ATS API fallback, in that order');
} else {
  fail('pre-filter ordering is wrong: the verdict must be taken before the thin-content truncation and the skip before any further fetch');
}
if (/prefilter-url\.mjs" "\$jd_http_code" "\$url" "\$jd_final_url" "\$jd_file"/.test(SRC)) pass('the URL reaches prefilter-url.mjs as a quoted argument');
else fail('prefilter-url.mjs must be called with quoted arguments');
if (/--no-prefilter\) PREFILTER=false/.test(SRC) && /--no-prefilter\s+Disable/.test(SRC)) pass('--no-prefilter opts out and is documented in usage');
else fail('--no-prefilter is missing from the parser or the usage text');

// ── functional ─────────────────────────────────────────────────────────────
const bash = getBash();
if (!bash || !detect || !act) {
  if (detect && act) pass('functional checks skipped: no bash available on this platform');
} else {
  const work = mkdtempSync(join(tmpdir(), 'co-prefilter-'));
  try {
    const batchDir = join(work, 'batch');
    mkdirSync(batchDir);
    writeFileSync(join(batchDir, 'prefilter-url.mjs'), [
      "const mode = process.env.STUB_MODE;",
      "if (mode === 'crash') process.exitCode = 2;",
      "else if (mode === 'garbage') process.stdout.write('\\n');",
      "else process.stdout.write(`${mode}\\tcode_${mode}\\treason for ${mode}\\n`);",
      '',
    ].join('\n'));

    let n = 0;
    const run = ({ mode, prefilter = 'true', withStub = true }) => {
      n += 1;
      const jd = join(work, `jd-${n}.txt`);
      const trace = join(work, `trace-${n}.txt`);
      writeFileSync(jd, 'some stripped text'); writeFileSync(trace, '');
      const script = join(work, `case-${n}.sh`);
      writeFileSync(script, [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        `jd_file=${JSON.stringify(jd)}`,
        `BATCH_DIR=${JSON.stringify(withStub ? batchDir : join(work, 'none'))}`,
        `PREFILTER=${prefilter}`,
        'url="https://jobs.example.com/acme/1"; id=7; started_at=T0; retries=0; report_num=042; MAX_RETRIES=3',
        'jd_http_code=404; jd_final_url="$url"',
        'jd_prefilter_decision=proceed; jd_prefilter_code=""; jd_prefilter_reason=""',
        `update_state_retrying() { printf 'STATE %s\\n' "$*" >> ${JSON.stringify(trace)}; }`,
        `release_report_num() { printf 'RELEASE %s\\n' "$1" >> ${JSON.stringify(trace)}; }`,
        'one_offer() {',
        detect,
        act,
        '  echo "CONTINUED"',
        '}',
        'one_offer',
      ].join('\n'));
      const out = execFileSync(bash, [script], { encoding: 'utf-8', timeout: 30000, cwd: work, env: { ...process.env, STUB_MODE: mode } });
      return { out, trace: readFileSync(trace, 'utf-8'), jdLeft: existsSync(jd) };
    };

    const dead = run({ mode: 'skip-dead' });
    if (!/CONTINUED/.test(dead.out) && /STATE 7 \S+ skipped T0 \S+ - - prefilter: expired \(code_skip-dead\)/.test(dead.trace) && /RELEASE 042/.test(dead.trace) && !dead.jdLeft) {
      pass('skip-dead: recorded skipped (terminal), report number released, JD file removed, no worker');
    } else fail(`skip-dead handled wrong: ${JSON.stringify(dead)}`);

    const blocked = run({ mode: 'skip-blocked' });
    if (!/CONTINUED/.test(blocked.out) && /skipped .* prefilter: blocked \(code_skip-blocked\) — needs-playwright:/.test(blocked.trace) && /RELEASE 042/.test(blocked.trace)) {
      pass('skip-blocked: recorded skipped with a needs-playwright marker, number released, no worker');
    } else fail(`skip-blocked handled wrong: ${JSON.stringify(blocked)}`);

    const later = run({ mode: 'retry-later' });
    if (!/CONTINUED/.test(later.out) && /STATE 7 \S+ failed T0 \S+ - - prefilter: transient/.test(later.trace) && /STATE 7 .* 1\n/.test(later.trace) && /RELEASE 042/.test(later.trace)) {
      pass('retry-later: recorded failed so --retry-failed picks it up, number released, no worker');
    } else fail(`retry-later handled wrong: ${JSON.stringify(later)}`);

    for (const [label, opts] of [
      ['proceed', { mode: 'proceed' }],
      ['a crashing filter', { mode: 'crash' }],
      ['an empty verdict', { mode: 'garbage' }],
      ['--no-prefilter', { mode: 'skip-dead', prefilter: 'false' }],
      ['the script absent', { mode: 'skip-dead', withStub: false }],
    ]) {
      const r = run(opts);
      if (/CONTINUED/.test(r.out) && r.trace === '' && r.jdLeft) pass(`${label}: the worker is spawned and nothing is recorded or released`);
      else fail(`${label} did not fail open: ${JSON.stringify(r)}`);
    }
  } finally {
    try { rmSync(work, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}
