import test from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { config } from 'dotenv';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as yaml from 'js-yaml';

config();

function isLiveGeminiCheckEnabled(env = process.env) {
  return env.CAREER_OPS_LIVE_GEMINI === '1' && Boolean(env.GEMINI_API_KEY?.trim());
}

test('Gemini live smoke check requires explicit opt-in and an API key', () => {
  assert.equal(isLiveGeminiCheckEnabled({ GEMINI_API_KEY: 'configured-key' }), false);
  assert.equal(isLiveGeminiCheckEnabled({ CAREER_OPS_LIVE_GEMINI: '1', GEMINI_API_KEY: '   ' }), false);
  assert.equal(isLiveGeminiCheckEnabled({ CAREER_OPS_LIVE_GEMINI: '1' }), false);
  assert.equal(isLiveGeminiCheckEnabled({ CAREER_OPS_LIVE_GEMINI: 'true', GEMINI_API_KEY: 'configured-key' }), false);
  assert.equal(isLiveGeminiCheckEnabled({ CAREER_OPS_LIVE_GEMINI: '1', GEMINI_API_KEY: 'configured-key' }), true);
});

if (process.env.CAREER_OPS_GEMINI_GATE_CHILD !== '1') {
  test('a Gemini key loaded from .env does not trigger a live request without opt-in', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'career-ops-gemini-gate-'));
    const fetchMarker = join(tempDir, 'fetch-called');
    const preloadPath = join(tempDir, 'block-network.mjs');

    try {
      writeFileSync(join(tempDir, '.env'), 'GEMINI_API_KEY=synthetic-test-key\n');
      writeFileSync(preloadPath, `
        import { writeFileSync } from 'node:fs';
        globalThis.fetch = (...args) => {
          writeFileSync(process.env.CAREER_OPS_GEMINI_FETCH_MARKER, String(args[0]));
          throw new Error('Unexpected network request in Gemini opt-in regression test');
        };
      `);

      const env = { ...process.env, CAREER_OPS_GEMINI_GATE_CHILD: '1', CAREER_OPS_GEMINI_FETCH_MARKER: fetchMarker };
      delete env.GEMINI_API_KEY;
      delete env.CAREER_OPS_LIVE_GEMINI;
      delete env.NODE_TEST_CONTEXT;

      const result = spawnSync(process.execPath, ['--import', preloadPath, '--test', '--test-reporter=tap', fileURLToPath(import.meta.url)], {
        cwd: tempDir,
        encoding: 'utf8',
        env,
        timeout: 10_000,
      });

      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, /Gemini AI Integration Smoke Test.*SKIP/s);
      assert.equal(existsSync(fetchMarker), false, 'the Gemini client must not make a request without explicit opt-in');
    } finally {
      rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
}

// Run a live API check only when explicitly requested with CAREER_OPS_LIVE_GEMINI=1.
test('Gemini AI Integration Smoke Test', { skip: !isLiveGeminiCheckEnabled() }, async () => {
  const apiKey = process.env.GEMINI_API_KEY;
  const modelName = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
  
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: modelName,
  });

  const sampleText = "Hiring at Stripe for an Engineer in Dublin.";
  const prompt = `--- BEGIN UNTRUSTED DATA ---\n${sampleText}\n--- END UNTRUSTED DATA ---`;

  const result = await model.generateContent(prompt);
  const response = result.response.text();
  const clean = response.replace(/```yaml|```/g, '').trim();
  const parsed = yaml.load(clean);

  assert.ok(parsed, 'Should return a valid YAML object');
});
