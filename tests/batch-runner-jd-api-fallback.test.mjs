// tests/batch-runner-jd-api-fallback.test.mjs — pins the ATS API fallback in
// batch/batch-runner.sh (#4246).
//
// THE GAP THIS PINS
//
// The curl prefetch correctly discards a JS shell as thin, and the worker then
// falls back to WebFetch, which hits the same unrendered shell on Ashby and on
// embedded Greenhouse boards. fetch-jd.mjs reads the JD from the ATS's public
// API instead, but nothing in the batch path called it.
//
// The call lives in the runner, not in the worker prompt: an offer URL is
// untrusted, and the runner hands it to fetch-jd.mjs as a single argv element.
// The worker prompt must never interpolate {{URL}} into a shell command.
//
// The bash block is extracted from batch-runner.sh and run against a stub
// fetch-jd.mjs, so the test and the implementation cannot drift apart.
import { pass, fail, rmSync, getBash } from './helpers.mjs';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'batch/batch-runner.sh'), 'utf-8').replace(/\r\n/g, '\n');
const PROMPT = readFileSync(join(ROOT, 'batch/batch-prompt.md'), 'utf-8');

console.log('\nbatch-runner.sh — ATS API fallback for the JD file (#4246)');

const apiBlock = (() => {
  const m = SRC.match(/  local jd_api_words=0\n  if \[\[ ! -s "\$jd_file"[\s\S]*?\n  fi\n/);
  return m ? m[0] : null;
})();

if (apiBlock) pass('batch-runner.sh has the ATS API fallback block');
else fail('ATS API fallback block is missing from batch-runner.sh');

// ── static checks ───────────────────────────────────────────────────────────

// The fallback has to run after the curl prefetch, or it would be overwritten.
const curlAt = SRC.indexOf('if command -v curl >/dev/null 2>&1; then');
const apiAt = SRC.indexOf('local jd_api_words=0');
if (curlAt !== -1 && apiAt > curlAt) pass('the API fallback runs after the curl prefetch');
else fail('the API fallback must come after the curl prefetch block');

// The URL reaches fetch-jd.mjs as one quoted argv element.
if (apiBlock && /node "\$PROJECT_DIR\/fetch-jd\.mjs" "\$url"/.test(apiBlock)) {
  pass('the offer URL is passed to fetch-jd.mjs as a quoted argument');
} else {
  fail('fetch-jd.mjs must be called as: node "$PROJECT_DIR/fetch-jd.mjs" "$url"');
}

// It only fires when the JD file is still empty.
if (apiBlock && /\[\[ ! -s "\$jd_file"/.test(apiBlock)) pass('the fallback only fires when the JD file is empty');
else fail('the fallback must be guarded by [[ ! -s "$jd_file" ]]');

// The worker prompt must not put the offer URL inside a shell command.
if (!/fetch-jd\.mjs[^\n]*\{\{URL\}\}/.test(PROMPT) && !/node [^\n]*\{\{URL\}\}/.test(PROMPT)) {
  pass('batch-prompt.md does not interpolate {{URL}} into a shell command');
} else {
  fail('batch-prompt.md interpolates {{URL}} into a shell command: the call belongs in batch-runner.sh');
}

// ── functional checks ───────────────────────────────────────────────────────

const bash = getBash();
if (!bash || !apiBlock) {
  if (apiBlock) pass('functional checks skipped: no bash available on this platform');
} else {
  const work = mkdtempSync(join(tmpdir(), 'co-jd-api-'));
  try {
    const long = Array.from({ length: 120 }, (_, i) => `word${i}`).join(' ');
    const short = 'only a few words here';

    // Stub fetch-jd.mjs: records its argv, then answers according to STUB_MODE.
    const projectDir = join(work, 'project');
    execFileSync(bash, ['-c', 'mkdir -p "$1"', 'mk', projectDir]);
    writeFileSync(join(projectDir, 'fetch-jd.mjs'), [
      "import { appendFileSync } from 'node:fs';",
      "appendFileSync(process.env.STUB_TRACE, JSON.stringify(process.argv.slice(2)) + '\\n');",
      "const mode = process.env.STUB_MODE;",
      "if (mode === 'miss') process.exitCode = 1;",
      `else process.stdout.write(mode === 'short' ? ${JSON.stringify(short)} : ${JSON.stringify(long)});`,
      '',
    ].join('\n'));

    let n = 0;
    const run = ({ mode, url, seed = '', withStub = true }) => {
      n += 1;
      const jd = join(work, `jd-${n}.txt`);
      const trace = join(work, `trace-${n}.txt`);
      writeFileSync(jd, seed);
      writeFileSync(trace, '');
      const script = join(work, `case-${n}.sh`);
      writeFileSync(script, [
        '#!/usr/bin/env bash',
        `jd_file=${JSON.stringify(jd)}`,
        `PROJECT_DIR=${JSON.stringify(withStub ? projectDir : join(work, 'no-such-project'))}`,
        'prefetch_min_words=80',
        'url="$OFFER_URL"',
        'runFallback() {',
        apiBlock,
        '}',
        'runFallback',
      ].join('\n'));
      const out = execFileSync(bash, [script], {
        encoding: 'utf-8', timeout: 30000, cwd: work,
        env: { ...process.env, STUB_MODE: mode, STUB_TRACE: trace, OFFER_URL: url, TMPDIR: work },
      });
      return { jd: readFileSync(jd, 'utf-8'), trace: readFileSync(trace, 'utf-8'), out };
    };

    const hit = run({ mode: 'hit', url: 'https://jobs.ashbyhq.com/acme/123' });
    if (hit.jd === long && /words from the ATS API/.test(hit.out)) pass('empty JD file + API hit: the API text becomes the JD file');
    else fail(`empty JD file + API hit: JD file not filled (len=${hit.jd.length})`);

    const miss = run({ mode: 'miss', url: 'https://jobs.example.com/eng-42' });
    if (miss.jd === '' && miss.trace.trim() !== '') pass('API miss (exit 1): JD file stays empty, the worker falls back to WebFetch');
    else fail(`API miss: expected an empty JD file after one call, got len=${miss.jd.length}`);

    const thin = run({ mode: 'short', url: 'https://jobs.ashbyhq.com/acme/123' });
    if (thin.jd === '') pass('API text under the word threshold is not used as a JD');
    else fail('API text under the word threshold was written to the JD file');

    const kept = run({ mode: 'hit', url: 'https://boards.greenhouse.io/acme/jobs/1', seed: 'the curl prefetch already wrote a real JD' });
    if (kept.jd === 'the curl prefetch already wrote a real JD' && kept.trace === '') pass('non-empty JD file: fetch-jd.mjs is not called');
    else fail('non-empty JD file: the fallback ran anyway');

    const absent = run({ mode: 'hit', url: 'https://jobs.ashbyhq.com/acme/123', withStub: false });
    if (absent.jd === '') pass('fetch-jd.mjs absent: the fallback is skipped without error');
    else fail('fetch-jd.mjs absent: the JD file changed');

    // A hostile URL must arrive as data: one argv element, nothing executed.
    const marker = join(work, 'pwned');
    const hostile = `https://jobs.ashbyhq.com/acme/1?x=$(touch ${marker})&y=\`touch ${marker}\`";touch ${marker};"`;
    const evil = run({ mode: 'miss', url: hostile });
    let argv = null;
    try { argv = JSON.parse(evil.trace.trim().split('\n')[0]); } catch {}
    if (!existsSync(marker) && Array.isArray(argv) && argv.length === 1 && argv[0] === hostile) {
      pass('hostile URL: passed as a single argument, no command substitution runs');
    } else {
      fail(`hostile URL: marker=${existsSync(marker)} argv=${JSON.stringify(argv)}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
