// tests/batch-runner-jd-api-fallback.test.mjs — pins the fetch-jd.mjs fallback
// that runs after the curl prefetch in batch/batch-runner.sh.
//
// THE BUG THIS PINS
//
// On a Workday posting the curl prefetch gets the JS shell, the word-count
// check truncates $jd_file to 0 bytes, and the worker's WebFetch hits the same
// empty shell. The worker then stops with "JD file was empty" and no report,
// although fetch-jd.mjs returns the full JD from the Workday API for the same
// URL. The fallback fills an empty $jd_file from fetch-jd.mjs.
//
// The test extracts the real block from batch-runner.sh and runs it against a
// stub fetch-jd.mjs, so the test and the implementation cannot drift apart.
import { pass, fail, rmSync, getBash } from './helpers.mjs';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'batch/batch-runner.sh'), 'utf-8').replace(/\r\n/g, '\n');

console.log('\nbatch-runner.sh — fetch-jd.mjs fallback after the curl prefetch');

const block = (() => {
  const m = SRC.match(/  if \[\[ ! -s "\$jd_file" \]\] && node "\$PROJECT_DIR\/fetch-jd\.mjs"[\s\S]*?\n  fi\n/);
  return m ? m[0] : null;
})();

if (!block) {
  fail('fetch-jd.mjs fallback block is missing from batch-runner.sh');
} else {
  pass('fetch-jd.mjs fallback block is present');
  const bash = getBash();
  const work = mkdtempSync(join(tmpdir(), 'jd-api-fallback-'));
  try {
    const run = (stub, initial) => {
      writeFileSync(join(work, 'fetch-jd.mjs'), stub);
      const jdFile = join(work, 'jd.txt');
      writeFileSync(jdFile, initial);
      const script = join(work, 'case.sh');
      writeFileSync(script, [
        `PROJECT_DIR=${JSON.stringify(work)}`,
        `jd_file=${JSON.stringify(jdFile)}`,
        'url="https://example.wd1.myworkdayjobs.com/jobs/job/R1"',
        block,
      ].join('\n'));
      spawnSync(bash, [script], { encoding: 'utf-8', timeout: 30000 });
      return readFileSync(jdFile, 'utf-8');
    };
    const hit = "process.stdout.write('Full JD from the ATS API');";
    const miss = 'process.exitCode = 1;';

    if (run(hit, '') === 'Full JD from the ATS API') {
      pass('empty JD file is filled from fetch-jd.mjs');
    } else {
      fail('empty JD file was not filled from fetch-jd.mjs');
    }
    if (run(hit, 'curl prefetch text') === 'curl prefetch text') {
      pass('a JD file the curl prefetch filled is left alone');
    } else {
      fail('the fallback overwrote a JD file the curl prefetch had filled');
    }
    if (run(miss, '') === '') {
      pass('a fetch-jd.mjs miss leaves the JD file empty, so the worker WebFetch fallback still fires');
    } else {
      fail('a fetch-jd.mjs miss left content in the JD file');
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
