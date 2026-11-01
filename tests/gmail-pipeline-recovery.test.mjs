import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import gmail from '../plugins/gmail/index.mjs';
import { admitPluginJobs } from '../plugins.mjs';
import { appendToPipeline } from '../scan.mjs';

let root;
const originalCwd = process.cwd();
const originalPipeline = process.env.CAREER_OPS_PIPELINE;
const url = 'https://example.test/jobs/engineer?job_id=123';
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'gmail-recovery-'));
  mkdirSync(join(root, 'data'));
  process.chdir(root);
  delete process.env.CAREER_OPS_PIPELINE;
});
afterEach(() => {
  process.chdir(originalCwd);
  if (originalPipeline === undefined) delete process.env.CAREER_OPS_PIPELINE;
  else process.env.CAREER_OPS_PIPELINE = originalPipeline;
  rmSync(root, { recursive: true, force: true });
});

function mailbox(urls = [url], options = {}) {
  let details = 0;
  return {
    get details() { return details; },
    ctx: {
      dataRoot: root, dryRun: false, settings: {}, log() {}, ...options,
      env: { GMAIL_CLIENT_ID: 'fixture', GMAIL_CLIENT_SECRET: 'fixture', GMAIL_REFRESH_TOKEN: 'fixture' },
      fetch: async (request) => {
        if (request.includes('oauth2')) return { ok: true, json: async () => ({ access_token: 'fixture' }) };
        if (request.includes('messages?')) return { ok: true, json: async () => ({ messages: [{ id: 'message-1' }] }) };
        details++;
        return { ok: true, json: async () => ({ payload: {
          mimeType: 'text/plain',
          headers: [
            { name: 'Subject', value: 'Engineer at Example' },
            { name: 'Authentication-Results', value: 'mx.google.com; dmarc=pass header.from=example.test' },
          ],
          body: { data: Buffer.from(urls.join('\n')).toString('base64url') },
        } }) };
      },
    },
  };
}
const cursor = () => JSON.parse(readFileSync(join(root, 'data/gmail-state.json'), 'utf8')).processed_message_ids;
const pipeline = () => process.env.CAREER_OPS_PIPELINE || join(root, 'data/pipeline.md');

test('a failed canonical pipeline append remains retryable, then acknowledges the recovered lead', async () => {
  const box = mailbox();
  mkdirSync(pipeline());
  const first = await gmail.ingest(box.ctx);
  assert.equal(first.length, 1);
  await assert.rejects(appendToPipeline(first, { pipelinePath: pipeline() }));
  const retry = await gmail.ingest(box.ctx);
  assert.equal(retry.length, 1, 'the failed handoff must not consume the message');
  assert.deepEqual(cursor(), []);
  rmSync(pipeline(), { recursive: true });
  await appendToPipeline(retry, { pipelinePath: pipeline() });
  assert.deepEqual(await gmail.ingest(box.ctx), []);
  assert.deepEqual(cursor(), ['message-1']);
  await gmail.ingest(box.ctx);
  assert.equal(box.details, 3, 'a durable message stops fetching details');
});

test('a message with a partially queued set of leads remains retryable', async () => {
  const other = 'https://example.test/jobs/designer';
  const box = mailbox([url, other]);
  writeFileSync(pipeline(), `- [ ] ${url} | Example | Engineer\n`);
  assert.deepEqual((await gmail.ingest(box.ctx)).map(j => j.url), [other]);
  assert.deepEqual(cursor(), []);
  await appendToPipeline([{ url: other, title: 'Designer', company: 'Example' }], { pipelinePath: pipeline() });
  assert.deepEqual(await gmail.ingest(box.ctx), []);
  assert.deepEqual(cursor(), ['message-1']);
});

for (const entry of [
  `- [ ] ${url} | Example | Engineer`,
  `- [x] #123 | ${url} | Example | Engineer`,
  `- [x] [123](../reports/123.md) | ${url} | Example | Engineer`,
  `- [x] ~~${url} | Example | Engineer~~`,
]) test(`acknowledges an existing durable entry: ${entry}`, async () => {
  writeFileSync(pipeline(), entry + '\n');
  assert.deepEqual(await gmail.ingest(mailbox().ctx), []);
  assert.deepEqual(cursor(), ['message-1']);
});

test('an unrelated posting query does not acknowledge the missing lead', async () => {
  writeFileSync(pipeline(), `- [ ] ${url.replace('123', '456')} | Example | Engineer\n`);
  assert.equal((await gmail.ingest(mailbox().ctx)).length, 1);
  assert.deepEqual(cursor(), []);
});

test('a URL in prose alone is not a durable pipeline entry', async () => {
  writeFileSync(pipeline(), `# Pending\nSee ${url}\n`);
  assert.equal((await gmail.ingest(mailbox().ctx)).length, 1);
  assert.deepEqual(cursor(), []);
});

test('uses the data root and pipeline override rather than an unrelated cwd', async () => {
  const otherRoot = join(root, 'elsewhere');
  mkdirSync(otherRoot);
  process.chdir(otherRoot);
  process.env.CAREER_OPS_PIPELINE = join(root, 'custom-pipeline.md');
  writeFileSync(pipeline(), `- [ ] ${url} | Example | Engineer\n`);
  assert.deepEqual(await gmail.ingest(mailbox().ctx), []);
  assert.deepEqual(cursor(), ['message-1']);
});

test('dry run leaves an existing cursor byte-identical when the lead is durable', async () => {
  const state = join(root, 'data/gmail-state.json');
  const original = '{"processed_message_ids":["old"]}\n';
  writeFileSync(state, original);
  writeFileSync(pipeline(), `- [ ] ${url} | Example | Engineer\n`);
  await gmail.ingest(mailbox([url], { dryRun: true }).ctx);
  assert.equal(readFileSync(state, 'utf8'), original);
});


test('tracking parameters acknowledge the same posting without losing functional identity', async () => {
  writeFileSync(pipeline(), `- [ ] ${url}&utm_source=alert | Example | Engineer\n`);
  assert.deepEqual(await gmail.ingest(mailbox().ctx), []);
  assert.deepEqual(cursor(), ['message-1']);
});

test('the data-root pipeline is used even when cwd has a different one', async () => {
  const otherRoot = join(root, 'elsewhere');
  mkdirSync(join(otherRoot, 'data'), { recursive: true });
  writeFileSync(join(otherRoot, 'data/pipeline.md'), `- [ ] ${url} | Example | Engineer\n`);
  process.chdir(otherRoot);
  assert.equal((await gmail.ingest(mailbox().ctx)).length, 1);
  assert.deepEqual(cursor(), []);
});

for (const reason of ['seen', 'blacklisted', 'title', 'location']) {
  test(`acknowledges a message intentionally rejected by the CLI gate: ${reason}`, async () => {
    const gateOptions = {
      seen: new Set(reason === 'seen' ? [url] : []),
      blacklist: reason === 'blacklisted' ? new Map([['example', { company: 'Example' }]]) : new Map(),
      titleFilter: () => reason !== 'title',
      locationFilter: () => reason !== 'location',
    };
    const box = mailbox([url], { admitJobs: jobs => admitPluginJobs(jobs, {
      id: 'gmail', jobPostings: true, gateOptions: { ...gateOptions, seen: new Set(gateOptions.seen) },
    }).jobs });
    assert.deepEqual(await gmail.ingest(box.ctx), []);
    assert.deepEqual(cursor(), ['message-1']);
    await gmail.ingest(box.ctx);
    assert.equal(box.details, 1);
  });
}

test('a rejected URL does not hide an admitted URL whose pipeline write failed', async () => {
  const rejected = 'https://example.test/jobs/rejected';
  const box = mailbox([url, rejected], { admitJobs: jobs => jobs.filter(j => j.url !== rejected) });
  mkdirSync(pipeline());
  const jobs = await gmail.ingest(box.ctx);
  assert.deepEqual(jobs.map(j => j.url), [url]);
  await assert.rejects(appendToPipeline(jobs, { pipelinePath: pipeline() }));
  assert.deepEqual(cursor(), []);
  assert.deepEqual((await gmail.ingest(box.ctx)).map(j => j.url), [url]);
  rmSync(pipeline(), { recursive: true });
  await appendToPipeline(jobs, { pipelinePath: pipeline() });
  assert.deepEqual(await gmail.ingest(box.ctx), []);
  assert.deepEqual(cursor(), ['message-1']);
});
