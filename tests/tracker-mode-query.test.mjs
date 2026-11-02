import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, describeSpawn } from './helpers.mjs';

test('every tracker.mjs query filter the tracker mode tells agents to use works', (t) => {
  const mode = readFileSync(join(ROOT, 'modes', 'tracker.md'), 'utf8');
  const paragraph = mode.split('\n').find((l) => l.includes('node tracker.mjs query'));
  assert.ok(paragraph, 'modes/tracker.md points agents at node tracker.mjs query');
  const filters = [...paragraph.matchAll(/`(--[a-z-]+)(?: ([^`]+))?`/g)].map((m) => (m[2] ? [m[1], m[2]] : [m[1]]));
  assert.ok(filters.length >= 5, `found filters ${JSON.stringify(filters)}`);

  const root = mkdtempSync(join(tmpdir(), 'tracker-mode-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'data'));
  writeFileSync(join(root, 'data', 'applications.md'), [
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
    '| 42 | 2026-09-10 | Acme | Platform Engineer | 4.2/5 | Applied | ✅ | — | fictional |',
    '| 43 | 2026-08-01 | Globex | Designer | 3.1/5 | SKIP | ❌ | — | fictional |',
  ].join('\n') + '\n');
  for (const args of filters) {
    const result = spawnSync(process.execPath, [join(ROOT, 'tracker.mjs'), 'query', ...args], {
      env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: root }, encoding: 'utf8', timeout: 20_000,
    });
    assert.equal(result.status, 0, describeSpawn(result, `tracker.mjs query ${args.join(' ')}`));
    if (args[0] !== '--json') assert.match(result.stdout, /\| 42 \| 2026-09-10 \| Acme/, args.join(' '));
    if (!['--json', '--limit'].includes(args[0])) assert.doesNotMatch(result.stdout, /\| 43 \|/, args.join(' '));
  }
});
