// tests/status-hooks-followups-override.test.mjs — a follow-up pin seeded when
// a row becomes Applied goes where CAREER_OPS_FOLLOWUPS says.
//
// followup-seed.mjs and followup-cadence.mjs (the reader that decides what is
// due) both resolve the follow-ups file as CAREER_OPS_FOLLOWUPS first. The
// status hook that set-status, dedup-tracker and outcome call on a move to
// Applied passed followup-seed an explicit path derived from the tracker's
// directory instead, and an explicit path beats the environment. So with the
// override set, the pin was written to a file the cadence never reads.
import { pass, fail, rmSync, ROOT, NODE } from './helpers.mjs';
import assert from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

/** Move row #1 to Applied with set-status; report where the follow-up pin landed. */
function applyRowOne(withOverride) {
  const dir = mkdtempSync(join(tmpdir(), 'followups-override-'));
  try {
    mkdirSync(join(dir, 'data'), { recursive: true });
    mkdirSync(join(dir, 'elsewhere'), { recursive: true });
    const tracker = join(dir, 'data', 'applications.md');
    writeFileSync(tracker, [
      '# Applications Tracker', '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|---|---|---|---|---|---|---|---|',
      '| 1 | 2026-10-01 | Acme | Platform Engineer | 4.2/5 | Evaluated | ❌ | — | |',
      '',
    ].join('\n'));
    const override = join(dir, 'elsewhere', 'follow-ups.md');
    const { CAREER_OPS_FOLLOWUPS: _unset, ...env } = process.env;
    const r = spawnSync(NODE, [join(ROOT, 'set-status.mjs'), '1', 'Applied'], {
      cwd: dir, encoding: 'utf-8', timeout: 30000,
      env: { ...env, CAREER_OPS_ROOT: dir, CAREER_OPS_TRACKER: tracker, CAREER_OPS_DATA_DIR: '', ...(withOverride ? { CAREER_OPS_FOLLOWUPS: override } : {}) },
    });
    assert.strictEqual(r.status, 0, `set-status exited ${r.status}: ${r.stdout}${r.stderr}`);
    const read = (p) => (existsSync(p) ? readFileSync(p, 'utf-8') : null);
    return { besideTracker: read(join(dir, 'data', 'follow-ups.md')), override: read(override) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log('\nstatus hooks — the Applied follow-up pin honours CAREER_OPS_FOLLOWUPS');

ok('with CAREER_OPS_FOLLOWUPS set, the pin lands in that file', () => {
  const { besideTracker, override } = applyRowOne(true);
  assert.match(override ?? '', /next #1 \d{4}-\d{2}-\d{2}/, `override file: ${JSON.stringify(override)}`);
  assert.strictEqual(besideTracker, null, 'nothing may be written beside the tracker');
});

ok('premise: without it, the pin lands beside the tracker as before', () => {
  const { besideTracker } = applyRowOne(false);
  assert.match(besideTracker ?? '', /next #1 \d{4}-\d{2}-\d{2}/, `beside tracker: ${JSON.stringify(besideTracker)}`);
});
