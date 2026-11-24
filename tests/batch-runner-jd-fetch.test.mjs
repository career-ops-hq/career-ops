// tests/batch-runner-jd-fetch.test.mjs — the runner's single JD read: the block that
// calls fetch-jd.mjs and acts on its exit code. The block is
// extracted from the script and run against a stub fetch-jd.mjs.
import { pass, fail, getBash } from './helpers.mjs';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'batch/batch-runner.sh'), 'utf-8').replace(/\r\n/g, '\n');

console.log('\nbatch-runner.sh — JD read through fetch-jd.mjs');

const block = SRC.match(/  local prefetch_min_words=80\n[\s\S]*?no usable JD text — worker will WebFetch"\n  fi\n/)?.[0] ?? null;
if (block) pass('batch-runner.sh has the fetch-jd read block');
else fail('the fetch-jd read block is missing from batch-runner.sh');

if (!SRC.includes('jd-rescue') && !/\bcurl --/.test(SRC)) pass('batch-runner.sh has no jd-rescue and no curl of its own');
else fail('batch-runner.sh still references jd-rescue or runs its own curl');

const bash = getBash();
if (block && bash) {
  const work = mkdtempSync(join(tmpdir(), 'co-jdfetch-'));
  try {
    const words = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
    writeFileSync(join(work, 'fetch-jd.mjs'), [
      "import { writeFileSync } from 'node:fs';",
      "writeFileSync(process.env.STUB_ARGS, process.argv.slice(2).join('|'));",
      "const mode = process.env.STUB_MODE;",
      `const jd = ${JSON.stringify(words(100))};`,
      "if (mode === 'jd') process.stdout.write(jd);",
      "else if (mode === 'short') process.stdout.write('only a few words');",
      "else if (mode === 'truncated') process.stdout.write(jd + '\\nJob description truncated here: the posting is longer than 20000 characters.');",
      "else if (mode === 'unreachable') Reflect.set(process, 'exitCode', 2);",
      "else if (mode === 'closed') { process.stdout.write('CLOSED_POSTING HTTP 404'); Reflect.set(process, 'exitCode', 3); }",
      "else Reflect.set(process, 'exitCode', 1);",
      '',
    ].join('\n'));
    let n = 0;
    const run = ({ mode, stub = true }) => {
      n += 1;
      const jd = join(work, `jd-${n}.txt`);
      const args = join(work, `args-${n}.txt`);
      writeFileSync(jd, '');
      writeFileSync(args, '');
      const script = join(work, `case-${n}.sh`);
      writeFileSync(script, [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        `jd_file=${JSON.stringify(jd)}`,
        `PROJECT_DIR=${JSON.stringify(stub ? work : join(work, 'none'))}`,
        'url="https://careers.example.com/jobs/1"',
        'one() {',
        block,
        'printf "NOTE=%s\\n" "$jd_closed_note"',
        'printf "WORDS=%s\\n" "$jd_prefetch_words"',
        'printf "TRANSPORT=%s\\n" "$jd_transport_failed"',
        `printf "SIZE=%s\\n" "$(wc -c < "${jd}" | tr -d ' ')"`,
        '}',
        'one',
        '',
      ].join('\n'));
      const out = execFileSync(bash, [script], { encoding: 'utf-8', env: { ...process.env, STUB_MODE: mode, STUB_ARGS: args } });
      return { out, args: readFileSync(args, 'utf-8') };
    };
    const get = (out, key) => out.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1];
    const eq = (label, got, want) => (got === want ? pass(label) : fail(`${label}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`));

    let r = run({ mode: 'jd' });
    eq('a JD from fetch-jd becomes the JD file', [get(r.out, 'WORDS'), get(r.out, 'NOTE')].join('|'), '100|');
    eq('fetch-jd gets the URL as one argv element, plus --visible-text', r.args, 'https://careers.example.com/jobs/1|--visible-text');

    r = run({ mode: 'closed' });
    eq('exit 3 becomes a closed note and an empty JD file', [get(r.out, 'NOTE'), get(r.out, 'SIZE')].join('|'), 'posting closed (fetch-jd): HTTP 404|0');

    r = run({ mode: 'unreachable' });
    eq('exit 2 marks a transport failure and leaves the JD file empty', [get(r.out, 'TRANSPORT'), get(r.out, 'SIZE')].join('|'), '1|0');

    r = run({ mode: 'miss' });
    eq('a miss leaves the JD file empty and is not a transport failure', [get(r.out, 'NOTE'), get(r.out, 'TRANSPORT'), get(r.out, 'SIZE')].join('|'), '|0|0');

    r = run({ mode: 'short' });
    eq('text under the word floor is not used', get(r.out, 'SIZE'), '0');

    r = run({ mode: 'truncated' });
    eq('a truncated JD is not used as the full posting', get(r.out, 'SIZE'), '0');

    r = run({ mode: 'jd', stub: false });
    eq('a missing fetch-jd.mjs fails open with an empty JD file', get(r.out, 'SIZE'), '0');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
