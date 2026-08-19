import test from 'node:test';
import assert from 'node:assert';
import { extractWithAI } from '../scan-hn.mjs';

test('Hacker News AI Extraction Logic', async (t) => {

  const mockModel = {
    generateContent: async (prompt) => {
      // 1. Success case
      if (prompt.includes('Stripe')) {
        return { response: { text: () => 'company: Stripe\ntitle: Engineer\nlocation: Remote' } };
      }
      // 2. Missing keys case
      if (prompt.includes('MISSING_KEYS')) {
        return { response: { text: () => 'location: Remote' } };
      }
      // 3. Malformed YAML case (will throw in yaml.load)
      if (prompt.includes('MALFORMED')) {
        return { response: { text: () => 'company: { [ malformed : yaml }' } };
      }
      // 4. Null case (yaml.load('null') returns the value null)
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
    assert.strictEqual(res, null, 'Should return null on YAML parse error');
  });

  await t.test('should return null for non-job related text (null sentinel)', async () => {
    const res = await extractWithAI('Random text', mockModel);
    assert.strictEqual(res, null, 'Should return null when AI returns null string');
  });

  await t.test('should handle objects missing required keys gracefully', async () => {
    const res = await extractWithAI('MISSING_KEYS', mockModel);
    // Because your code uses (typeof parsed.company === 'string' ? ... : ''),
    // a missing key becomes an empty string.
    assert.strictEqual(res.company, '', 'Company should be an empty string if missing');
    assert.strictEqual(res.title, '', 'Title should be an empty string if missing');
    assert.strictEqual(res.location, 'Remote');
  });
}); // <--- All tests must be inside this closing bracket