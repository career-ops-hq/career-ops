// tests/apify-jds-data-root.test.mjs — the bundled apify plugin saves a JD
// capture under the data root, not the working directory.
//
// With `field_map.description` set, the provider writes each posting's text to
// `jds/{slug}-{hash}.md` and returns `local:jds/…` as the job URL. That
// reference is read back against the data root (check-jd-archive.mjs,
// outcome.mjs), but the file was written to `jds/` under process.cwd(): with
// the user layer outside the checkout, a scan run from the checkout left the
// capture beside the code and a pipeline row pointing at a file the data root
// does not have. It now resolves against ctx.dataRoot.
//
// The Apify API is replaced by a stub on globalThis.fetch (the plugin's client
// deliberately keeps its own fetch), and the data root and working directory
// are separate directories under the OS temp dir.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from './helpers.mjs';
import apify from '../plugins/apify/index.mjs';

const DESCRIPTION = 'Build and run the data platform. '.repeat(4);
const ITEMS = [{ title: 'Data Engineer', url: 'https://jobs.example.test/1', company: 'Acme', description: DESCRIPTION }];
const ENTRY = {
  name: 'fixture',
  actor: 'owner/actor',
  field_map: { title: 'title', url: 'url', company: 'company', description: 'description' },
};

let base, dataRoot, workDir;
const startCwd = process.cwd();
const realFetch = globalThis.fetch;

const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  // realpath: see tests/gmail-state-data-root.test.mjs.
  base = realpathSync(mkdtempSync(join(tmpdir(), 'apify-jds-')));
  dataRoot = join(base, 'data-root');
  workDir = join(base, 'cwd');
  for (const dir of [dataRoot, workDir]) mkdirSync(dir, { recursive: true });
  process.chdir(workDir);
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.endsWith('/acts/owner~actor/runs')) return json({ data: { id: 'run-1' } });
    if (u.endsWith('/actor-runs/run-1')) return json({ data: { status: 'SUCCEEDED' } });
    if (u.endsWith('/actor-runs/run-1/dataset/items')) return json(ITEMS);
    throw new Error(`unexpected request in test: ${u}`);
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
  process.chdir(startCwd);
  rmSync(base, { recursive: true, force: true });
});

const ctxFor = (root) => ({ env: { APIFY_TOKEN: 'test-token' }, ...(root ? { dataRoot: root } : {}) });

test('the capture is written to jds/ under the data root, not the working directory', async () => {
  const [job] = await apify.provider.fetch(ENTRY, ctxFor(dataRoot));

  assert.match(job.url, /^local:jds\/acme-data-engineer-[0-9a-f]{10}\.md$/);
  assert.equal(job._remote_url, 'https://jobs.example.test/1');
  const file = join(dataRoot, job.url.slice('local:'.length));
  assert.ok(existsSync(file), `the reference must resolve against the data root: ${file}`);
  assert.match(readFileSync(file, 'utf-8'), /Build and run the data platform\./);
  assert.equal(existsSync(join(workDir, 'jds')), false, 'nothing may be created in the working directory');
});

test('a second scan finds the capture again and keeps the same reference', async () => {
  const [first] = await apify.provider.fetch(ENTRY, ctxFor(dataRoot));
  const [second] = await apify.provider.fetch(ENTRY, ctxFor(dataRoot));

  assert.equal(second.url, first.url);
  assert.deepEqual(readdirSync(join(dataRoot, 'jds')), [first.url.slice('local:jds/'.length)]);
});

test('a ctx with no dataRoot keeps writing to the working directory, as before', async () => {
  // An engine older than the capability builds a ctx without it.
  const [job] = await apify.provider.fetch(ENTRY, ctxFor(null));

  assert.ok(existsSync(join(workDir, job.url.slice('local:'.length))));
  assert.equal(existsSync(join(dataRoot, 'jds')), false);
});
