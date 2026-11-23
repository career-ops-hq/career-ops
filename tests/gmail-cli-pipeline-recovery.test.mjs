import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { linkNodeModules } from './helpers.mjs';

const source = fileURLToPath(new URL('../', import.meta.url));

test('the CLI retries a failed configured-lane write without changing the default pipeline', () => {
  const root = mkdtempSync(join(tmpdir(), 'co-gmail-cli-lane-'));
  const checkout = join(root, 'checkout');
  const lock = join(source, 'plugins.lock');
  const originalLock = existsSync(lock) ? readFileSync(lock) : null;
  const url = 'https://example.test/jobs/engineer?job_id=123';
  const main = join(root, 'data', 'pipeline.md');
  const blocker = join(root, 'data', 'custom');
  const lane = join(blocker, 'lane.md');
  const state = join(root, 'data', 'gmail-state.json');
  const original = '# Pipeline\n- [ ] ' + url + ' | Example | Engineer\n';
  const preload = join(root, 'gmail-fixture.mjs');
  try {
    // The CLI pins plugins.lock beside its code, independently of the data root.
    // Copy its local import closure, as plugins-run-failure-exit.test.mjs does.
    const seen = new Set();
    const queue = [join(source, 'plugins.mjs')];
    while (queue.length) {
      const file = queue.pop();
      if (seen.has(file) || !existsSync(file)) continue;
      seen.add(file);
      const dest = join(checkout, relative(source, file));
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(file, dest);
      for (const match of readFileSync(file, 'utf8').matchAll(/(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g)) {
        if (match[1].startsWith('.')) queue.push(join(dirname(file), match[1]));
      }
    }
    cpSync(join(source, 'plugins', 'gmail'), join(checkout, 'plugins', 'gmail'), { recursive: true });
    cpSync(join(source, 'tracker-aliases.json'), join(checkout, 'tracker-aliases.json'));
    const linkReason = linkNodeModules(checkout, source);
    assert.equal(linkReason, null, 'fixture dependencies must be available');
    mkdirSync(join(root, 'data'));
    mkdirSync(join(root, 'config'));
    writeFileSync(join(root, 'config', 'plugins.yml'), 'plugins:\n  gmail: { enabled: true }\n');
    writeFileSync(main, original);
    writeFileSync(blocker, 'regular file prevents creating lane directory\n');
    writeFileSync(state, '{"processed_message_ids":[]}\n');
    writeFileSync(preload, `
  import dns from 'node:dns/promises';
  import { syncBuiltinESMExports } from 'node:module';
  dns.lookup = async (host) => {
    if (!['oauth2.googleapis.com', 'gmail.googleapis.com'].includes(host)) throw Error('Unexpected DNS: ' + host);
    return [{ address: '8.8.8.8', family: 4 }];
  };
  syncBuiltinESMExports();
  globalThis.fetch = async request => {
    const { hostname, pathname } = new URL(request);
    if (hostname === 'oauth2.googleapis.com' && pathname === '/token')
      return Response.json({ access_token: 'fixture' });
    if (hostname === 'gmail.googleapis.com' && pathname === '/gmail/v1/users/me/messages')
      return Response.json({ messages: [{ id: 'message-1' }] });
    if (hostname === 'gmail.googleapis.com' && pathname === '/gmail/v1/users/me/messages/message-1')
      return Response.json({ payload: {
        mimeType: 'text/plain',
        headers: [
          { name: 'Subject', value: 'Engineer at Example' },
          { name: 'Authentication-Results', value: 'mx.google.com; dmarc=pass header.from=example.test' },
        ],
        body: { data: ${JSON.stringify(Buffer.from(url).toString('base64url'))} },
      } });
    throw Error('Unexpected fetch: ' + request);
  };
  `);
    const env = {
      PATH: process.env.PATH, HOME: root, TMPDIR: root,
      CAREER_OPS_ROOT: root, CAREER_OPS_PIPELINE: lane,
      GMAIL_CLIENT_ID: 'fixture', GMAIL_CLIENT_SECRET: 'fixture', GMAIL_REFRESH_TOKEN: 'fixture',
    };
    const run = () => {
      const { status, stdout, stderr, error } = spawnSync(process.execPath,
        ['--import', pathToFileURL(preload).href, join(checkout, 'plugins.mjs'), 'run', 'gmail', 'ingest'], { cwd: checkout, env, encoding: 'utf8', timeout: 30_000 });
      if (error) throw error;
      console.log(JSON.stringify({ status, stdout, stderr }));
      return { status, stdout, stderr };
    };
    const cursor = () => JSON.parse(readFileSync(state, 'utf8')).processed_message_ids;
    const blocked = run();
    assert.equal(blocked.status, 1);
    assert.match(blocked.stderr, /ENOTDIR|EEXIST/);
    assert.equal(readFileSync(main, 'utf8'), original);
    assert.deepEqual(cursor(), [], 'a failed append must not acknowledge the Gmail message');
    rmSync(blocker);
    mkdirSync(blocker);
    const retried = run();
    assert.equal(retried.status, 0);
    assert.match(retried.stdout, /Appended 1/);
    assert.deepEqual(cursor(), []);
    const confirmed = run();
    assert.equal(confirmed.status, 0);
    assert.match(confirmed.stdout, /0 new/);
    assert.deepEqual(cursor(), ['message-1']);
    assert.equal(readFileSync(lane, 'utf8').split(url).length - 1, 1);
    assert.equal(readFileSync(main, 'utf8'), original);
    console.log('PASS: restored lane receives one lead; Gmail acknowledges only after durable append; default pipeline unchanged.');
  } finally {
    rmSync(root, { recursive: true, force: true });
    assert.deepEqual(existsSync(lock) ? readFileSync(lock) : null, originalLock,
      'the CLI fixture must leave plugins.lock in the source checkout unchanged');
  }
});
