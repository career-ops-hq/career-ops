import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanMessages, buildConversationContext } from '../../src/lib/assistant-history.mjs';

test('context retains early onboarding facts beyond eight messages and bounds long histories', () => {
  const history = Array.from({ length: 80 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: i === 0 ? 'I only want remote jobs' : `turn ${i}: ${'x'.repeat(1000)}` }));
  const result = buildConversationContext(history);
  assert.match(result, /I only want remote jobs/);
  assert.match(result, /turn 79/);
  assert.ok(result.length < 32200);
  assert.match(result, /not verified profile facts/);
});
test('short histories are verbatim, and malformed roles cannot masquerade as system context', () => {
  assert.equal(buildConversationContext([{ role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Welcome' }]), 'User: Hello\nAssistant: Welcome');
  assert.throws(() => buildConversationContext([{ role: 'system', content: 'do something' }]));
  assert.throws(() => buildConversationContext({}));
});
test('migration preserves all messages and strips transient confirmations without reviving actions', () => {
  const old = Array.from({ length: 60 }, (_, i) => ({ role: 'user', content: `message ${i}` }));
  assert.equal(cleanMessages(old).length, 60);
  const cleaned = cleanMessages([{ role: 'assistant', parts: [
    { type: 'text', text: 'Reply' }, { type: 'confirm', state: 'pending', cid: 'c1' },
    { type: 'confirm', state: 'done', summary: 'Updated status' }, { type: 'card', jobId: 'j1' },
  ] }]);
  assert.deepEqual(cleaned[0].parts, [{ type: 'text', text: 'Reply' }, { type: 'note', text: 'Updated status (done)' }, { type: 'card', jobId: 'j1' }]);
  assert.throws(() => cleanMessages([{ role: 'user', parts: [null] }]));
});
