// tests/unattended-runs.test.mjs — a run nobody can answer never ends on a
// question. Every mode with a gate names its default and its one closing line.
//
// Before, only the agency gate had a headless handoff. A `-p` run of `add`,
// `cover` or `oferta` with a blacklist hit ended on "Approve?" or "Do you still
// want me to evaluate?", and the caller could not tell a pause from an answer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './helpers.mjs';

const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const LINE = /^needs_confirmation: [a-z_]+ \S.* - [^?]+$/;
const MODES = ['oferta', 'auto-pipeline', 'cover', 'apply', 'add', 'expand', 'intake', 'interview'];

function unattendedParagraph(text) {
  const start = text.indexOf('**Unattended runs**');
  assert.ok(start >= 0, 'no **Unattended runs** paragraph');
  const end = text.indexOf('\n\n', start);
  return text.slice(start, end < 0 ? undefined : end);
}

const closingLines = (text) => [...text.matchAll(/`(needs_confirmation: [^`]+)`/g)].map((m) => m[1]);

test('_shared.md defines when a run is unattended and the one closing line', () => {
  const shared = read('modes/_shared.md');
  const start = shared.indexOf('### Unattended runs');
  assert.ok(start >= 0, 'missing ### Unattended runs');
  const section = shared.slice(start, shared.indexOf('\n### ', start + 1));
  for (const signal of ['headless', '-p', 'codex exec', 'batch/batch-prompt.md']) assert.ok(section.includes(signal), `does not name ${signal}`);
  assert.ok(section.includes('needs_confirmation: {gate} {detail} - {resume}'));
  assert.match(section, /never end on a question/i);
  assert.match(section, /update/i);
  assert.match(section, /already carries[^.]*resolves that gate/i, 'a decision in the prompt must resolve its gate');
  assert.match(section, /same item/i, 'an approval binds to the item it names');
});

const GATE_DETAILS = {
  oferta: [/needs_confirmation: posting_closed /, /needs_confirmation: jd_unavailable /, /needs_confirmation: agency \{url or company\/role\} /],
  'auto-pipeline': [/needs_confirmation: posting_closed /, /needs_confirmation: jd_unavailable /, /needs_confirmation: agency \{url or company\/role\} /],
  apply: [/needs_confirmation: blacklist /, /tailored CV/, /needs_confirmation: posting_closed /, /needs_confirmation: liveness_unverified /, /answers the prompt gives/i],
  add: [/needs_confirmation: add_input /, /unless the prompt already approves/i, /same source/i],
  expand: [/github-evidence\.mjs/, /unless the prompt already approves/i],
  intake: [/unless the prompt already approves/i],
};

for (const [mode, patterns] of Object.entries(GATE_DETAILS)) {
  test(`${mode} covers each of its gates in the unattended paragraph`, () => {
    const paragraph = unattendedParagraph(read(`modes/${mode}.md`));
    for (const pattern of patterns) assert.match(paragraph, pattern);
  });
}

test('the closing-line format also fits the dealbreaker gate line', () => {
  assert.match('needs_confirmation: dealbreaker "No fully on-site roles" - rerun with "evaluate anyway" to evaluate', LINE);
});

for (const mode of MODES) {
  test(`${mode} names its unattended default and closes on one needs_confirmation line`, () => {
    const text = read(`modes/${mode}.md`);
    const paragraph = unattendedParagraph(text);
    assert.ok(paragraph.includes('`modes/_shared.md` → **Unattended runs**'), 'does not point at the shared rule');
    assert.match(paragraph, /never ask|do not start/i);
    const lines = closingLines(paragraph);
    assert.ok(lines.length > 0, 'no needs_confirmation line');
    for (const line of lines) assert.match(line, LINE, line);
    assert.ok(text.indexOf('**Unattended runs**') < text.indexOf('\n## '), 'the paragraph must come before the first step');
  });
}

test('the update check stays silent in an unattended run', () => {
  const agents = read('AGENTS.md');
  const check = agents.slice(agents.indexOf('## Update Check'), agents.indexOf('\n## ', agents.indexOf('## Update Check') + 1));
  assert.match(check, /unattended run[^.]*say nothing/i);
});
