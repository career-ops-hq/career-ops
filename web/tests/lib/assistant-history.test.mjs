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
  assert.throws(() => cleanMessages(Array.from({ length: 2001 }, () => ({ role: 'user', content: 'text' }))));
});

test('status confirmation history is inert and never upgrades failed or in-flight writes to done', () => {
  for (const state of ['saving', 'failed', 'unconfirmed', 'done']) {
    const clean = cleanMessages([{ role: 'assistant', parts: [{ type: 'confirm', cid: 'c1', summary: 'Mark #11 → Rejected?', statusChange: { n: '11', status: 'Rejected' }, state, message: state === 'failed' ? 'Tracker busy.  ' : undefined }] }]);
    assert.equal(clean[0].parts[0].type, 'note');
    const text = clean[0].parts[0].text;
    assert.match(text, /Mark #11 → Rejected/);
    assert.match(text, state === 'done' ? /\(saved\)/ : state === 'failed' ? /failed: Tracker busy/ : /unconfirmed/);
    assert.doesNotMatch(text, /\(done\)/);
    assert.match(text, /application #11 → Rejected/);
    if (state === 'failed') assert.match(text, /failed: Tracker busy; check current tracker status before a new request/);
    assert.deepEqual(cleanMessages(clean), clean, 'repeated cleaning cannot revive controls');
  }
});

test('a failed profile or scan-target confirmation is saved as an inert failed note', () => {
  const clean = cleanMessages([{ role: 'assistant', parts: [{ type: 'confirm', cid: 'c2', summary: 'Save your profile?', state: 'failed', message: 'Your profile was NOT saved: write failed.' }] }]);
  assert.deepEqual(clean[0].parts, [{ type: 'note', text: 'Save your profile? (failed: Your profile was NOT saved: write failed)' }]);
  assert.deepEqual(cleanMessages(clean), clean);
});

test('a profile or scan-target confirmation still saving is saved as unconfirmed, never done', () => {
  const clean = cleanMessages([{ role: 'assistant', parts: [{ type: 'confirm', cid: 'c3', summary: 'Set your scan targets to: Engineer?', state: 'saving' }] }]);
  assert.deepEqual(clean[0].parts, [{ type: 'note', text: 'Set your scan targets to: Engineer? (unconfirmed: the write had not finished)' }]);
  assert.doesNotMatch(clean[0].parts[0].text, /\(done\)/);
});
