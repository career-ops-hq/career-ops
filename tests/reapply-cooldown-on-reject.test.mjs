import { pass, fail, NODE, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { spawnSync } from 'child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, chmodSync, statSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import * as yaml from 'js-yaml';

console.log('\nre-apply cooldown recorded on Rejected (set-status --cooldown-days, scan, precheck)');

const check = (ok, label, detail = '') => (ok ? pass(label) : fail(`${label}${detail ? ` — ${detail}` : ''}`));
const mod = (file) => import(pathToFileURL(join(ROOT, file)).href);

const { upsertReapplyWindow, mergeWindow, windowUntil, recordCooldown, cooldownLockDir } = await mod('lib/reapply-windows.mjs');
const { buildCooldownFilter, loadReApplyWindows } = await mod('scan.mjs');
const { findActiveCooldown } = await mod('precheck-duplicate.mjs');

// ── upsert: comment-preserving text edit ─────────────────────────

const PROFILE = [
  '# my profile',
  'candidate:',
  '  full_name: "Fixture Person"   # inline comment',
  '',
  're_apply_windows:',
  '  # windows I wrote by hand',
  '  Stripe:',
  '    last_apply_date: "2026-01-01"   # keep',
  '    same_role_days: 365',
  '  Acme Corp:',
  '    cooldown_from: "2026-02-01"',
  '    same_role_days: 30',
  '',
  '# a later section',
  'cv:',
  '  output_format: "html"',
  '',
].join('\n');

{
  const r = upsertReapplyWindow(PROFILE, 'Acme Corp, Inc.', { from: '2026-03-01', days: 60, role: 'PM' });
  check(r !== null, 'upsert places a window in an existing section');
  const before = PROFILE.split('\n');
  const after = r.text.split('\n');
  const kept = before.filter((l) => !/^ {2}Acme Corp:|^ {4}(cooldown_from|same_role_days): ("2026-02-01"|30)$/.test(l));
  check(kept.every((l) => after.includes(l)), 'every other line, comments included, round-trips');
  check(r.key === 'Acme Corp', 'a corporate-form spelling reuses the existing key', r.key);
  const doc = yaml.load(r.text);
  check(doc.re_apply_windows['Acme Corp'].cooldown_from === '2026-03-01' && doc.re_apply_windows['Acme Corp'].same_role_days === 60,
    'a longer window replaces start and length');
  check(doc.re_apply_windows.Stripe.same_role_days === 365 && doc.cv.output_format === 'html', 'other windows and sections are untouched');
}

{
  const r = upsertReapplyWindow('candidate:\n  full_name: "X"\n', 'Initech', { from: '2026-11-10', days: 180, role: 'Software Engineer' });
  const doc = yaml.load(r.text);
  check(r.text.startsWith('candidate:\n  full_name: "X"\n'), 'a missing section is appended after the existing text');
  check(doc.re_apply_windows.Initech.applied_to[0] === 'Software Engineer', 'the role becomes applied_to');
}

check(upsertReapplyWindow('re_apply_windows: {}\n', 'X', { from: '2026-01-01', days: 5 }) === null,
  'a flow-style section is refused, never rewritten');
check(upsertReapplyWindow('- a\n- b\n', 'X', { from: '2026-01-01', days: 5 }) === null, 'a non-mapping profile is refused');

{
  const r = upsertReapplyWindow('', 'Foo: Bar', { from: '2026-01-01', days: 5, role: 'A "q" #1' });
  const doc = yaml.load(r.text);
  check(doc.re_apply_windows['Foo: Bar'].applied_to[0] === 'A "q" #1', 'keys and roles that need quoting survive');
}

// ── merge rules ──────────────────────────────────────────────────

{
  const existing = { cooldown_from: '2026-11-10', same_role_days: 365, applied_to: ['SWE'], scope: 'company' };
  const merged = mergeWindow(existing, { from: '2026-12-01', days: 30, role: 'PM', scope: 'role' });
  check(windowUntil(merged) === windowUntil(existing), 'a shorter new window never shortens an existing one');
  check(merged.scope === 'company', 'company scope is never narrowed back to role');
  check(merged.applied_to.join() === 'SWE,PM', 'the new role is appended once');
  const again = mergeWindow(merged, { from: '2026-12-01', days: 30, role: 'pm' });
  check(again.applied_to.length === 2, 'roles are de-duplicated case-insensitively');
}

{
  // A company-wide window that ended 2026-01-31; a role-scoped rejection on 2026-11-10.
  const expired = { cooldown_from: '2025-08-04', same_role_days: 180, applied_to: ['SWE'], cross_role_bucket: 'all_EM_roles', scope: 'company', note: 'mine' };
  const merged = mergeWindow(expired, { from: '2026-11-10', days: 90, role: 'PM', scope: 'role' });
  check(merged.scope === undefined && merged.cross_role_bucket === undefined, 'an expired window does not pass on its company-wide scope or bucket');
  check(merged.applied_to.join() === 'PM', 'an expired window does not pass on its roles');
  check(merged.note === 'mine', 'unrelated keys of the expired window are kept');
  check(merged.cooldown_from === '2026-11-10' && merged.same_role_days === 90, 'the new window starts fresh');
}

// ── scan: cooldown_from and scope: company ───────────────────────

{
  const windows = {
    Initech: { cooldown_from: '2026-11-10', same_role_days: 180, applied_to: ['Software Engineer'] },
    Globex: { cooldown_from: '2026-11-10', same_role_days: 180, applied_to: ['Data Engineer'], scope: 'company' },
  };
  const f = buildCooldownFilter(windows, '2026-12-01');
  check(f({ company: 'Initech', title: 'Senior Software Engineer' }).skip === true, 'scan honours cooldown_from');
  check(f({ company: 'Initech', title: 'Product Designer' }).skip === false, 'role scope still covers only matching titles');
  check(f({ company: 'Globex', title: 'Product Designer' }).skip === true, 'scope: company covers every title');
  check(buildCooldownFilter(windows, '2027-05-09')({ company: 'Globex', title: 'x' }).skip === false, 'the window ends on its until day');
}

const work = mkdtempSync(join(tmpdir(), 'cops-cooldown-'));
try {
  mkdirSync(join(work, 'data'), { recursive: true });
  mkdirSync(join(work, 'config'), { recursive: true });
  const profilePath = join(work, 'config', 'profile.yml');
  const tracker = join(work, 'data', 'applications.md');

  writeFileSync(profilePath, 're_apply_windows:\n  Bad:\n    cooldown_from: "nope"\n  Odd:\n    cooldown_from: "2026-01-01"\n    scope: "everything"\n  Good:\n    cooldown_from: "2026-01-01"\n');
  const loaded = loadReApplyWindows(profilePath);
  check(Object.keys(loaded).join() === 'Good', 'scan drops windows with a bad date or an unknown scope', Object.keys(loaded).join());

  // ── set-status CLI ─────────────────────────────────────────────
  writeFileSync(tracker, [
    '# Applications Tracker', '',
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
    '| 1 | 2026-09-08 | Initech | Software Engineer | 4.5/5 | Interview | — | — | — |',
    '| 2 | 2026-09-08 | Acme | PM | 4.0/5 | Applied | — | — | — |', '',
  ].join('\n'));
  const PROFILE_TEXT = 'candidate:\n  full_name: "Fixture"   # keep me\n';
  writeFileSync(profilePath, PROFILE_TEXT);
  const env = { ...process.env, CAREER_OPS_ROOT: work, CAREER_OPS_TRACKER: tracker, CAREER_OPS_PROFILE: '' };
  const run = (...args) => spawnSync(NODE, [join(ROOT, 'set-status.mjs'), ...args], { encoding: 'utf-8', timeout: 30000, env });

  const dry = run('--row', '1', 'Rejected', '--cooldown-days', '180', '--dry-run', '--json');
  const dryOut = JSON.parse(dry.stdout);
  check(dry.status === 0 && dryOut.cooldownRecorded?.dryRun === true && readFileSync(profilePath, 'utf8') === PROFILE_TEXT,
    '--dry-run reports the window and writes nothing');

  const ok = run('--row', '1', 'Rejected', '--cooldown-days', '180', '--on', '2026-11-10', '--json');
  const out = JSON.parse(ok.stdout);
  check(ok.status === 0 && out.newStatus === 'Rejected', 'Rejected with --cooldown-days exits 0');
  check(out.cooldownRecorded?.recorded === true && out.cooldownRecorded.until === '2027-05-09',
    'the window counts from --on', JSON.stringify(out.cooldownRecorded));
  const text = readFileSync(profilePath, 'utf8');
  check(text.startsWith(PROFILE_TEXT), 'the profile keeps its existing text and comments');
  check(yaml.load(text).re_apply_windows.Initech.applied_to[0] === 'Software Engineer', 'the row role is recorded');

  const wide = JSON.parse(run('--row', '1', 'Rejected', '--cooldown-days', '365', '--cooldown-scope', 'company', '--json').stdout);
  check(wide.changed === false && wide.cooldownRecorded?.scope === 'company',
    'an already-Rejected row can still record (and widen) its window');

  if (process.platform !== 'win32') {
    chmodSync(profilePath, 0o600);
    run('--row', '1', 'Rejected', '--cooldown-days', '400', '--json');
    check((statSync(profilePath).mode & 0o777) === 0o600, 'the replaced profile keeps its 0600 mode', (statSync(profilePath).mode & 0o777).toString(8));
  }
  check(!existsSync(cooldownLockDir(profilePath)), 'the cooldown lock is released after the write');

  const moved = run('--row', '1', 'Interview', '--json');
  const guarded = run('--row', '1', 'Rejected', '--expect-status', 'Rejected', '--cooldown-days', '30', '--json');
  check(moved.status === 0 && guarded.status !== 0, '--expect-status Rejected refuses a row that moved on', `exit ${guarded.status}`);
  run('--row', '1', 'Rejected', '--json');
  const stillRejected = run('--row', '1', 'Rejected', '--expect-status', 'Rejected', '--cooldown-days', '30', '--json');
  check(stillRejected.status === 0, '--expect-status Rejected accepts a row that is still Rejected');

  // Two cooldown writers at once: both windows land.
  writeFileSync(profilePath, PROFILE_TEXT);
  const both = await Promise.all([
    recordCooldown({ profilePath, company: 'Alpha Co', role: 'A', from: '2026-11-10', days: 30 }),
    recordCooldown({ profilePath, company: 'Beta Co', role: 'B', from: '2026-11-10', days: 60 }),
  ]);
  const concurrent = yaml.load(readFileSync(profilePath, 'utf8')).re_apply_windows;
  check(both.every((r) => r.recorded) && concurrent['Alpha Co'] && concurrent['Beta Co'], 'concurrent cooldown writers both land');

  const zero = JSON.parse(run('--row', '2', 'Rejected', '--cooldown-days', '0', '--json').stdout);
  check(zero.newStatus === 'Rejected' && zero.cooldownRecorded?.reason === 'no-cooldown', '--cooldown-days 0 saves the status and records nothing');

  const refusals = [
    [['--row', '2', 'Interview', '--cooldown-days', '30'], 'a cooldown on a non-Rejected state'],
    [['--row', '2', 'Rejected', '--cooldown-scope', 'company'], '--cooldown-scope without --cooldown-days'],
    [['--row', '2', 'Rejected', '--cooldown-days', '9999'], 'more than 3650 days'],
    [['--row', '2', 'Rejected', '--cooldown-days', '30', '--cooldown-scope', 'team'], 'an unknown scope'],
    [['--row', '2', '--undo', '--cooldown-days', '5'], '--undo with a cooldown'],
  ];
  for (const [args, label] of refusals) {
    const r = run(...args);
    check(r.status === 1, `refused: ${label}`, `exit ${r.status}`);
  }

  // A profile shape the edit cannot place: the status lands, the cooldown is reported, the profile is untouched.
  writeFileSync(profilePath, 're_apply_windows: {}\n');
  const unplaceable = run('--row', '2', 'Rejected', '--cooldown-days', '30', '--json');
  const unplaceableOut = JSON.parse(unplaceable.stdout);
  check(unplaceable.status === 0 && unplaceableOut.cooldownRecorded?.reason === 'unplaceable'
    && readFileSync(profilePath, 'utf8') === 're_apply_windows: {}\n',
  'an unplaceable profile never fails the status and is never rewritten');

  // ── precheck-duplicate ─────────────────────────────────────────
  writeFileSync(profilePath, 're_apply_windows:\n  Initech:\n    cooldown_from: "2026-11-10"\n    same_role_days: 180\n    applied_to: ["Software Engineer"]\n');
  const inside = await findActiveCooldown({ company: 'Initech, Inc.', title: 'Senior Software Engineer' }, { profilePath, today: '2026-12-01' });
  check(inside?.coversThisRole === true && inside.until === '2027-05-09', 'precheck flags a covered title');
  const other = await findActiveCooldown({ company: 'Initech', title: 'Product Designer' }, { profilePath, today: '2026-12-01' });
  check(other?.coversThisRole === false, 'precheck notes a window that covers other roles only');
  const expired = await findActiveCooldown({ company: 'Initech', title: 'Software Engineer' }, { profilePath, today: '2027-05-09' });
  check(expired === null, 'precheck is silent once the window ends');

  // Two keys match one company: a PM-only window and a longer company-wide one.
  writeFileSync(profilePath, 're_apply_windows:\n  Acme:\n    cooldown_from: "2026-11-01"\n    same_role_days: 30\n    applied_to: ["PM"]\n  Acme Inc:\n    cooldown_from: "2026-11-10"\n    same_role_days: 180\n    scope: "company"\n');
  const pair = await findActiveCooldown({ company: 'Acme Inc', title: 'Software Engineer' }, { profilePath, today: '2026-11-20' });
  check(pair?.coversThisRole === true && pair.company === 'Acme Inc' && pair.until === '2027-05-09' && pair.scope === 'company',
    'precheck reports the covering window, with that window\'s own dates', JSON.stringify(pair));
} finally {
  rmSync(work, { recursive: true, force: true });
}
