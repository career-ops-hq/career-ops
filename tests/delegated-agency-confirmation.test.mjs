// #4359: exercise the runner's real result-handling and scheduling code with
// worker stdout fixtures. Prompt assertions cover the agent-side write gate;
// these are contract tests, not proof that an arbitrary LLM obeys its prompt.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { ROOT, pass, fail, rmSync, getBash } from './helpers.mjs';

console.log('\nDelegated agency confirmation (#4359)');
const read = (path) => readFileSync(join(ROOT, path), 'utf8').replace(/\r\n/g, '\n');
const runner = read('batch/batch-runner.sh');
const resultStart = runner.indexOf('    local worker_result_json\n');
const resultEnd = runner.indexOf('\n  elif [[ "$terminal_failure_recorded"', resultStart);
const schedulingStart = runner.indexOf('    local status\n    status=$(get_status "$id")');
const schedulingEnd = runner.indexOf('\n    if (( LIMIT > 0 ))', schedulingStart);
assert(resultStart >= 0 && resultEnd > resultStart, 'runner result-handling boundaries');
assert(schedulingStart >= 0 && schedulingEnd > schedulingStart, 'runner scheduling boundaries');
const resultCode = runner.slice(resultStart, resultEnd);
const schedulingCode = runner.slice(schedulingStart, schedulingEnd);
const work = mkdtempSync(join(tmpdir(), 'career-agency-gate-'));
const check = (name, fn) => {
  try { fn(); pass(name); } catch (error) { fail(`${name}: ${error.message}`); }
};

try {
  mkdirSync(join(work, 'reports'));
  const harness = join(work, 'result.sh');
  writeFileSync(harness, `set -euo pipefail
cd "$(dirname "$0")"
REPORTS_DIR="$PWD/reports"
log_file="$PWD/worker.log"
MAX_RETRIES=2
MIN_SCORE=0
update_state_retrying() { printf '%s\\n' "$@" > state; }
release_report_num() { printf '%s' "$1" > released; }
is_decimal_number() { [[ "$1" =~ ^[0-9]+([.][0-9]+)?$ ]]; }
handle_result() {
  local id=1 url=https://jobs.example.test/1 started_at=start completed_at=end report_num=042 retries=0
${resultCode}
}
handle_result
`);
  const handle = (payload, prefix = '') => {
    payload = { reason: 'agency_confirmation', id: '1', url: 'https://jobs.example.test/1', ...payload };
    writeFileSync(join(work, 'worker.log'), `${prefix}\n\`\`\`json\n${JSON.stringify(payload)}\n\`\`\`\n`);
    const output = execFileSync(getBash(), [harness], { encoding: 'utf8', timeout: 30000 });
    return { output, fields: readFileSync(join(work, 'state'), 'utf8').trimEnd().split('\n') };
  };
  check('needs_confirmation holds without artifacts, score, report ID, or retry consumption', () => {
    const { fields, output } = handle({ status: 'needs_confirmation', question: 'Which agency?', score: 4.8 });
    assert.equal(fields[2], 'needs_confirmation');
    assert.deepEqual(fields.slice(5), ['-', '-', 'Which agency?', '0']);
    assert.deepEqual(readdirSync(join(work, 'reports')), []);
    assert.equal(readFileSync(join(work, 'released'), 'utf8'), '042');
    assert.match(output, /https:\/\/jobs.example.test\/1.*Which agency/);
    assert.doesNotMatch(output, /Completed|Failed/);
  });
  check('handoff question control characters cannot split batch state fields', () => {
    const { fields } = handle({ status: 'needs_confirmation', question: 'Agency?\tConfirm\nplease\u001fnow' });
    assert.equal(fields.length, 9);
    assert.equal(fields[7], 'Agency? Confirm please now');
  });
  check('missing handoff question still holds with a usable parent question', () => {
    const { fields } = handle({ status: 'needs_confirmation' });
    assert.equal(fields[2], 'needs_confirmation');
    assert.match(fields[7], /Which agency/);
  });
  check('only the final fenced payload controls the result', () => {
    const { fields } = handle({ status: 'needs_confirmation' }, '```json\n{"status":"completed","score":5}\n```');
    assert.equal(fields[2], 'needs_confirmation');
  });
  for (const mismatch of [{ url: 'https://jobs.example.test/other' }, { id: '2' }, { reason: 'other' }]) {
    check(`invalid handoff ${Object.keys(mismatch)[0]} stays held for inspection`, () => {
      const { fields } = handle({ status: 'needs_confirmation', question: 'Wrong posting?', ...mismatch });
      assert.equal(fields[2], 'needs_confirmation');
      assert.match(fields[7], /Invalid confirmation handoff/);
      assert.equal(fields[8], '0');
    });
  }
  check('real worker failures retain retry accounting', () => {
    const { fields } = handle({ status: 'failed', error: 'No JD' });
    assert.equal(fields[2], 'failed');
    assert.equal(fields[8], '1');
  });
  check('claiming completion without a report still fails closed', () => {
    const { fields } = handle({ status: 'completed', score: 4.2 });
    assert.equal(fields[2], 'failed');
    assert.match(fields[7], /no report file/);
  });
  check('normal completed reports still retain score and report number', () => {
    writeFileSync(join(work, 'reports/042-example.md'), '# Fictional completed evaluation\n');
    const { fields } = handle({ status: 'completed', score: 4.2, error: null });
    assert.equal(fields[2], 'completed');
    assert.deepEqual(fields.slice(5), ['042', '4.2', '-', '0']);
  });
  for (const [name, retry, resume] of [['ordinary rerun', false, false], ['retry-failed', true, false], ['resume-paused', false, true]]) {
    check(`${name} cannot resume a held posting`, () => {
      const script = join(work, 'schedule.sh');
      writeFileSync(script, `set -euo pipefail
RESUME_PAUSED=${resume}
RETRY_FAILED=${retry}
MAX_RETRIES=2
get_status() { printf '%s' needs_confirmation; }
get_retries() { printf '0'; }
schedule() {
  local id url=https://jobs.example.test/1
  for id in 1; do
${schedulingCode}
    echo DISPATCHED
  done
}
schedule
`);
      const output = execFileSync(getBash(), [script], { encoding: 'utf8', timeout: 30000 });
      assert.match(output, /HOLD #1/);
      assert.doesNotMatch(output, /DISPATCHED/);
    });
  }
  check('all worker entrypoints require the confirmation handoff before artifact steps', () => {
    for (const [path, later] of [
      ['modes/auto-pipeline.md', '## Step 2 — Save Report'],
      ['modes/oferta.md', '## Block A'],
      ['batch/batch-prompt.md', '### Step 2 — Evaluate'],
    ]) {
      const source = read(path);
      const gate = source.indexOf('needs_confirmation');
      assert(gate >= 0 && gate < source.indexOf(later), path);
      assert.match(source.slice(0, source.indexOf(later)), /explicit answer/);
      assert.match(source.slice(0, source.indexOf(later)), /tracker.*report.*CV/);
    }
  });
  check('parent modes retain pending items and require an explicit answer', () => {
    for (const path of ['modes/_shared.md', 'modes/pipeline.md', 'modes/batch.md']) {
      const source = read(path);
      assert.match(source, /needs_confirmation/);
      assert.match(source, /explicit answer/);
      assert.match(source, /[Pp]ending|held/);
      assert.match(source, /[Rr]elease/);
    }
  });
  check('status display treats a held question as confirmation, not failure', () => {
    const batch = join(work, 'batch');
    mkdirSync(batch);
    writeFileSync(join(batch, 'batch-runner.sh'), runner);
    writeFileSync(join(batch, 'batch-state.tsv'),
      'id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries\n' +
      '1\thttps://jobs.example.test/1\tneeds_confirmation\tstart\tend\t-\t-\tWhich agency?\t0\n');
    const output = execFileSync(getBash(), [join(batch, 'batch-runner.sh'), '--status'], { encoding: 'utf8', timeout: 30000 });
    assert.match(output, /Needs confirmation: 1/);
    assert.match(output, /Needs confirmation: Which agency/);
    assert.doesNotMatch(output, /Error: Which agency/);
  });
} finally {
  rmSync(work, { recursive: true, force: true });
}
