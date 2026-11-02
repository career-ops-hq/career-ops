// tests/plugins-export-snapshot.test.mjs — the export hook's tracker snapshot.
//
// buildSnapshot() used to read a fixed DATA_ROOT/data/applications.md with a
// private table parser keyed by the literal lowercased header. A tracker set
// through CAREER_OPS_TRACKER or kept at the legacy root location was never
// read, and a localized header (`| # | Datum | Firma | Rolle |`) produced rows
// with no `company` / `role` key, which the Notion export skips: both ended
// in "pushed 0 record(s)". The snapshot now resolves the tracker with
// resolveTrackerPath() and maps columns through tracker-parse.mjs.
//
// plugins.mjs resolves its paths at import time, so each case imports a fresh
// copy (cache-busting query) with its own environment, and restores it after.
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from './helpers.mjs';
import { canonicalizeTrackerPath } from '../path-resolver.mjs';

console.log('\nplugins — export snapshot reads the resolved tracker through tracker-parse');

const ENGLISH = [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|-------|',
  '| 1 | 2026-06-01 | Acme Corp | Staff Engineer | 4.5/5 | Interview | ❌ | - | |',
  '| N/A | 2026-05-02 | Globex | Platform Lead | N/A | Rejected | ❌ | - | backfilled |',
  '',
].join('\n');

// The header modes/de/angebot.md creates, with Score and Status swapped round
// from the English order to show the columns are read by name, not position.
const GERMAN = [
  '| # | Datum | Firma | Rolle | Status | Score | PDF | Report | Notes |',
  '|---|-------|-------|-------|--------|-------|-----|--------|-------|',
  '| 7 | 2026-06-03 | Beispiel GmbH | Backend-Entwickler | Applied | 4.1/5 | ✅ | - | |',
  '',
].join('\n');

const ENV_KEYS = ['CAREER_OPS_ROOT', 'CAREER_OPS_DATA_DIR', 'CAREER_OPS_TRACKER'];

async function snapshotWith(env) {
  const prev = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  try {
    for (const k of ENV_KEYS) delete process.env[k];
    Object.assign(process.env, env);
    const mod = await import(
      pathToFileURL(join(ROOT, 'plugins.mjs')).href + '?snapshot=' + Date.now() + Math.random()
    );
    return { path: mod._testPaths.APPLICATIONS_PATH, snap: mod._testBuildSnapshot() };
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function check(cond, ok, bad) {
  if (cond) pass(ok);
  else fail(bad);
}

const dir = mkdtempSync(join(tmpdir(), 'career-ops-plugin-snapshot-'));
try {
  // 1. CAREER_OPS_TRACKER points outside the data root entirely.
  const root1 = join(dir, 'root1');
  mkdirSync(join(root1, 'data'), { recursive: true });
  writeFileSync(join(root1, 'data', 'applications.md'), GERMAN); // must NOT be read
  const custom = join(dir, 'elsewhere', 'my-tracker.md');
  mkdirSync(join(dir, 'elsewhere'));
  writeFileSync(custom, ENGLISH);
  {
    const { path, snap } = await snapshotWith({ CAREER_OPS_ROOT: root1, CAREER_OPS_TRACKER: custom });
    check(path === canonicalizeTrackerPath(custom),
      'CAREER_OPS_TRACKER: the snapshot reads the overridden tracker path',
      `CAREER_OPS_TRACKER: expected ${canonicalizeTrackerPath(custom)}, got ${path}`);
    const companies = snap.applications.map((r) => r.company);
    check(JSON.stringify(companies) === JSON.stringify(['Acme Corp', 'Globex']),
      'CAREER_OPS_TRACKER: every row of the overridden tracker reaches the snapshot',
      `CAREER_OPS_TRACKER: snapshot companies ${JSON.stringify(companies)}`);
    const [acme, globex] = snap.applications;
    check(acme?.num === '1' && acme?.role === 'Staff Engineer' && acme?.score === '4.5/5' && acme?.status === 'Interview',
      'rows carry canonical field names with string values',
      `unexpected row shape: ${JSON.stringify(acme)}`);
    check(globex?.num === 'N/A' && globex?.status === 'Rejected',
      'a backfilled row numbered with a sentinel is kept, with its sentinel as num',
      `sentinel row: ${JSON.stringify(globex)}`);
    check(acme && !('raw' in acme) && Object.isFrozen(acme),
      'snapshot rows are frozen and do not expose the raw line',
      `row is not a frozen field record: ${JSON.stringify(acme)}`);
  }

  // 2. Legacy layout: the tracker sits at the data root, with no data/ copy.
  const root2 = join(dir, 'root2');
  mkdirSync(root2);
  writeFileSync(join(root2, 'applications.md'), ENGLISH);
  {
    const { path, snap } = await snapshotWith({ CAREER_OPS_ROOT: root2 });
    check(path === canonicalizeTrackerPath(join(root2, 'applications.md')),
      'legacy root tracker: the snapshot falls back to {root}/applications.md',
      `legacy root tracker: got ${path}`);
    check(snap.applications.length === 2,
      'legacy root tracker: its rows reach the snapshot',
      `legacy root tracker: ${snap.applications.length} row(s), expected 2`);
  }

  // 3. A localized (DE) header maps onto the same canonical keys.
  const root3 = join(dir, 'root3');
  mkdirSync(join(root3, 'data'), { recursive: true });
  writeFileSync(join(root3, 'data', 'applications.md'), GERMAN);
  {
    const { snap } = await snapshotWith({ CAREER_OPS_ROOT: root3 });
    const [row] = snap.applications;
    check(row?.company === 'Beispiel GmbH' && row?.role === 'Backend-Entwickler',
      'localized header: Firma/Rolle map to company/role, so an export plugin sees the row',
      `localized header: ${JSON.stringify(row)}`);
    check(row?.score === '4.1/5' && row?.status === 'Applied',
      'localized header: score and status are read by name, not position',
      `localized header score/status: ${JSON.stringify(row)}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
