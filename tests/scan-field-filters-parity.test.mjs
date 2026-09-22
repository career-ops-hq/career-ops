// tests/scan-field-filters-parity.test.mjs — #3438. scan.mjs and
// validate-portals.mjs must agree on field_filters / filter_on.
//
// scan.mjs does not run validatePortalsConfig, so it enforces these rules at
// startup on its own. Two copies of one rule set drift: a check that lives only
// in the validator protects nobody who skips it, and one that lives only in the
// scan is missing exactly when the user asks the validator. Each config below
// goes through BOTH tools, and both must reject it for a field_filters /
// filter_on reason — or, for the valid ones, both must accept it.
import { pass, fail, ROOT, NODE } from './helpers.mjs';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';

console.log('\nfield_filters / filter_on — scan.mjs and validate-portals agree');

function exec(args, opts) {
  try {
    const stdout = execFileSync(NODE, args, {
      encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000, ...opts,
    });
    return { code: 0, out: stdout };
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

function judge(portalsBody) {
  const dir = mkdtempSync(join(tmpdir(), 'scan-ffp-'));
  try {
    mkdirSync(join(dir, 'data'), { recursive: true });
    writeFileSync(join(dir, 'data', 'applications.md'), `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
`);
    writeFileSync(join(dir, 'data', 'pipeline.md'), '# Pipeline\n\n');
    const portals = join(dir, 'portals.yml');
    writeFileSync(portals, portalsBody);
    const scan = exec([join(ROOT, 'scan.mjs'), '--dry-run'], {
      cwd: dir,
      env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_PORTALS: portals },
    });
    const validator = exec(['validate-portals.mjs', '--file', portals], { cwd: ROOT });
    return { scan, validator };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const config = (fieldFilters, filterOn) => `title_filter:
  positive:
    - "Help Desk"
${fieldFilters}tracked_companies:
  - name: Fixture Board
    careers_url: https://example.invalid/jobs
    ${filterOn}
    parser:
      command: node
      script: tests/fixtures/noc-board.mjs
`;

const NOC = 'field_filters:\n  noc:\n    positive: ["stem:22"]\n';
const nocBlock = (body) => `field_filters:\n  noc:\n${body}`;

const REJECTED = [
  ['a filter_on list with a non-string entry', NOC, 'filter_on: [noc, 123]'],
  ['a filter_on list with a blank entry', NOC, 'filter_on: [noc, ""]'],
  ['an empty filter_on list', NOC, 'filter_on: []'],
  ['a filter_on naming a field with no block', NOC, 'filter_on: department'],
  ['field_filters that is a list, not a mapping', 'field_filters: [noc]\n', 'filter_on: noc'],
  ['a field_filters.title block', 'field_filters:\n  title:\n    positive: ["Help Desk"]\n', 'filter_on: title'],
  ['a misspelled key in a block', nocBlock('    positve: ["stem:22"]\n'), 'filter_on: noc'],
  ['an empty block', 'field_filters:\n  noc: {}\n', 'filter_on: noc'],
  ['a block whose lists are empty', nocBlock('    positive: []\n    negative: []\n'), 'filter_on: noc'],
  ['a keyword list with no string entry', nocBlock('    positive: [123, null]\n'), 'filter_on: noc'],
  ['a keyword list mixing a keyword and a non-string', nocBlock('    positive: ["stem:22", 123]\n'), 'filter_on: noc'],
  ['a positive list written as a bare string', nocBlock('    positive: "stem:22"\n'), 'filter_on: noc'],
  ['a bare-string negative next to a valid positive', nocBlock('    positive: ["stem:22"]\n    negative: "stem:65"\n'), 'filter_on: noc'],
];

const ACCEPTED = [
  ['a one-field declaration', NOC, 'filter_on: noc'],
  ['a negative-only block ANDed with title', nocBlock('    positive: []\n    negative: ["stem:65"]\n'), 'filter_on: [title, noc]'],
];

const REASON = /field_filters|filter_on/;

for (const [label, fieldFilters, filterOn] of REJECTED) {
  const { scan, validator } = judge(config(fieldFilters, filterOn));
  const scanOk = scan.code !== 0 && REASON.test(scan.out);
  const validatorOk = validator.code !== 0 && REASON.test(validator.out);
  if (scanOk && validatorOk) {
    pass(`${label}: rejected by both`);
  } else {
    fail(`${label}: scan ${scanOk ? 'rejects' : `exit ${scan.code}`}, validator ${validatorOk ? 'rejects' : `exit ${validator.code}`}\n`
      + `--- scan ---\n${scan.out}\n--- validator ---\n${validator.out}`);
  }
}

for (const [label, fieldFilters, filterOn] of ACCEPTED) {
  const { scan, validator } = judge(config(fieldFilters, filterOn));
  if (scan.code === 0 && validator.code === 0) {
    pass(`${label}: accepted by both`);
  } else {
    fail(`${label}: scan exit ${scan.code}, validator exit ${validator.code}\n`
      + `--- scan ---\n${scan.out}\n--- validator ---\n${validator.out}`);
  }
}
