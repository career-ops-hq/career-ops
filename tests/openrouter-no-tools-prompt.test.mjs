// tests/openrouter-no-tools-prompt.test.mjs — the runner's prompt does not ask
// for tools it doesn't send (#5809).
//
// buildSystemPrompt() sends modes/_shared.md and modes/oferta.md, which are
// written for Claude Code and tell the model to navigate with Playwright, use
// WebFetch and Bash, and read cv.md. The runner's request carries no `tools`, so
// free models answered with tool calls and the runner found no score (23 replies,
// 0 scores). The runner now drops those parts, by heading, and says first that
// there are no tools.
//
// fetch() is captured, so no network is used.
//
// Run:  node --test tests/openrouter-no-tools-prompt.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SHARED = readFileSync(join(ROOT, 'modes/_shared.md'), 'utf-8');
const OFERTA = readFileSync(join(ROOT, 'modes/oferta.md'), 'utf-8');
const CTX = { shared: SHARED, profileMode: '# Profile', profile: 'candidate:\n  full_name: Test', cv: '# Test Candidate' };

// Each is in the mode files today and must not reach the runner's prompt.
const TOOL_INSTRUCTIONS = {
  'the liveness gate': '## Liveness gate (URL inputs)',
  'Playwright navigation': 'browser_navigate',
  'the Tools table': '| Tool | Use |',
  'the Bash row': '| Bash |',
  'the WebFetch row': '| WebFetch |',
  'reading cv.md': 'Read them from cv.md',
  'the dead-posting marker': '---DEAD_POSTING---',
};

/** Import a fresh copy of the runner against a throwaway data root. */
async function loadRunner(dataRoot, label) {
  const names = ['CAREER_OPS_ROOT', 'CAREER_OPS_DATA_DIR', 'CAREER_OPS_MODEL', 'OPENROUTER_API_KEY'];
  const previous = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  process.env.CAREER_OPS_ROOT = dataRoot;
  delete process.env.CAREER_OPS_DATA_DIR;
  delete process.env.CAREER_OPS_MODEL;
  try {
    return await import(`${pathToFileURL(join(ROOT, 'openrouter-runner.mjs')).href}?no-tools=${label}`);
  } finally {
    for (const n of names) {
      if (previous[n] === undefined) delete process.env[n];
      else process.env[n] = previous[n];
    }
  }
}

async function withRunner(label, body) {
  const dataRoot = mkdtempSync(join(tmpdir(), 'career-ops-no-tools-'));
  try {
    await body(await loadRunner(dataRoot, label));
  } finally {
    rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

test('the mode files still carry the tool instructions (so the next test means something)', () => {
  const modes = SHARED + OFERTA;
  for (const [name, text] of Object.entries(TOOL_INSTRUCTIONS)) assert.ok(modes.includes(text), `modes/ no longer has ${name}`);
});

test('the system prompt drops the tool instructions and says there are no tools first', async () => {
  await withRunner('prompt', async (runner) => {
    const prompt = runner.buildSystemPrompt(OFERTA, CTX);
    for (const [name, text] of Object.entries(TOOL_INSTRUCTIONS)) assert.ok(!prompt.includes(text), `the prompt still has ${name}`);
    assert.match(prompt, /needs_confirmation/, 'other mode text was dropped with the tool sections');
    assert.match(prompt, /## Block A — Role Summary/, 'oferta.md lost the section after the liveness gate');
    assert.match(prompt, /### Subagent delegation/, '_shared.md lost the section after the Tools table');
    const note = prompt.indexOf('you have no tools');
    assert.notEqual(note, -1, 'the system prompt has no no-tools note');
    assert.ok(note < prompt.indexOf('# System Context -- career-ops'), 'the no-tools note comes after modes/_shared.md');
    assert.match(prompt, /\*\*RULE: NEVER hardcode metrics from proof points\.\*\* Take them from the CV below\./);
  });
});

test('a section runs to the next heading of its level, and a missing heading changes nothing', async () => {
  await withRunner('strip', async (runner) => {
    const text = '# Top\n\n### Tools\n\n| Bash | x |\n\n#### Sub\n\nstill tools\n\n### Next\n\nkept';
    assert.equal(runner.stripToolInstructions(text), '# Top\n\n### Next\n\nkept');
    const other = '# Top\n\n### Tooling\n\n| Bash | x |';
    assert.equal(runner.stripToolInstructions(other), other);
  });
});

test('the request body carries no tools, pinned and rotated', async () => {
  for (const pinned of ['vendor/pinned-model:free', null]) {
    await withRunner(pinned ? 'pinned' : 'rotated', async (runner) => {
      const bodies = [];
      const realFetch = globalThis.fetch;
      const env = { model: process.env.CAREER_OPS_MODEL, key: process.env.OPENROUTER_API_KEY };
      globalThis.fetch = async (url, init) => {
        if (String(url).endsWith('/models')) {
          return { ok: true, status: 200, json: async () => ({ data: [{ id: 'vendor/free-model:free', pricing: { prompt: '0', completion: '0' } }] }) };
        }
        bodies.push(JSON.parse(init.body));
        return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'Score: 4/5' } }], usage: {} }) };
      };
      if (pinned) process.env.CAREER_OPS_MODEL = pinned;
      else delete process.env.CAREER_OPS_MODEL;
      process.env.OPENROUTER_API_KEY = 'test-key';
      try {
        await runner.callOpenRouter(runner.buildSystemPrompt(OFERTA, CTX), 'Evaluate this job listing:\n\nJD');
      } finally {
        globalThis.fetch = realFetch;
        for (const [n, v] of [['CAREER_OPS_MODEL', env.model], ['OPENROUTER_API_KEY', env.key]]) {
          if (v === undefined) delete process.env[n];
          else process.env[n] = v;
        }
      }
      assert.equal(bodies.length, 1, 'expected one model request');
      assert.equal('tools' in bodies[0], false, 'the request body has a tools field');
      const system = JSON.stringify(bodies[0].messages[0]);
      assert.match(system, /you have no tools/);
      assert.equal(system.includes('browser_navigate'), false, 'the sent system message still tells the model to navigate');
    });
  }
});
