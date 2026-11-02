// A batch worker that hits one of the candidate's hard rules writes a SKIP
// tracker row and hands back status "skipped". The runner records a finished
// skip, keeps the row for the merge, and lists it in the summary. Fixtures run
// the runner's real result-handling and summary code, as in
// delegated-agency-confirmation.test.mjs.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { ROOT, pass, fail, rmSync, getBash } from './helpers.mjs';

console.log('\nBatch dealbreaker skip');
const read = (path) => readFileSync(join(ROOT, path), 'utf8').replace(/\r\n/g, '\n');
const runner = read('batch/batch-runner.sh');
const prompt = read('batch/batch-prompt.md');
const resultStart = runner.indexOf('    local worker_result_json\n');
const resultEnd = runner.indexOf('\n  elif [[ "$terminal_failure_recorded"', resultStart);
assert(resultStart >= 0 && resultEnd > resultStart, 'runner result-handling boundaries');
const resultCode = runner.slice(resultStart, resultEnd);
const functionCode = (name) => {
  const match = runner.match(new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}`, 'm'));
  assert(match, `runner function ${name}`);
  return match[0];
};
const work = mkdtempSync(join(tmpdir(), 'career-dealbreaker-batch-'));
const check = (name, fn) => {
  try { fn(); pass(name); } catch (error) { fail(`${name}: ${error.message}`); }
};

const URL = 'https://jobs.example.test/1';
const RULE = 'No fully on-site roles';
const JD_LINE = 'This role is on site in Springfield five days a week.';
const HEADER = 'num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\turl';
const skipRow = (over = {}) => {
  const f = { num: '042', date: '2026-01-31', company: 'Fabrikam', role: 'Product Designer', status: 'SKIP', score: 'N/A', pdf: '❌', report: '-', notes: `Dealbreaker: "${RULE}" vs "${JD_LINE}"`, url: URL, ...over };
  return `${HEADER}\n${[f.num, f.date, f.company, f.role, f.status, f.score, f.pdf, f.report, f.notes, f.url].join('\t')}\n`;
};
const skipPayload = (over = {}) => ({ status: 'skipped', reason: 'dealbreaker', id: '1', url: URL, report_num: '042', rule: RULE, jd_line: JD_LINE, score: null, pdf: null, report: null, error: null, ...over });

try {
  mkdirSync(join(work, 'reports'));
  const harness = join(work, 'result.sh');
  writeFileSync(harness, `set -euo pipefail
cd "$(dirname "$0")"
REPORTS_DIR="$PWD/reports"
TRACKER_DIR="$PWD/tracker-additions"
LOGS_DIR="$PWD/logs"
mkdir -p "$TRACKER_DIR" "$LOGS_DIR"
log_file="$PWD/worker.log"
MAX_RETRIES=2
MIN_SCORE=0
RECOVERY_DIR="$PWD/recovery"
update_state() { printf '%s\\n' "$@" > state; }
append_recovery_record() { printf '%s\\n' "$@" > recovery; }
sleep() { :; }
${functionCode('update_state_retrying')}
${functionCode('has_report_file')}
release_report_num() { printf '%s' "$1" > released; }
is_decimal_number() { [[ "$1" =~ ^[0-9]+([.][0-9]+)?$ ]]; }
handle_result() {
  local id=1 url=${URL} started_at=start completed_at=end report_num=042 retries=0
${resultCode}
}
handle_result
`);
  const reset = () => {
    for (const name of ['state', 'recovery', 'released']) rmSync(join(work, name), { force: true });
    rmSync(join(work, 'tracker-additions'), { recursive: true, force: true });
    rmSync(join(work, 'logs'), { recursive: true, force: true });
    for (const f of readdirSync(join(work, 'reports'))) rmSync(join(work, 'reports', f), { force: true });
  };
  const handle = (payload, { tsv, report } = {}) => {
    reset();
    mkdirSync(join(work, 'tracker-additions'), { recursive: true });
    if (tsv !== undefined) writeFileSync(join(work, 'tracker-additions', '1.tsv'), tsv);
    if (report) writeFileSync(join(work, 'reports', '042-fabrikam-2026-01-31.md'), '# Fictional report\n');
    writeFileSync(join(work, 'worker.log'), `\`\`\`json\n${JSON.stringify(payload)}\n\`\`\`\n`);
    const res = spawnSync(getBash(), [harness], { encoding: 'utf8', timeout: 30000 });
    const path = existsSync(join(work, 'state')) ? 'state' : 'recovery';
    return {
      status: res.status,
      output: res.stdout + res.stderr,
      fields: existsSync(join(work, path)) ? readFileSync(join(work, path), 'utf8').trimEnd().split('\n') : [],
    };
  };

  check('a dealbreaker skip with its SKIP row is a finished skip, not a hold or a failure', () => {
    const { status, fields, output } = handle(skipPayload(), { tsv: skipRow() });
    assert.equal(status, 0, output);
    assert.equal(fields[2], 'skipped');
    assert.equal(fields[5], '042');
    assert.equal(fields[6], '-');
    assert.equal(fields[7], `dealbreaker: "${RULE}"`);
    assert.equal(fields[8], '0');
    assert.equal(existsSync(join(work, 'released')), false, 'the SKIP row holds its number until the merge');
    assert.equal(readFileSync(join(work, 'tracker-additions', '1.tsv'), 'utf8'), skipRow(), 'the SKIP row stays for the merge');
    assert.equal(existsSync(join(work, 'logs', 'quarantine')), false);
    assert.match(output, /Skipped \(dealbreaker\)/);
    assert.doesNotMatch(output, /Needs confirmation|Failed/);
  });

  check('rule text with tabs or line breaks cannot split the state row', () => {
    const { fields } = handle(skipPayload({ rule: 'No\ton-site\nroles' }), { tsv: skipRow() });
    assert.equal(fields.length, 9);
    assert.equal(fields[7], 'dealbreaker: "No on-site roles"');
  });

  check('the reserved number matches the SKIP row with or without zero padding', () => {
    const { fields } = handle(skipPayload(), { tsv: skipRow({ num: '42' }) });
    assert.equal(fields[2], 'skipped');
  });

  check('a dealbreaker skip without a tracker row fails and can be retried', () => {
    const { fields } = handle(skipPayload());
    assert.equal(fields[2], 'failed');
    assert.match(fields[7], /dealbreaker skip without a valid SKIP tracker row/);
    assert.equal(fields[8], '1');
  });

  for (const [name, tsv] of [
    ['a row that is not SKIP', skipRow({ status: 'Evaluated' })],
    ['a row for another URL', skipRow({ url: 'https://jobs.example.test/other' })],
    ['a row without the quoted rule', skipRow({ notes: 'on-site' })],
    ['a row with another number than the reserved one', skipRow({ num: '041' })],
  ]) {
    check(`${name} is quarantined and the job fails`, () => {
      const { fields } = handle(skipPayload(), { tsv });
      assert.equal(fields[2], 'failed');
      assert.equal(existsSync(join(work, 'tracker-additions', '1.tsv')), false);
      assert.equal(readFileSync(join(work, 'logs', 'quarantine', '1-tracker.tsv'), 'utf8'), tsv);
    });
  }

  for (const mismatch of [{ id: '2' }, { url: 'https://jobs.example.test/other' }, { reason: 'other' }, { rule: '' }]) {
    check(`a skip handoff with a wrong ${Object.keys(mismatch)[0]} fails and quarantines its row`, () => {
      const { fields } = handle(skipPayload(mismatch), { tsv: skipRow() });
      assert.equal(fields[2], 'failed');
      assert.equal(existsSync(join(work, 'tracker-additions', '1.tsv')), false);
    });
  }

  check('a dealbreaker skip that also wrote a report quarantines both', () => {
    const { fields } = handle(skipPayload(), { tsv: skipRow(), report: true });
    assert.equal(fields[2], 'failed');
    assert.deepEqual(readdirSync(join(work, 'reports')), []);
    assert.ok(existsSync(join(work, 'logs', 'quarantine', '1-042-fabrikam-2026-01-31.md')));
    assert.ok(existsSync(join(work, 'logs', 'quarantine', '1-tracker.tsv')));
  });

  check('agency handoffs still hold and still quarantine any tracker row', () => {
    const { status, fields } = handle({ status: 'needs_confirmation', reason: 'agency_confirmation', id: '1', url: URL, question: 'Which agency?' }, { tsv: skipRow() });
    assert.equal(status, 2);
    assert.equal(fields[2], 'needs_confirmation');
    assert.ok(existsSync(join(work, 'logs', 'quarantine', '1-tracker.tsv')));
  });

  check('normal completed reports are unchanged', () => {
    const { fields } = handle({ status: 'completed', id: '1', score: 4.2, error: null }, { report: true });
    assert.equal(fields[2], 'completed');
    assert.deepEqual(fields.slice(5), ['042', '4.2', '-', '0']);
  });

  check('after the merge, the runner releases the numbers its dealbreaker SKIP rows held', () => {
    const state = join(work, 'state.tsv');
    writeFileSync(state, 'id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries\n'
      + `1\t${URL}\tskipped\ts\te\t042\t-\tdealbreaker: "${RULE}"\t0\n`
      + '2\thttps://jobs.example.test/2\tcompleted\ts\te\t043\t4.1\t-\t0\n'
      + '3\thttps://jobs.example.test/3\tskipped\ts\te\t044\t2.0\tbelow-min-score\t0\n');
    const project = join(work, 'project');
    mkdirSync(project, { recursive: true });
    for (const name of ['merge-tracker', 'reconcile-pipeline', 'verify-pipeline']) {
      writeFileSync(join(project, `${name}.mjs`), `console.log('RAN ${name}');\n`);
    }
    const script = join(work, 'merge.sh');
    writeFileSync(script, `set -euo pipefail
STATE_FILE="${state}"
PROJECT_DIR="${project}"
release_report_num() { echo "RELEASED:$1"; }
${functionCode('merge_tracker')}
merge_tracker
`);
    const output = execFileSync(getBash(), [script], { encoding: 'utf8', timeout: 30000 });
    assert.deepEqual(output.match(/RELEASED:\d+/g), ['RELEASED:042']);
    assert.ok(output.indexOf('RAN merge-tracker') < output.indexOf('RELEASED:042'), 'release waits for the merge');
  });

  check('the summary counts dealbreaker skips and lists each with its rule', () => {
    const state = join(work, 'state.tsv');
    writeFileSync(state, 'id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries\n'
      + `1\t${URL}\tskipped\ts\te\t042\t-\tdealbreaker: "${RULE}"\t0\n`
      + '2\thttps://jobs.example.test/2\tcompleted\ts\te\t043\t4.1\t-\t0\n'
      + '3\thttps://jobs.example.test/3\tskipped\ts\te\t044\t2.0\tbelow-min-score\t0\n');
    const script = join(work, 'summary.sh');
    writeFileSync(script, `set -euo pipefail
STATE_FILE="${state}"
BATCH_DIR="${work}"
is_decimal_number() { [[ "$1" =~ ^[0-9]+([.][0-9]+)?$ ]]; }
${functionCode('print_summary')}
print_summary
`);
    const output = execFileSync(getBash(), [script], { encoding: 'utf8', timeout: 30000 });
    assert.match(output, /Skipped: 2/);
    assert.match(output, /Dealbreaker skips: 1/);
    assert.ok(output.includes(`#1 ${URL} — dealbreaker: "${RULE}"`), output);
    assert.match(output, /evaluate anyway/);
  });

  const gateStart = prompt.indexOf('### Step 1.6 — Dealbreaker gate');
  const gate = prompt.slice(gateStart, prompt.indexOf('### Step 2', gateStart));
  check('the worker prompt runs the dealbreaker gate after the agency gate and before evaluating', () => {
    assert.ok(gateStart > prompt.indexOf('### Step 1.5 — Agency confirmation gate'));
    assert.ok(gateStart < prompt.indexOf('### Step 2 — Evaluate'));
    assert.match(gate, /hard rule/i);
    assert.match(gate, /compensation\.minimum/);
    assert.match(gate, /inferred fact is not a hit/i);
    assert.match(gate, /no report/i);
    assert.match(gate, /evaluate anyway/);
    assert.match(gate, /tab or line break[^.]*with a space/i);
  });

  check('the worker prompt hands back the exact skip payload the runner accepts', () => {
    const json = JSON.parse(gate.match(/```json\n([\s\S]*?)```/)[1]);
    assert.equal(json.status, 'skipped');
    assert.equal(json.reason, 'dealbreaker');
    for (const key of ['id', 'url', 'report_num', 'rule', 'jd_line']) assert.ok(key in json, key);
  });

  check('the SKIP row the prompt shows merges into the tracker with the rule and the JD line', () => {
    const tsv = gate.match(/```text\n(num\\t[\s\S]*?)```/)?.[1];
    assert.ok(tsv, 'gate has no TSV example');
    const dir = mkdtempSync(join(tmpdir(), 'co-batch-dealbreaker-'));
    try {
      mkdirSync(join(dir, 'data'));
      mkdirSync(join(dir, 'batch', 'tracker-additions'), { recursive: true });
      writeFileSync(join(dir, 'data', 'applications.md'), '# Applications Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|------|---------|------|-------|--------|-----|--------|-------|\n');
      const row = tsv.replaceAll('{{REPORT_NUM}}', '7').replaceAll('{{DATE}}', '2026-01-31').replace('{company}', 'Fabrikam')
        .replace('{role}', 'Product Designer').replace('{rule}', RULE).replace('{jd_line}', JD_LINE)
        .replaceAll('{{URL}}', URL).replaceAll('\\t', '\t');
      writeFileSync(join(dir, 'batch', 'tracker-additions', '1.tsv'), row);
      const env = { ...process.env, CAREER_OPS_ROOT: dir };
      for (const k of ['CAREER_OPS_DATA_DIR', 'CAREER_OPS_PROFILE', 'CAREER_OPS_TRACKER']) delete env[k];
      const res = spawnSync(process.execPath, [join(ROOT, 'merge-tracker.mjs')], { cwd: dir, encoding: 'utf8', env });
      assert.equal(res.status, 0, res.stderr);
      const merged = readFileSync(join(dir, 'data', 'applications.md'), 'utf8').trim().split('\n').at(-1);
      assert.match(merged, /\| Fabrikam \| Product Designer \| N\/A \| SKIP \|/);
      assert.ok(merged.includes(`"${RULE}"`) && merged.includes(`"${JD_LINE}"`), merged);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  check('pipeline reconcile moves a dealbreaker skip to Processed without a report link', () => {
    const dir = mkdtempSync(join(tmpdir(), 'co-batch-dealbreaker-reconcile-'));
    try {
      mkdirSync(join(dir, 'data'));
      mkdirSync(join(dir, 'reports'));
      const other = 'https://jobs.example.test/3';
      writeFileSync(join(dir, 'data', 'pipeline.md'),
        `# Pipeline\n\n## Pending\n\n- [ ] ${URL} | Fabrikam | Product Designer\n- [ ] ${other} | Litware | Designer\n\n## Processed\n`);
      writeFileSync(join(dir, 'batch-state.tsv'), 'id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries\n'
        + `1\t${URL}\tskipped\ts\te\t042\t-\tdealbreaker: "${RULE}"\t0\n`
        + `3\t${other}\tskipped\ts\te\t044\t2.0\tbelow-min-score\t0\n`);
      const env = { ...process.env, CAREER_OPS_ROOT: dir };
      const res = spawnSync(process.execPath, [join(ROOT, 'reconcile-pipeline.mjs'), '--state', join(dir, 'batch-state.tsv')], { cwd: dir, encoding: 'utf8', env });
      assert.equal(res.status, 0, res.stderr);
      const text = readFileSync(join(dir, 'data', 'pipeline.md'), 'utf8');
      const [pending, processed] = text.split('## Processed');
      const pendingLines = pending.split('\n');
      assert.ok(!pendingLines.some((line) => line === `- [ ] ${URL} | Fabrikam | Product Designer`), text);
      assert.ok(processed.includes(`- [x] SKIP | ${URL} | Fabrikam | Product Designer | N/A | PDF ❌`), text);
      assert.ok(pendingLines.some((line) => line === `- [ ] ${other} | Litware | Designer`), 'a below-min-score skip without its report still stays pending');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
} finally {
  rmSync(work, { recursive: true, force: true });
}
