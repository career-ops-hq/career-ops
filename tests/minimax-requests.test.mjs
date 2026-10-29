// Exercise the CLI and runner at fetch(), with no live inference or credentials.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, pass, fail } from './helpers.mjs';

const work = mkdtempSync(join(tmpdir(), 'career-ops-minimax-'));
const hook = join(work, 'fetch.mjs');
const capture = join(work, 'request.json');
writeFileSync(hook, `
import { writeFileSync } from 'node:fs';
globalThis.fetch = async (url, init) => {
  writeFileSync(process.env.REQUEST_CAPTURE, JSON.stringify({ url, body: JSON.parse(init.body) }));
  return new Response('data: {"choices":[{"delta":{"content":"Fixture evaluation"}}]}\\n\\ndata: [DONE]\\n\\n');
};
`);

function check(label, body) {
  try { body(); pass(label); } catch (error) { fail(`${label}: ${error.message}`); }
}

try {
  const cases = [
    ['international default', { OPENAI_BASE_URL: 'https://api.minimax.io/v1' }, [], 'MiniMax-M3.1-Flash'],
    ['regional CLI default', {}, ['--url', 'https://api.minimax.cn/v1/'], 'MiniMax-M3.1-Flash'],
    ['explicit M3', {}, ['--url', 'https://api.minimax.io/v1', '--model', 'MiniMax-M3'], 'MiniMax-M3'],
    ['saved legacy model', { OPENAI_BASE_URL: 'https://api.minimax.cn/v1', OPENAI_MODEL: 'MiniMax-M2.7' }, [], 'MiniMax-M2.7'],
    ['CLI overrides saved model', { OPENAI_MODEL: 'MiniMax-M2.7' }, ['--model', 'custom-model', '--url', 'https://api.minimax.io/v1'], 'custom-model'],
    ['generic default', {}, [], 'gpt-4o-mini'],
    ['lookalike host', {}, ['--url', 'https://api.minimax.io.example.test/v1'], 'gpt-4o-mini'],
    ['subscription route unchanged', {}, ['--url', 'https://api.minimax.io/coding-plan/v1'], 'gpt-4o-mini'],
    ['gateway explicit route', {}, ['--url', 'https://openrouter.ai/api/v1', '--model', 'minimax/minimax-m3.1-flash:free'], 'minimax/minimax-m3.1-flash:free'],
  ];
  for (const [label, settings, args, model] of cases) {
    check(`MiniMax request: ${label}`, () => {
      const result = spawnSync(process.execPath, [
        '--import', pathToFileURL(hook).href, join(ROOT, 'openai-eval.mjs'),
        '--no-save', ...args, 'Fictional job description',
      ], {
        cwd: work, encoding: 'utf8', timeout: 15000,
        env: {
          PATH: process.env.PATH, HOME: work, CAREER_OPS_ROOT: work,
          OPENAI_API_KEY: 'fixture-key', REQUEST_CAPTURE: capture, ...settings,
        },
      });
      assert.equal(result.status, 0, result.stderr);
      const request = JSON.parse(readFileSync(capture, 'utf8'));
      const urlIndex = args.indexOf('--url');
      const base = urlIndex >= 0 ? args[urlIndex + 1] : settings.OPENAI_BASE_URL || 'https://api.openai.com/v1';
      assert.equal(request.url, `${base.replace(/\/$/, '')}/chat/completions`);
      assert.equal(request.body.model, model);
      assert.equal(request.body.stream, true);
      assert.equal(request.body.messages[1].content, 'JOB DESCRIPTION TO EVALUATE:\n\nFictional job description');
      assert.deepEqual(Object.keys(request.body).sort(), ['messages', 'model', 'stream', 'temperature']);
      // Omission leaves Flash's adaptive thinking/default effort to the API;
      // never inject disabled thinking, none effort, or unsupported service tiers.
      if (model === 'MiniMax-M3.1-Flash' || model === 'MiniMax-M3') {
        assert.match(result.stdout, /within 991808 limit/);
        assert.equal(request.body.messages[0].content[0].type, 'text');
        assert.deepEqual(request.body.messages[0].content[0].cache_control, { type: 'ephemeral' });
      }
    });
  }

  const names = ['CAREER_OPS_ROOT', 'CAREER_OPS_MODEL', 'OPENROUTER_API_KEY'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  try {
    process.env.CAREER_OPS_ROOT = work;
    process.env.OPENROUTER_API_KEY = 'fixture-key';
    delete process.env.CAREER_OPS_MODEL;
    const requests = [];
    const flash = 'minimax/minimax-m3.1-flash:free';
    const m3 = 'minimax/minimax-m3';
    const legacy = 'minimax/minimax-m2.7:free';
    let catalog = [legacy, m3, flash];
    let paidM3 = false;
    globalThis.fetch = async (url, init) => {
      if (String(url).endsWith('/models')) return Response.json({
        data: catalog.map(id => ({ id, pricing: { prompt: paidM3 && id === m3 ? '0.0000003' : '0', completion: '0' } })),
      });
      requests.push(JSON.parse(init.body));
      return Response.json({ choices: [{ message: { content: 'Fixture answer' } }] });
    };
    const load = suffix => import(`${pathToFileURL(join(ROOT, 'openrouter-runner.mjs')).href}?minimax=${suffix}`);
    const runner = await load('rotation');
    await runner.callOpenRouter('System fixture', 'User fixture');
    check('MiniMax gateway prefers Flash over M3 in free rotation', () => {
      assert.equal(requests.at(-1).model, flash);
      assert.equal(requests.at(-1).max_tokens, 8192);
      assert.equal(requests.at(-1).messages[0].content[0].text, 'System fixture');
    });
    runner.blacklistedModels.add(flash);
    await runner.callOpenRouter('System fixture', 'User fixture');
    check('MiniMax gateway retains M3 when advertised as free', () => assert.equal(requests.at(-1).model, m3));
    await runner.callOpenRouter('System fixture', 'User fixture');
    check('MiniMax gateway retains non-listed free models', () => assert.equal(requests.at(-1).model, legacy));

    paidM3 = true;
    catalog.push('unrelated/model:free');
    const paid = await load('paid');
    paid.blacklistedModels.add(flash);
    await paid.callOpenRouter('System fixture', 'User fixture');
    check('MiniMax gateway excludes paid M3 but retains free legacy models', () => {
      assert.equal(requests.at(-1).model, legacy);
    });
    paid.blacklistedModels.add(legacy);
    await paid.callOpenRouter('System fixture', 'User fixture');
    check('MiniMax gateway falls through to other providers after MiniMax options are unavailable', () => {
      assert.equal(requests.at(-1).model, 'unrelated/model:free');
    });
    for (const id of ['minimax/minimax-m2.7:free', m3, 'custom/private-model']) {
      process.env.CAREER_OPS_MODEL = id;
      await paid.callOpenRouter('System fixture', [{ type: 'text', text: 'User fixture' }, { type: 'image_url', image_url: { url: 'https://example.test/image.png' } }]);
      check(`MiniMax gateway preserves explicit ${id} and message parts`, () => {
        assert.equal(requests.at(-1).model, id);
        assert.equal(requests.at(-1).messages[1].content[1].image_url.url, 'https://example.test/image.png');
        assert.deepEqual(Object.keys(requests.at(-1)).sort(), ['max_tokens', 'messages', 'model']);
      });
    }
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
} catch (error) {
  fail(`MiniMax boundary tests: ${error.message}`);
} finally {
  rmSync(work, { recursive: true, force: true, maxRetries: 10 });
}
