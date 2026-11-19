// tests/linkedin-join-piped-output.test.mjs — a large join result reaches a
// pipe whole.
//
// linkedin-join.mjs printed its result with console.log and then called
// process.exit(main()). A write to a pipe can still be queued at that point
// (it is on macOS), and process.exit() drops it, so a JSON result past the
// 64 KiB pipe buffer arrived cut off and did not parse. That is the default
// output, read by `| jq` and by an agent's shell. Each matched connection is
// about 400 bytes of JSON, so a few hundred contacts at tracked companies is
// enough. discover-new-companies.mjs had the same bug (#5541).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONNECTIONS = 600;

function runJoin(t, extraArgs) {
  const root = mkdtempSync(join(tmpdir(), 'linkedin-join-pipe-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'data'));
  writeFileSync(join(root, 'data', 'applications.md'), [
    '# Applications Tracker',
    '',
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
    '| 1 | 2026-11-01 | Acme Robotics | Platform Engineer | 4.2/5 | Applied | ❌ | — | |',
    '',
  ].join('\n'));
  const rows = ['First Name,Last Name,URL,Email Address,Company,Position,Connected On'];
  for (let i = 0; i < CONNECTIONS; i++) {
    rows.push(`Person${i},Example${i},https://www.linkedin.com/in/person-${i}-example,,Acme Robotics,Senior Platform Engineer ${i},01 Mar 2024`);
  }
  const csv = join(root, 'Connections.csv');
  writeFileSync(csv, `${rows.join('\n')}\n`);
  const env = { ...process.env, CAREER_OPS_ROOT: root };
  delete env.CAREER_OPS_DATA_DIR;
  delete env.CAREER_OPS_TRACKER;
  // spawnSync reads the child's stdout through a pipe, as `| jq` does.
  return spawnSync(process.execPath, [join(ROOT, 'linkedin-join.mjs'), '--csv', csv, ...extraArgs], {
    cwd: root, env, encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024 * 1024,
  });
}

test('the default JSON result over 64 KiB reaches a pipe whole and parses', (t) => {
  const r = runJoin(t, []);
  assert.equal(r.status, 0, r.stderr);
  let result;
  assert.doesNotThrow(() => { result = JSON.parse(r.stdout); }, `the JSON arrived cut off at ${Buffer.byteLength(r.stdout)} bytes`);
  assert.equal(result.totals.matchedConnections, CONNECTIONS);
  assert.ok(Buffer.byteLength(r.stdout) > 65536, `the fixture must fill more than the pipe buffer (${Buffer.byteLength(r.stdout)} bytes)`);
});

test('--tsv output over 64 KiB reaches a pipe whole', (t) => {
  const r = runJoin(t, ['--tsv']);
  assert.equal(r.status, 0, r.stderr);
  const last = `person-${CONNECTIONS - 1}-example`;
  assert.ok(r.stdout.includes(last), `the TSV stops before the last connection (${Buffer.byteLength(r.stdout)} bytes)`);
  assert.ok(r.stdout.endsWith('\n'), 'the TSV ends with its final newline');
  assert.ok(Buffer.byteLength(r.stdout) > 65536, `the fixture must fill more than the pipe buffer (${Buffer.byteLength(r.stdout)} bytes)`);
});
