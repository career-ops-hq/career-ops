import test from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractWithAI } from '../scan-hn.mjs';

test('Hacker News AI Extraction Logic', async (t) => {
  const mockModel = {
    generateContent: async (prompt) => {
      if (prompt.includes('Stripe')) {
        return { response: { text: () => 'company: Stripe\ntitle: Engineer\nlocation: Remote' } };
      }
      if (prompt.includes('MISSING_KEYS')) {
        return { response: { text: () => 'company: null' } }; 
      }
      if (prompt.includes('MALFORMED')) {
        return { response: { text: () => 'company: { [ malformed : yaml }' } };
      }
      return { response: { text: () => 'null' } };
    }
  };

  await t.test('should extract valid data from a standard HN post', async () => {
    const res = await extractWithAI('Stripe post', mockModel);
    assert.strictEqual(res.company, 'Stripe');
    assert.strictEqual(res.title, 'Engineer');
  });

  await t.test('should return null for malformed YAML output', async () => {
    const res = await extractWithAI('MALFORMED data', mockModel);
    assert.strictEqual(res, null);
  });

  await t.test('should return null for non-job related text', async () => {
    const res = await extractWithAI('Random text', mockModel);
    assert.strictEqual(res, null);
  });

  await t.test('should let a failed API call reach the caller instead of returning null', async () => {
    // An invalid key, exhausted quota or retired model makes generateContent
    // throw. Returning null for that is indistinguishable from "no match".
    const failingModel = {
      generateContent: async () => { throw new Error('[404 Not Found] models/gemini-1.5-flash is not found'); },
    };
    await assert.rejects(() => extractWithAI('Stripe post', failingModel), /404 Not Found/);
  });

  await t.test('should handle objects missing required keys gracefully', async () => {
    const res = await extractWithAI('MISSING_KEYS', mockModel);
    assert.strictEqual(res.company, '');
    assert.strictEqual(res.title, '');
    assert.strictEqual(res.location, 'Remote/Unknown');
  });
});

// The test above proves extractWithAI rethrows. This one runs the real scanner,
// so a regression in the caller (the summary line or the exit code) fails here
// too. Every Gemini call fails the way an invalid key does; HN is served from a
// fixture, and any other request is refused.
test('scan-hn reports AI errors and exits non-zero when every Gemini call fails', () => {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-scanhn-'));
  try {
    mkdirSync(join(dir, 'data'), { recursive: true });
    const unexpected = join(dir, 'unexpected-requests');
    const preload = join(dir, 'fetch-fixture.cjs');
    writeFileSync(preload, `
      const { appendFileSync } = require('node:fs');
      const json = (body, status = 200) => new Response(JSON.stringify(body), {
        status, headers: { 'content-type': 'application/json' },
      });
      globalThis.fetch = async (input) => {
        const url = String(input?.url ?? input);
        if (url.includes('hn.algolia.com/api/v1/search_by_date')) {
          return json({ hits: [{ objectID: '424242', title: 'Ask HN: Who is hiring? (September 2026)' }] });
        }
        if (url.includes('hn.algolia.com/api/v1/items/424242')) {
          return json({ children: [
            { text: 'Stripe | Software Engineer | Remote | https://stripe.com/jobs/1' },
            { text: 'Acme | Software Engineer | Berlin | https://acme.example/jobs/2' },
          ] });
        }
        if (url.includes('generativelanguage.googleapis.com')) {
          return json({ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } }, 400);
        }
        appendFileSync(${JSON.stringify(unexpected)}, url + '\\n');
        throw new Error('network forbidden in test: ' + url);
      };
    `);

    const env = { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: '', GEMINI_API_KEY: 'invalid-test-key' };
    delete env.CAREER_OPS_PORTALS;
    delete env.GEMINI_MODEL;
    const r = spawnSync(process.execPath, [
      '--require', preload,
      fileURLToPath(new URL('../scan-hn.mjs', import.meta.url)),
    ], { cwd: dir, encoding: 'utf8', timeout: 30000, env });

    assert.equal(r.error, undefined, `scan-hn failed to spawn: ${r.error?.message}`);
    assert.equal(existsSync(unexpected), false, 'scan-hn made a request outside the fixture');
    assert.match(r.stdout, /Postings fetched:\s+2/);
    assert.match(r.stdout, /New offers:\s+0/);
    assert.match(r.stdout, /AI errors:\s+2 of 2/, `summary line missing:\n${r.stdout}`);
    assert.match(r.stderr, /2 of 2 Gemini extractions failed/);
    assert.match(r.stderr, /API key not valid/);
    assert.equal(r.status, 1, `expected exit 1 when every Gemini call fails, got ${r.status}\n${r.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
