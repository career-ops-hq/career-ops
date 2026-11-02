// tests/batch-runner-thin-action.test.mjs — pins `--thin-action` in
// batch/batch-runner.sh: what happens when no usable JD text could be fetched.
//
// The detection block and the skip handler are extracted from the script and run
// against a stub browser-extract.mjs, so the test and the implementation cannot
// drift apart and no browser, network or model is involved.
import { pass, fail, rmSync, getBash } from './helpers.mjs';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'batch/batch-runner.sh'), 'utf-8').replace(/\r\n/g, '\n');

console.log('\nbatch-runner.sh — --thin-action');

const detect = SRC.match(/  local jd_thin_skip=0 jd_thin_note="" jd_thin_retryable=0\n[\s\S]*?\n  fi\n(?=\n  echo "--- Processing offer)/)?.[0] ?? null;
const act = SRC.match(/  if \[\[ "\$jd_thin_skip" == "1" \]\]; then\n[\s\S]*?\n    return 0\n  fi\n/)?.[0] ?? null;
if (detect && act) pass('batch-runner.sh has the thin-action detection block and skip handler');
else fail('thin-action blocks are missing from batch-runner.sh');

// ── ordering / contract ────────────────────────────────────────────────────
const apiAt = SRC.indexOf('local jd_api_tmp');
const detectAt = SRC.indexOf('local jd_thin_skip=0');
const processingAt = SRC.indexOf('echo "--- Processing offer');
const actAt = SRC.indexOf('if [[ "$jd_thin_skip" == "1" ]]; then');
const promptAt = SRC.indexOf('Build the prompt with placeholders replaced');
if (apiAt < detectAt && detectAt < processingAt && processingAt < actAt && actAt < promptAt) {
  pass('it runs after the prefetch and the ATS API fallback, and a skip happens before any prompt is built');
} else {
  fail('--thin-action is not ordered prefetch → API fallback → detect → skip → prompt');
}
if (/^THIN_ACTION=webfetch\b/m.test(SRC)) pass('the default is webfetch (unchanged behaviour)');
else fail('THIN_ACTION must default to webfetch');
if (act && /update_state_retrying "\$id" "\$url" "\$thin_state"/.test(act) && /release_report_num "\$report_num"/.test(act) && /rm -f "\$jd_file"/.test(act)) {
  pass('a skip records the state, releases the report number and removes the JD file');
} else {
  fail('the skip handler must record state, release the report number and remove the JD file');
}

const bash = getBash();
if (!bash || !detect || !act) {
  if (detect && act) pass('functional checks skipped: no bash available on this platform');
} else {
  const work = mkdtempSync(join(tmpdir(), 'co-thin-action-'));
  try {
    const projectDir = join(work, 'project');
    execFileSync(bash, ['-c', 'mkdir -p "$1"', 'mk', projectDir]);
    const words = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
    // Stub browser-extract.mjs: records its argv, answers according to STUB_MODE.
    writeFileSync(join(projectDir, 'browser-extract.mjs'), [
      "import { appendFileSync } from 'node:fs';",
      "appendFileSync(process.env.STUB_TRACE, JSON.stringify(process.argv.slice(2)) + '\\n');",
      "const m = process.env.STUB_MODE;",
      `if (m === 'ok') process.stdout.write(JSON.stringify({ url: 'u', title: 't', text: ${JSON.stringify(words(250))} }));`,
      `else if (m === 'short') process.stdout.write(JSON.stringify({ url: 'u', title: 't', text: ${JSON.stringify(words(20))} }));`,
      "else if (m === 'noplaywright') { console.error(JSON.stringify({ error: 'playwright not installed', code: 'no_playwright' })); process.exitCode = 1; }",
      "else if (m === 'unavailable') { console.error(JSON.stringify({ error: 'gone', code: 'unavailable' })); process.exitCode = 1; }",
      "else if (m === 'empty') { console.error(JSON.stringify({ error: 'empty', code: 'empty_text' })); process.exitCode = 1; }",
      "else { console.error(JSON.stringify({ error: 'navigation error', code: 'navigation_error' })); process.exitCode = 1; }",
      '',
    ].join('\n'));

    let n = 0;
    const run = ({ action, mode = 'ok', seed = '', curl = 0, withStub = true }) => {
      n += 1;
      const jd = join(work, `jd-${n}.txt`);
      const trace = join(work, `trace-${n}.txt`);
      writeFileSync(jd, seed);
      writeFileSync(trace, '');
      const script = join(work, `case-${n}.sh`);
      writeFileSync(script, [
        '#!/usr/bin/env bash',
        `jd_file=${JSON.stringify(jd)}`,
        `PROJECT_DIR=${JSON.stringify(withStub ? projectDir : join(work, 'nope'))}`,
        `THIN_ACTION=${JSON.stringify(action)}`,
        `curl_status=${curl}`,
        'url="https://jobs.example.com/acme/1"',
        'jd_prefetch_words=0',
        'check() {',
        detect,
        '  echo "skip=$jd_thin_skip retryable=$jd_thin_retryable words=$jd_prefetch_words note=$jd_thin_note"',
        '}',
        'check',
      ].join('\n'));
      const out = execFileSync(bash, [script], {
        encoding: 'utf-8', timeout: 30000, cwd: work,
        env: { ...process.env, STUB_MODE: mode, STUB_TRACE: trace, TMPDIR: work },
      });
      return { out: out.split('\n').filter((l) => l.startsWith('skip=')).join(''), full: out, trace: readFileSync(trace, 'utf-8'), jd: readFileSync(jd, 'utf-8') };
    };

    const web = run({ action: 'webfetch' });
    if (/^skip=0 retryable=0/.test(web.out) && web.trace === '') pass('webfetch (default): nothing changes, the browser is never launched');
    else fail(`webfetch changed behaviour: ${web.out}`);

    const skip = run({ action: 'skip' });
    if (/^skip=1 retryable=0 .*needs-playwright/.test(skip.out) && skip.trace === '') pass('skip: the offer is flagged terminal with a needs-playwright marker and no browser runs');
    else fail(`skip: ${skip.out}`);

    const retry = run({ action: 'skip', curl: 28 });
    if (/^skip=1 retryable=1 .*retryable/.test(retry.out)) pass('skip with no HTTP response (curl exit 28) stays retryable');
    else fail(`skip + curl timeout: ${retry.out}`);
    const http = run({ action: 'skip', curl: 22 });
    if (/^skip=1 retryable=0/.test(http.out)) pass('skip after an HTTP error (curl exit 22) is terminal');
    else fail(`skip + HTTP error: ${http.out}`);

    const ok = run({ action: 'browser-extract' });
    if (/^skip=0 /.test(ok.out) && /words=250/.test(ok.out) && ok.jd.split(/\s+/).filter(Boolean).length === 250 && /"--mode","jd"/.test(ok.trace)) {
      pass('browser-extract: the recovered text becomes the JD file, read in jd mode');
    } else {
      fail(`browser-extract success: ${ok.out} trace=${ok.trace}`);
    }
    const thin = run({ action: 'browser-extract', mode: 'short' });
    if (/^skip=1 retryable=0/.test(thin.out) && thin.jd === '') pass('browser-extract: a near-empty page is not used and the offer is skipped');
    else fail(`browser-extract short: ${thin.out}`);
    const failed = run({ action: 'browser-extract', mode: 'fail' });
    if (/^skip=1 retryable=1 .*navigation_error/.test(failed.out) && failed.jd === '') pass('browser-extract: navigation_error is on the retry allowlist');
    else fail(`browser-extract navigation_error: ${failed.out}`);
    const emptyText = run({ action: 'browser-extract', mode: 'empty' });
    if (/^skip=1 retryable=1 .*empty_text/.test(emptyText.out)) pass('browser-extract: empty_text is on the retry allowlist');
    else fail(`browser-extract empty_text: ${emptyText.out}`);
    const gone = run({ action: 'browser-extract', mode: 'unavailable' });
    if (/^skip=1 retryable=0 .*needs-playwright/.test(gone.out) && gone.jd === '') pass('browser-extract: any code off the allowlist (unavailable) stays terminal');
    else fail(`browser-extract unavailable: ${gone.out}`);
    const nopw = run({ action: 'browser-extract', mode: 'noplaywright' });
    if (/^skip=1 retryable=1 .*Playwright is not installed/.test(nopw.out)) pass('browser-extract: Playwright missing keeps the offer retryable');
    else fail(`browser-extract no playwright: ${nopw.out}`);

    const filled = run({ action: 'browser-extract', seed: words(120) });
    if (/^skip=0 /.test(filled.out) && filled.trace === '' && filled.jd.split(/\s+/).filter(Boolean).length === 120) pass('only when the JD is still empty: a filled JD file is left alone and no browser runs');
    else fail(`filled JD: ${filled.out}`);
    const missing = run({ action: 'browser-extract', withStub: false });
    if (/^skip=1 /.test(missing.out)) pass('browser-extract.mjs absent at this point: treated as no JD, falls to the skip rules');
    else fail(`stub absent: ${missing.out}`);

    // ── skip handler, with the state helpers stubbed ───────────────────────
    const handler = (extra, retries = 0) => {
      n += 1;
      const calls = join(work, `calls-${n}.txt`);
      const jd = join(work, `jdh-${n}.txt`);
      writeFileSync(jd, '');
      writeFileSync(calls, '');
      const script = join(work, `handler-${n}.sh`);
      writeFileSync(script, [
        '#!/usr/bin/env bash',
        `calls=${JSON.stringify(calls)}`,
        'update_state_retrying() { echo "state $3 | $8 | retries=$9" >> "$calls"; }',
        'release_report_num() { echo "release $1" >> "$calls"; }',
        `id=7; url=u; started_at=s; retries=${retries}; MAX_RETRIES=2; report_num=042`,
        `jd_file=${JSON.stringify(jd)}`,
        extra,
        'run() {',
        act,
        '  echo "NOT RETURNED" >> "$calls"',
        '}',
        'run',
      ].join('\n'));
      execFileSync(bash, [script], { encoding: 'utf-8', timeout: 30000 });
      return readFileSync(calls, 'utf-8');
    };
    const term = handler('jd_thin_skip=1; jd_thin_retryable=0; jd_thin_note="no usable JD"');
    if (/state skipped \| no usable JD/.test(term) && /release 042/.test(term) && !/NOT RETURNED/.test(term)) pass('handler: a terminal skip records "skipped", releases the report number and returns');
    else fail(`handler terminal: ${term}`);
    const retr = handler('jd_thin_skip=1; jd_thin_retryable=1; jd_thin_note="connect failed"');
    if (/state failed \| connect failed/.test(retr) && /release 042/.test(retr)) pass('handler: a retryable skip records "failed" so --retry-failed picks it up');
    else fail(`handler retryable: ${retr}`);
    if (/retries=1/.test(retr)) pass('handler: a retryable skip spends one retry');
    else fail(`handler retry count: ${retr}`);
    const spent = handler('jd_thin_skip=1; jd_thin_retryable=1; jd_thin_note="connect failed"', 2);
    if (/state failed .*retries=2/.test(spent)) pass('handler: the retry count never exceeds --max-retries');
    else fail(`handler retry cap: ${spent}`);
    const termRetries = handler('jd_thin_skip=1; jd_thin_retryable=0; jd_thin_note="x"');
    if (/state skipped .*retries=0/.test(termRetries)) pass('handler: a terminal skip leaves the retry count alone');
    else fail(`handler terminal retries: ${termRetries}`);
    const none = handler('jd_thin_skip=0');
    if (none.trim() === 'NOT RETURNED') pass('handler: without a flagged skip it does nothing');
    else fail(`handler idle: ${none}`);

    // ── CLI validation ─────────────────────────────────────────────────────
    const proj = join(work, 'cli');
    mkdirSync(join(proj, 'batch'), { recursive: true });
    writeFileSync(join(proj, 'batch', 'batch-runner.sh'), SRC);
    chmodSync(join(proj, 'batch', 'batch-runner.sh'), 0o755);
    writeFileSync(join(proj, 'batch', 'batch-input.tsv'), 'id\turl\tsource\tnotes\n');
    writeFileSync(join(proj, 'batch', 'batch-prompt.md'), '# prompt\n');
    const bin = join(proj, 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'claude'), '#!/bin/sh\nexit 0\n');
    chmodSync(join(bin, 'claude'), 0o755);
    const cli = (...args) => {
      const r = spawnSync(bash, [join(proj, 'batch', 'batch-runner.sh'), ...args], {
        cwd: proj, encoding: 'utf-8', timeout: 60000, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CAREER_OPS_ROOT: proj },
      });
      return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
    };
    const bad = cli('--thin-action', 'bogus');
    if (bad.code === 1 && /--thin-action must be 'skip', 'webfetch' or 'browser-extract' \(got 'bogus'\)/.test(bad.out)) pass('CLI: an unknown --thin-action value exits 1 with a clear message');
    else fail(`CLI bogus: code=${bad.code} ${bad.out.slice(0, 200)}`);
    const noArg = cli('--thin-action');
    if (noArg.code === 1 && /--thin-action requires an argument/.test(noArg.out)) pass('CLI: --thin-action without a value exits 1');
    else fail(`CLI no arg: code=${noArg.code} ${noArg.out.slice(0, 200)}`);
    const noExtract = cli('--thin-action', 'browser-extract', '--dry-run');
    if (noExtract.code === 1 && /needs browser-extract\.mjs/.test(noExtract.out)) pass('CLI: browser-extract without browser-extract.mjs exits 1');
    else fail(`CLI missing browser-extract.mjs: code=${noExtract.code} ${noExtract.out.slice(0, 200)}`);
    const okSkip = cli('--thin-action', 'skip', '--dry-run');
    if (!/needs browser-extract|must be/.test(okSkip.out)) pass('CLI: --thin-action skip is accepted without browser-extract.mjs');
    else fail(`CLI skip rejected: ${okSkip.out.slice(0, 200)}`);
  } finally {
    try { rmSync(work, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}
