import test from 'node:test';
import assert from 'node:assert';
import { extractWithAI } from '../scan-hn.mjs';

/**
 * This test verifies that our Gemini AI extraction logic can 
 * correctly turn raw Hacker News text into a structured YAML object.
 */

test('Hacker News AI Extraction Logic', async (t) => {

  // Mock Gemini model for deterministic testing without live API keys
  const mockModel = {
    generateContent: async (prompt) => {
      if (prompt.includes('Stripe')) {
        return {
          response: {
            text: () => 'company: Stripe\ntitle: Senior Backend Engineer\nlocation: Remote'
          }
        };
      }
      return {
        response: {
          text: () => 'null'
        }
      };
    }
  };

  await t.test('should extract valid data from a standard HN post', async () => {
    const mockHnPost = `
      Stripe (Remote) | Senior Backend Engineer | $150k-$200k
      We are looking for someone to help us build the future of payments.
      Apply at https://stripe.com/jobs
    `;

    const result = await extractWithAI(mockHnPost, mockModel);

    assert.ok(result, 'Result should not be null');
    assert.strictEqual(result.company, 'Stripe');
    assert.strictEqual(result.title, 'Senior Backend Engineer');
    assert.strictEqual(result.location, 'Remote');
  });

  await t.test('should return null for non-job related text', async () => {
    const randomText = "I think the new Python update is really interesting, what do you guys think?";
    
    const result = await extractWithAI(randomText, mockModel);

    assert.strictEqual(result, null);
  });
});