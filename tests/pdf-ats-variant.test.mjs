// tests/pdf-ats-variant.test.mjs — `pdf --ats` dual emit (#3853).
//
// Step 21a of modes/pdf.md composes three mechanisms that each have their own
// suite: the fold (ats-payload.mjs), the `ats` template (cv-templates.mjs), and
// the fact gate (verify-cv-facts.mjs). What none of those suites can see is the
// composition as the mode file spells it out. So this suite pulls the `node …`
// commands out of Step 21a itself and runs them in order. A renamed flag, a
// dropped fold, or a reordered step fails here rather than in a user's run.
//
// HERMETIC: tmpdir fixtures only; CAREER_OPS_ROOT points the fact gate at a
// fixture cv.md, never the developer's real one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PDF_MODE = readFileSync(join(ROOT, 'modes', 'pdf.md'), 'utf-8').replace(/\r\n/g, '\n');
const AGENTS = readFileSync(join(ROOT, 'AGENTS.md'), 'utf-8').replace(/\r\n/g, '\n');

// Step 21a runs from its own number up to Step 22.
const STEP_21A = PDF_MODE.match(/^21a\. [\s\S]*?(?=^22\. )/m)?.[0] ?? '';

/** Backticked `node …` commands in Step 21a, in document order. */
function documentedCommands() {
  return [...STEP_21A.matchAll(/`(node [^`]+)`/g)].map((m) => m[1]);
}

const CV_MD = `# Jane Smith

## Experience

### Acme Corp — Remote
**Senior Backend Engineer** | June 2022 - Present
- Cut p99 latency from 840 ms to 120 ms across 14 services

## Skills
- Languages: Python, Go
`;

const PAYLOAD = {
  lang: 'en',
  page_format: 'letter',
  candidate: { name: 'Jane Smith', email: 'jane@example.com', location: 'Remote' },
  summary: 'Backend engineer focused on latency.',
  competencies: ['Distributed Systems', 'Latency Tuning'],
  experience: [{
    company: 'Acme Corp',
    role: 'Senior Backend Engineer',
    dates: 'June 2022 - Present',
    bullets: ['Cut p99 latency from 840 ms to **120 ms** across 14 services'],
  }],
  skills: [{ category: 'Languages', items: 'Python, Go' }],
};

/**
 * Run Step 21a's documented commands against a fixture, the way the mode does:
 * fold → resolve template → build → gate. The optional PDF render is skipped
 * (it needs Playwright, and the step marks it optional).
 */
function runDocumentedStep(payload) {
  const dir = mkdtempSync(join(tmpdir(), 'pdf-ats-variant-'));
  const dataRoot = join(dir, 'root');
  mkdirSync(join(dataRoot, 'config'), { recursive: true });
  mkdirSync(join(dir, 'output'), { recursive: true });
  writeFileSync(join(dataRoot, 'cv.md'), CV_MD);
  const styledJson = join(dir, 'cv-jane-smith-acme.json');
  writeFileSync(styledJson, JSON.stringify(payload, null, 2));
  const env = { ...process.env, CAREER_OPS_ROOT: dataRoot };

  const fill = (cmd, atsTemplate) => cmd
    .replaceAll('{candidate}', 'jane-smith')
    .replaceAll('{company}', 'acme')
    .replaceAll('/tmp/', `${dir}/`)
    .replace(/(^|\s)output\//g, `$1${dir}/output/`)
    .replaceAll('{ats-template}', atsTemplate ?? '{ats-template}');

  let atsTemplate;
  const steps = [];
  for (const raw of documentedCommands()) {
    if (raw.startsWith('node generate-pdf.mjs')) continue;
    const [command, redirect] = fill(raw, atsTemplate).split(' > ');
    const args = command.split(/\s+/).slice(1);
    const r = spawnSync(process.execPath, args, { cwd: ROOT, env, encoding: 'utf-8', timeout: 60_000 });
    assert.equal(r.error, undefined, `${raw} failed to spawn: ${r.error?.message}`);
    if (redirect) writeFileSync(redirect.trim(), r.stdout);
    if (args[0] === 'cv-templates.mjs') atsTemplate = r.stdout.trim();
    steps.push({ raw, status: r.status, stdout: r.stdout, stderr: r.stderr });
  }
  return { dir, styledJson, steps, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('pdf --ats is documented as an opt-in pass and routed from AGENTS.md', () => {
  assert.match(PDF_MODE, /^- \*\*`--ats`:\*\* .*Step 21a/m, 'Optional passes must list --ats and point at Step 21a');
  assert.ok(STEP_21A, 'modes/pdf.md must carry a Step 21a between Step 21 and Step 22');
  assert.match(STEP_21A, /off by default, opt-in only/);
  assert.match(AGENTS, /^\| [^|]+ \| `pdf --ats`/m, 'AGENTS.md Skill Modes must route pdf --ats');
});

test('Step 21a folds before it renders, renders the ats template, then gates', () => {
  const cmds = documentedCommands().map((c) => c.split(/\s+/)[1]);
  const order = ['ats-payload.mjs', 'cv-templates.mjs', 'build-cv-html.mjs', 'verify-cv-facts.mjs'];
  const positions = order.map((s) => cmds.indexOf(s));
  assert.ok(positions.every((p) => p >= 0), `Step 21a must run ${order.join(', ')}; found ${cmds.join(', ')}`);
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, `out of order: ${cmds.join(', ')}`);
  assert.ok(documentedCommands().some((c) => /resolve cv ats$/.test(c)), 'template must resolve as `ats`');
});

test('the optional ATS PDF is rendered without --report', () => {
  const pdfCmd = documentedCommands().find((c) => c.startsWith('node generate-pdf.mjs'));
  assert.ok(pdfCmd, 'Step 21a documents how to render the ATS variant to PDF');
  assert.doesNotMatch(pdfCmd, /--report/, '--report would key the ATS PDF onto the styled CV\'s pdf-index row');
});

test('the documented commands produce a gated ATS variant with competencies under Skills', () => {
  const { dir, styledJson, steps, cleanup } = runDocumentedStep(PAYLOAD);
  try {
    for (const s of steps) assert.equal(s.status, 0, `${s.raw} exited ${s.status}\n${s.stderr}`);
    const html = join(dir, 'output', 'cv-jane-smith-acme-ats.html');
    assert.ok(existsSync(html), 'output/cv-{candidate}-{company}-ats.html must be written');
    const text = readFileSync(html, 'utf-8');
    assert.match(text, /Core Competencies: <\/span>Distributed Systems, Latency Tuning/,
      'competencies must reach the ATS render as a comma-delimited Skills line');
    assert.doesNotMatch(text, /class="competency-tag"/, 'no CSS-separated tag spans in the ATS render');
    assert.deepEqual(JSON.parse(readFileSync(styledJson, 'utf-8')), PAYLOAD,
      'the styled payload must keep its competency grid; only the ATS copy is folded');
  } finally {
    cleanup();
  }
});

test('the ATS gate catches a claim the styled HTML fix never carried back to the payload', () => {
  // Step 19 lets a gate failure be fixed in the styled HTML. The JSON this
  // variant is built from still carries the claim, which is why it is gated.
  const drifted = structuredClone(PAYLOAD);
  drifted.experience[0].bullets.push('Grew revenue by 300% in one quarter');
  const { steps, cleanup } = runDocumentedStep(drifted);
  try {
    const gate = steps.find((s) => s.raw.startsWith('node verify-cv-facts.mjs'));
    assert.notEqual(gate.status, 0, 'the fact gate must fail the ATS variant on an unsourced metric');
  } finally {
    cleanup();
  }
});
