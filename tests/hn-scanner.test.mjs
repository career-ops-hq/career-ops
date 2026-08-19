import test from 'node:test';
import assert from 'node:assert';
import { extractWithAI } from '../scan-hn.mjs';

/**
 * This test verifies that our Gemini AI extraction logic can 
 * correctly turn raw Hacker News text into a structured YAML object.
 */

test('Hacker News AI Extraction Logic', async (t) => {

  await t.test('should extract valid data from a standard HN post', async () => {
    // We simulate a real HN comment
    const mockHnPost = `
      Stripe (Remote) | Senior Backend Engineer | $150k-$200k
      We are looking for someone to help us build the future of payments.
      Apply at https://stripe.com/jobs
    `;

    const result = await extractWithAI(mockHnPost);

    // Verify the AI returned the right keys
    assert.strictEqual(typeof result.company, 'string', 'Should extract company name');
    assert.ok(result.company.toLowerCase().includes('stripe'), 'Company should be Stripe');
    assert.strictEqual(typeof result.title, 'string', 'Should extract job title');
  });

  await t.test('should return null for non-job related text', async () => {
    const randomText = "I think the new Python update is really interesting, what do you guys think?";
    
    const result = await extractWithAI(randomText);

    // AI should return null for text that isn't a job
    assert.strictEqual(result, null, 'Should return null for non-job text');
  });
});