// tests/validate-portals-job-boards.test.mjs — validate-portals applies one
// entry schema (name / careers_url / api / provider / parser) to both
// `tracked_companies` and `job_boards`, and the two lists share an enabled-name
// namespace. Diagnostics name the list they came from: `tracked_companies`
// entries use the noun "company", `job_boards` entries use "job board".
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, run, NODE, rmSync } from './helpers.mjs';

console.log('\nvalidate-portals — job_boards entry validation');

const tmp = mkdtempSync(join(tmpdir(), 'co-vp-jb-'));
const writeYml = (name, body) => {
  const p = join(tmp, name);
  writeFileSync(p, body, 'utf-8');
  return p;
};

try {
  // 1. An unknown provider under job_boards is an error.
  const badProvider = writeYml('bad-provider.yml', `
title_filter:
  positive: ["QA"]
job_boards:
  - name: "Some Aggregator"
    provider: "not-a-real-provider"
`);
  if (run(NODE, ['validate-portals.mjs', '--file', badProvider]) === null) {
    pass('job_boards unknown provider → non-zero exit');
  } else {
    fail('job_boards unknown provider should fail validation');
  }

  // 2. job_boards present but not a list.
  const notArray = writeYml('not-array.yml', `
title_filter:
  positive: ["QA"]
job_boards:
  name: oops
`);
  if (run(NODE, ['validate-portals.mjs', '--file', notArray]) === null) {
    pass('job_boards non-array → non-zero exit');
  } else {
    fail('job_boards non-array should fail validation');
  }

  // 3. A well-formed job_boards list alongside tracked_companies validates clean.
  const good = writeYml('good.yml', `
title_filter:
  positive: ["QA"]
tracked_companies:
  - name: "Acme"
    careers_url: "https://jobs.lever.co/acme"
job_boards:
  - name: "Aggregator board A"
    provider: hackernews
  - name: "Aggregator board B"
    provider: arbeitnow
`);
  const goodOut = run(NODE, ['validate-portals.mjs', '--file', good]);
  if (goodOut !== null && goodOut.includes('0 errors')) {
    pass('valid job_boards + tracked_companies → 0 errors');
  } else {
    fail(`a valid job_boards list should not raise errors — got:\n${goodOut}`);
  }

  // 4. A name shared by an enabled tracked_companies entry and an enabled
  //    job_boards entry is flagged — they collide in the scanner's per-company
  //    reporting — as a WARNING, not an error, and the job_boards side is
  //    labelled "job board".
  const dupName = writeYml('dup-name.yml', `
title_filter:
  positive: ["QA"]
tracked_companies:
  - name: "Twinco"
    careers_url: "https://job-boards.greenhouse.io/twinco"
job_boards:
  - name: "Twinco"
    provider: thehub
`);
  const dupOut = run(NODE, ['validate-portals.mjs', '--file', dupName]);
  if (dupOut !== null
    && dupOut.includes('0 errors')
    && /warning: job_boards\[0\]\.name: duplicate enabled job board name/.test(dupOut)) {
    pass('cross-list duplicate name → warning labelled "job board", exit 0');
  } else {
    fail(`cross-list duplicate name should warn (labelled "job board") and still exit 0 — got:\n${dupOut}`);
  }

  // 5. The tracked_companies duplicate-name warning uses the noun "company". (A
  //    warning-only config is used so run() — which returns stdout only on a
  //    zero exit — can capture the message text.)
  const tcWord = writeYml('tc-word.yml', `
title_filter:
  positive: ["QA"]
tracked_companies:
  - name: "Dup Co"
    careers_url: "https://jobs.lever.co/one"
  - name: "Dup Co"
    careers_url: "https://jobs.lever.co/two"
`);
  const tcWordOut = run(NODE, ['validate-portals.mjs', '--file', tcWord]);
  if (tcWordOut !== null
    && /duplicate enabled company name also seen at tracked_companies\[0\]\.name/.test(tcWordOut)) {
    pass('tracked_companies duplicate warning uses the "company" noun');
  } else {
    fail(`tracked_companies duplicate warning wording — got:\n${tcWordOut}`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
