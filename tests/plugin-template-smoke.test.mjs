// tests/plugin-template-smoke.test.mjs — a plugin fresh from `plugins.mjs new`
// must pass its own test/smoke.mjs (#6811).
//
// The template's smoke test handed import() a bare filesystem path. import()
// reads its argument as a URL, so on Windows the drive letter ('C:') was taken
// as a URL scheme and every scaffolded plugin failed with
// ERR_UNSUPPORTED_ESM_URL_SCHEME. The same mistake shows on every OS when a
// directory name holds a '#' (read as the start of a fragment) or a '%'
// (read as a percent-escape), so the scaffold root here carries both and the
// test fails on Linux and macOS too, not only on the Windows CI leg.
//
// HERMETIC: scaffolds into a temp root that holds only a copy of the template.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scaffoldNew } from '../plugin-install.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TEMPLATE = join(ROOT, 'plugins', '_template');

test('a freshly scaffolded plugin passes its own smoke test', () => {
  const root = mkdtempSync(join(tmpdir(), 'co-smoke #1 %41-'));
  try {
    cpSync(TEMPLATE, join(root, 'plugins', '_template'), { recursive: true });
    const dest = scaffoldNew(root, 'demo');
    const r = spawnSync(process.execPath, [join(dest, 'test', 'smoke.mjs')], {
      encoding: 'utf8',
      timeout: 20_000,
    });
    assert.equal(r.status, 0, `smoke.mjs exited ${r.status}:\n${r.stderr}`);
    assert.match(r.stdout, /✓ smoke ok: ingest/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
