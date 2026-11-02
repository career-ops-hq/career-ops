// tests/validate-portals-entry-shapes.test.mjs — validate-portals names the two
// portals.yml shapes the scanner reads differently from how they look.
//
//   1. `enabled: no` / `enabled: off` / `enabled: "false"`. Every consumer
//      (scan.mjs, scan-ats-full, verify-portals, audit-portals, ...) reads only
//      a boolean `false` as "off". js-yaml follows YAML 1.2, where `no` and
//      `off` are strings, so the entry stays enabled while looking disabled.
//   2. `title_filter.positive: Engineer` (a bare string instead of a list).
//      buildTitleFilter drops a non-array list, so the filter silently matches
//      every title, yet validate-portals used to report "0 errors, 0 warnings".
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { pass, fail, run, NODE, ROOT, rmSync } from './helpers.mjs';

console.log('\nvalidate-portals — entry shapes the scanner reads differently from how they look');

const tmp = mkdtempSync(join(tmpdir(), 'co-vp-shapes-'));
const writeYml = (name, body) => {
  const p = join(tmp, name);
  writeFileSync(p, body, 'utf-8');
  return p;
};
const validate = (file) => run(NODE, ['validate-portals.mjs', '--file', file]);
// run() maps every non-zero exit to null, so a crash would look like a reported error;
// keep the exit status and the output to assert on the message itself.
const validateWithOutput = (file) => {
  const r = spawnSync(NODE, ['validate-portals.mjs', '--file', file], { cwd: ROOT, encoding: 'utf-8' });
  return { status: r.status, output: `${r.stdout}${r.stderr}` };
};

try {
  for (const [label, value] of [['no', 'no'], ['off', 'off'], ['quoted "false"', '"false"'], ['0', '0']]) {
    const file = writeYml(`enabled-${label.replace(/\W/g, '')}.yml`, `
title_filter:
  positive: ["QA"]
tracked_companies:
  - name: "Acme"
    careers_url: "https://jobs.lever.co/acme"
    enabled: ${value}
`);
    const { status, output } = validateWithOutput(file);
    if (status === 1 && output.includes('tracked_companies[0].enabled')) {
      pass(`enabled: ${value} is an error on tracked_companies[0].enabled (the entry would still be scanned)`);
    } else {
      fail(`enabled: ${value} was not reported on tracked_companies[0].enabled (exit ${status}):\n${output}`);
    }
  }

  const booleans = writeYml('enabled-booleans.yml', `
title_filter:
  positive: ["QA"]
tracked_companies:
  - name: "Acme"
    careers_url: "https://jobs.lever.co/acme"
    enabled: false
  - name: "Globex"
    careers_url: "https://jobs.lever.co/globex"
    enabled: true
  - name: "Initech"
    careers_url: "https://jobs.lever.co/initech"
`);
  const booleansOut = validate(booleans);
  if (booleansOut !== null && booleansOut.includes('0 errors')) pass('true, false and an absent enabled stay valid');
  else fail(`boolean enabled values were rejected:\n${booleansOut}`);

  const bare = writeYml('bare-string-title-filter.yml', `
title_filter:
  positive: "Engineer"
  negative: Intern
tracked_companies:
  - name: "Acme"
    careers_url: "https://jobs.lever.co/acme"
`);
  const bareOut = validate(bare);
  if (bareOut !== null && /title_filter\.positive/.test(bareOut) && /title_filter\.negative/.test(bareOut)
      && /0 errors, 2 warnings/.test(bareOut)) {
    pass('a bare-string title_filter list is a warning that names the key, not a clean run');
  } else {
    fail(`a bare-string title_filter list was not flagged:\n${bareOut}`);
  }

  const lists = writeYml('list-title-filter.yml', `
title_filter:
  positive: ["Engineer"]
  negative: ["Intern"]
tracked_companies:
  - name: "Acme"
    careers_url: "https://jobs.lever.co/acme"
`);
  const listsOut = validate(lists);
  if (listsOut !== null && listsOut.includes('0 errors, 0 warnings')) pass('list-valued title_filter keys stay clean');
  else fail(`list-valued title_filter keys were flagged:\n${listsOut}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
