// tests/doctor-code-root-checks.test.mjs — checkDependencies() and
// checkTrackedBakFiles() must read the CODE checkout, not the resolved data
// root (career-ops#3867 finding 6).
//
// node_modules and .git belong to wherever doctor.mjs itself lives. Under a
// split checkout (CAREER_OPS_ROOT/CAREER_OPS_DATA_DIR, or the .career-ops-data
// marker) getCareerOpsRoot() resolves to a separate data-only directory that
// never holds either — jday013/maxmilian's proof on #3867: an empty
// node_modules/ created inside the data root flips "Dependencies not
// installed" to "installed" even though the real code checkout's own
// node_modules never moved. The inverse held for the tracked-.bak check, and
// in two places: the human-readable checks array in main() AND the separate
// onboardingState() used by `--json` (the form AGENTS.md has every agent run
// on the first message of every session) each ran their own
// checkTrackedBakFiles(root) against the data root.
//
// This does not use --target: that flag means "diagnose this whole other
// checkout" (code layer included) and tests/doctor-tracked-bak-files.test.mjs
// already pins that it keeps checking the targeted directory. Here the split
// is the ambient one a real installation hits — CAREER_OPS_ROOT set, no
// --target — so codeRoot must fall back to doctor.mjs's own directory.
import { pass, fail, NODE, ROOT } from './helpers.mjs';
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

console.log('\ndoctor.mjs — code-root checks stay on the code checkout under a split root (#3867)');

const DOCTOR = join(ROOT, 'doctor.mjs');

function git(cwd, ...args) {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function runDoctor(dataRoot, extraArgs = []) {
  try {
    const out = execFileSync(NODE, [DOCTOR, ...extraArgs], {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CAREER_OPS_ROOT: dataRoot },
    });
    return { out, code: 0 };
  } catch (e) {
    // doctor.mjs exits 1 on a real failing check (e.g. missing cv.md in the
    // throwaway data root) — that is expected here and not itself a test
    // failure, so stdout is still read from the caught error.
    return { out: e.stdout ? String(e.stdout) : '', stderr: e.stderr ? String(e.stderr) : '', code: e.status ?? 1 };
  }
}

const dataRoot = mkdtempSync(join(tmpdir(), 'co-doctor-coderoot-'));
try {
  // The data root: no node_modules (the real, always-true shape of a
  // data-only install), but IS its own git checkout with a tracked .bak file
  // — the strongest proof that the checks stopped reading it, not merely
  // that they happen to also pass elsewhere.
  git(dataRoot, 'init', '-q');
  git(dataRoot, 'config', 'user.email', 'test@example.com');
  git(dataRoot, 'config', 'user.name', 'Test');
  writeFileSync(join(dataRoot, 'stray.md.bak'), 'a data-root backup that is not the code checkout\n', 'utf-8');
  git(dataRoot, 'add', 'stray.md.bak');
  git(dataRoot, 'commit', '-q', '-m', 'tracked backup living in the data root only');

  // 1. Plain-text mode drives main()'s checks array: checkDependencies() and
  //    checkTrackedBakFiles(codeRoot).
  const plain = runDoctor(dataRoot);
  if (plain.stderr) {
    fail(`doctor crashed under a split CAREER_OPS_ROOT (plain mode): ${plain.stderr}`);
  } else {
    if (!/Dependencies not installed/.test(plain.out)) {
      pass("checkDependencies() reads the code checkout's own node_modules, not the split data root");
    } else {
      fail(`checkDependencies() reported the code checkout's real node_modules as missing:\n${plain.out}`);
    }
    if (!/stray\.md\.bak/.test(plain.out)) {
      pass("main()'s checkTrackedBakFiles() does not surface a .bak file tracked only in the split data root");
    } else {
      fail(`main()'s checkTrackedBakFiles() leaked the data root's tracked .bak file into the report:\n${plain.out}`);
    }
  }

  // 2. --json mode drives the separate onboardingState() path (what AGENTS.md
  //    has every agent run on session start) — its own, independent
  //    checkTrackedBakFiles(root) call had the same bug.
  const jsonRun = runDoctor(dataRoot, ['--json']);
  try {
    const state = JSON.parse(jsonRun.out);
    const warningText = (state.warnings || []).join('\n');
    if (!/stray\.md\.bak/.test(warningText)) {
      pass("onboardingState()'s checkTrackedBakFiles() does not surface the data root's tracked .bak file either");
    } else {
      fail(`onboardingState()'s checkTrackedBakFiles() leaked the data root's tracked .bak file: ${JSON.stringify(state.warnings)}`);
    }
  } catch {
    fail(`doctor --json did not produce parseable JSON under a split CAREER_OPS_ROOT: ${jsonRun.out}\n${jsonRun.stderr || ''}`);
  }
} finally {
  rmSync(dataRoot, { recursive: true, force: true });
}
