import test from 'node:test';
import assert from 'node:assert';
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

  await t.test('should handle objects missing required keys gracefully', async () => {
    const res = await extractWithAI('MISSING_KEYS', mockModel);
    assert.strictEqual(res.company, '');
    assert.strictEqual(res.title, '');
    assert.strictEqual(res.location, 'Remote/Unknown');
  });
});