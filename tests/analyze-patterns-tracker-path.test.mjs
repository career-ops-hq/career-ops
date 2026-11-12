// tests/analyze-patterns-tracker-path.test.mjs — which tracker analyze-patterns
// reads, and whether its report links still resolve once that path is
// canonicalized.
//
// analyze-patterns used to pick data/applications.md or applications.md under
// the data root itself, ignoring CAREER_OPS_TRACKER, so `patterns` and
// `calibrate` analysed a different file than set-status.mjs writes whenever
// that override was set. It now goes through resolveTrackerPath(), which
// realpaths the result; report links must still resolve when the data root is
// reached through a symlink (macOS's /var -> /private/var tmpdir is one), and
// when the tracker file is itself a symlink, whose links are relative to its
// target.
import { pass, fail, ROOT, NODE, rmSync } from './helpers.mjs';
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

console.log('\nanalyze-patterns — tracker path resolution');

const HEADER = [
  '# Applications Tracker', '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|-------|',
];

function writeReport(root, num, archetype) {
  const file = `${String(num).padStart(3, '0')}-co${num}-2026-01-01.md`;
  writeFileSync(join(root, 'reports', file), [
    `# Evaluation: Co${num} — ${archetype}`, '',
    '## Machine Summary', '',
    '```yaml',
    `company: "Co${num}"`,
    `role: "${archetype}"`,
    'score: 4.0',
    `archetype: "${archetype}"`,
    '```', '',
  ].join('\n'));
  return file;
}

function trackerRow(num, link) {
  return `| ${num} | 2026-01-01 | Co${num} | Engineer | 4.0/5 | Rejected | ❌ | [${num}](${link}) | fixture |`;
}

function analyze(env) {
  const out = execFileSync(NODE, [join(ROOT, 'analyze-patterns.mjs'), '--min-threshold', '1'], {
    encoding: 'utf-8',
    timeout: 60000,
    env: { ...process.env, CAREER_OPS_TRACKER: '', ...env },
  });
  return JSON.parse(out);
}

const archetypesOf = (result) => (result.archetypeBreakdown || []).map((a) => a.archetype).sort();

const work = mkdtempSync(join(tmpdir(), 'co-ap-tracker-'));
try {
  const root = join(work, 'root');
  mkdirSync(join(root, 'data'), { recursive: true });
  mkdirSync(join(root, 'reports'), { recursive: true });

  // The data root's own tracker: one row, linked tracker-relative.
  const inRoot = writeReport(root, 1, 'In-Root Archetype');
  writeFileSync(join(root, 'data', 'applications.md'),
    [...HEADER, trackerRow(1, `../reports/${inRoot}`)].join('\n') + '\n');

  // A tracker outside the data root: two different rows, linked root-relative.
  const outside = join(work, 'elsewhere');
  mkdirSync(outside);
  const a = writeReport(root, 2, 'Override Archetype A');
  const b = writeReport(root, 3, 'Override Archetype B');
  const overrideTracker = join(outside, 'tracker.md');
  writeFileSync(overrideTracker,
    [...HEADER, trackerRow(2, `reports/${a}`), trackerRow(3, `reports/${b}`)].join('\n') + '\n');

  try {
    const result = analyze({ CAREER_OPS_ROOT: root, CAREER_OPS_TRACKER: overrideTracker });
    const got = archetypesOf(result);
    if (result.metadata?.total === 2 && got.join('|') === 'Override Archetype A|Override Archetype B') {
      pass('CAREER_OPS_TRACKER outside the data root: its rows are read and their reports resolve');
    } else {
      fail(`CAREER_OPS_TRACKER ignored or reports unresolved: total=${result.metadata?.total}, archetypes=${JSON.stringify(got)}`);
    }
  } catch (e) {
    fail(`analyze-patterns.mjs failed with CAREER_OPS_TRACKER set: ${(e.stderr || e.message || '').toString().slice(0, 300)}`);
  }

  // A tracker in another workspace (its own data/ and reports/): the reports
  // move with the tracker, the way resolveWorkspaceRoot() lays them out.
  const workspace = join(work, 'workspace');
  mkdirSync(join(workspace, 'data'), { recursive: true });
  mkdirSync(join(workspace, 'reports'), { recursive: true });
  const w = writeReport(workspace, 5, 'Workspace Archetype');
  const workspaceTracker = join(workspace, 'data', 'applications.md');
  writeFileSync(workspaceTracker, [...HEADER, trackerRow(5, `../reports/${w}`)].join('\n') + '\n');

  try {
    const result = analyze({ CAREER_OPS_ROOT: root, CAREER_OPS_TRACKER: workspaceTracker });
    const got = archetypesOf(result);
    if (result.metadata?.total === 1 && got.join('|') === 'Workspace Archetype') {
      pass("CAREER_OPS_TRACKER in another workspace: that workspace's reports are read");
    } else {
      fail(`workspace tracker: total=${result.metadata?.total}, archetypes=${JSON.stringify(got)}`);
    }
  } catch (e) {
    fail(`analyze-patterns.mjs failed on a workspace tracker: ${(e.stderr || e.message || '').toString().slice(0, 300)}`);
  }

  try {
    const result = analyze({ CAREER_OPS_ROOT: root });
    const got = archetypesOf(result);
    if (result.metadata?.total === 1 && got.join('|') === 'In-Root Archetype') {
      pass('no override: the data root tracker is read and its tracker-relative link resolves');
    } else {
      fail(`data root tracker: total=${result.metadata?.total}, archetypes=${JSON.stringify(got)}`);
    }
  } catch (e) {
    fail(`analyze-patterns.mjs failed on the data root tracker: ${(e.stderr || e.message || '').toString().slice(0, 300)}`);
  }

  // The data root reached through a symlink: the tracker realpaths to the
  // link's target, but tracker-relative report links must still land inside
  // the reports/ directory the containment guard checks against.
  const link = join(work, 'linked-root');
  let linked = false;
  try {
    symlinkSync(root, link, 'dir');
    linked = true;
  } catch {
    pass('symlinked data root: skipped (symlinks unavailable on this filesystem)');
  }
  if (linked) {
    try {
      const result = analyze({ CAREER_OPS_ROOT: link });
      const got = archetypesOf(result);
      if (got.join('|') === 'In-Root Archetype') {
        pass('symlinked data root: tracker-relative report links still resolve after the tracker is realpathed');
      } else {
        fail(`symlinked data root lost its report data: archetypes=${JSON.stringify(got)}`);
      }
    } catch (e) {
      fail(`analyze-patterns.mjs failed through a symlinked data root: ${(e.stderr || e.message || '').toString().slice(0, 300)}`);
    }
  }

  // A tracker file that is itself a symlink: its links are written relative
  // to the target's directory, which only the realpathed tracker path names.
  // The root is canonical so this is not also a symlinked-root case on macOS.
  const canonical = join(realpathSync(work), 'canonical-root');
  mkdirSync(join(canonical, 'data'), { recursive: true });
  mkdirSync(join(canonical, 'reports'), { recursive: true });
  const target = writeReport(canonical, 4, 'Linked Tracker Archetype');
  writeFileSync(join(canonical, 'data', 'applications.md'),
    [...HEADER, trackerRow(4, `../reports/${target}`)].join('\n') + '\n');
  const deepTracker = join(canonical, 'data', 'deep', 'applications.md');
  let trackerLinked = false;
  try {
    mkdirSync(dirname(deepTracker));
    symlinkSync(join('..', 'applications.md'), deepTracker, 'file');
    trackerLinked = true;
  } catch {
    pass('symlinked tracker file: skipped (symlinks unavailable on this filesystem)');
  }
  if (trackerLinked) {
    try {
      const result = analyze({ CAREER_OPS_ROOT: canonical, CAREER_OPS_TRACKER: deepTracker });
      const got = archetypesOf(result);
      if (got.join('|') === 'Linked Tracker Archetype') {
        pass('symlinked tracker file: links relative to its target still resolve');
      } else {
        fail(`symlinked tracker file lost its report data: archetypes=${JSON.stringify(got)}`);
      }
    } catch (e) {
      fail(`analyze-patterns.mjs failed through a symlinked tracker file: ${(e.stderr || e.message || '').toString().slice(0, 300)}`);
    }
  }

  // A CAREER_OPS_TRACKER that is a symlink into another workspace: the link's
  // own workspace has no reports/, the target's does, and links are written
  // relative to the target.
  const linkSide = join(realpathSync(work), 'link-side');
  const targetSide = join(realpathSync(work), 'target-side');
  mkdirSync(join(linkSide, 'data'), { recursive: true });
  mkdirSync(join(targetSide, 'data'), { recursive: true });
  mkdirSync(join(targetSide, 'reports'), { recursive: true });
  const t = writeReport(targetSide, 6, 'Target Workspace Archetype');
  writeFileSync(join(targetSide, 'data', 'applications.md'),
    [...HEADER, trackerRow(6, `../reports/${t}`)].join('\n') + '\n');
  const linkedTracker = join(linkSide, 'data', 'applications.md');
  let crossLinked = false;
  try {
    symlinkSync(join(targetSide, 'data', 'applications.md'), linkedTracker, 'file');
    crossLinked = true;
  } catch {
    pass('tracker symlinked into another workspace: skipped (symlinks unavailable on this filesystem)');
  }
  if (crossLinked) {
    try {
      const result = analyze({ CAREER_OPS_ROOT: root, CAREER_OPS_TRACKER: linkedTracker });
      const got = archetypesOf(result);
      if (got.join('|') === 'Target Workspace Archetype') {
        pass("tracker symlinked into another workspace: the target workspace's reports are read");
      } else {
        fail(`tracker symlinked into another workspace lost its report data: archetypes=${JSON.stringify(got)}`);
      }
    } catch (e) {
      fail(`analyze-patterns.mjs failed on a tracker symlinked into another workspace: ${(e.stderr || e.message || '').toString().slice(0, 300)}`);
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
