// tests/scan-data-paths-under-data-root.test.mjs — the scanners' User Layer data
// follows the configured data root, not the shell's working directory (#3510).
//
// scan.mjs anchored some of its data paths to DATA_ROOT (SCAN_HISTORY_PATH,
// PIPELINE_PATH, PORTALS_PATH, APPLICATIONS_PATH) and left others as bare
// relative strings resolved against process.cwd() (blacklist, scan-runs,
// portal-health), with the sibling scanners carrying their own cwd-relative
// copies of paths they then WROTE to through scan.mjs's anchored ones. One
// command, one dataset, two destinations.
//
// Nothing failed loudly, which is what made it worth a test: a wrong-but-writable
// path is silently accepted. The sharpest case is the blacklist — AGENTS.md
// documents data/blacklist.md as respected by scan.mjs, and a user with a data
// root got an empty list with no indication their do-not-apply companies had
// been let through.
//
// Every check below runs the real module in a child process with the data root
// and the cwd pointed at DIFFERENT directories, each holding a decoy copy of the
// file under test. A path that follows the cwd picks the decoy; one that follows
// the data root picks the real file. If the two directories were the same, this
// suite could not tell them apart — which is precisely how the drift survived.
import { pass, fail, ROOT, NODE } from './helpers.mjs';
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';

console.log('\nscanners — user data follows the data root, not the cwd (#3510)');

const dataRoot = mkdtempSync(join(tmpdir(), 'career-ops-scanroot-'));
const decoyCwd = mkdtempSync(join(tmpdir(), 'career-ops-scandecoy-'));
mkdirSync(join(dataRoot, 'data', 'cache'), { recursive: true });
mkdirSync(join(decoyCwd, 'data', 'cache'), { recursive: true });

/** Run one ESM snippet with the data root and the cwd deliberately separated. */
function inChild(snippet) {
  return execFileSync(NODE, ['--input-type=module', '-e', snippet], {
    cwd: decoyCwd,
    encoding: 'utf-8',
    timeout: 60000,
    env: { ...process.env, CAREER_OPS_ROOT: dataRoot, CAREER_OPS_DATA_DIR: '' },
  }).trim();
}

const scanUrl = JSON.stringify(pathToFileURL(join(ROOT, 'scan.mjs')).href);
const atsUrl = JSON.stringify(pathToFileURL(join(ROOT, 'scan-ats-full.mjs')).href);

const blacklistRow = (company) =>
  `| Company | Since | Scope | Reason |\n|---|---|---|---|\n| ${company} | 2026-01-01 | company | fixture |\n`;

try {
  // 1. The blacklist the user actually owns is the one that gets read.
  writeFileSync(join(dataRoot, 'data', 'blacklist.md'), blacklistRow('RealCo'), 'utf-8');
  writeFileSync(join(decoyCwd, 'data', 'blacklist.md'), blacklistRow('DecoyCo'), 'utf-8');
  const seen = inChild(`
    const m = await import(${scanUrl});
    console.log([...m.loadBlacklist().keys()].join(','));
  `);
  seen === 'realco'
    ? pass('loadBlacklist() reads the data root’s blacklist, not the cwd’s')
    : fail(`loadBlacklist() read the wrong file — saw [${seen}], expected [realco] (#3510)`);

  // 2. scan-runs.tsv is written where stats.mjs:36 reads it. A writer and a
  //    reader naming different files is not a lost row, it is a wrong number.
  inChild(`
    const m = await import(${scanUrl});
    m.appendScanRunSummary({ companies: 1, boards: 1, found: 0 });
  `);
  const runsAtRoot = join(dataRoot, 'data', 'scan-runs.tsv');
  const runsAtCwd = join(decoyCwd, 'data', 'scan-runs.tsv');
  existsSync(runsAtRoot) && !existsSync(runsAtCwd)
    ? pass('appendScanRunSummary() writes under the data root, where stats.mjs reads')
    : fail(`scan-runs.tsv landed wrong — root:${existsSync(runsAtRoot)} cwd:${existsSync(runsAtCwd)} (#3510)`);

  // 3. The ATS sweep's resume checkpoint. Reading the cwd's copy means a
  //    multi-hour sweep resumed from another directory restarts from zero — the
  //    one failure --resume exists to prevent.
  const checkpoint = (tag) => JSON.stringify({ version: 1, current: null, tag });
  writeFileSync(join(dataRoot, 'data', 'cache', 'ats-full-checkpoint.json'), checkpoint('data-root'), 'utf-8');
  writeFileSync(join(decoyCwd, 'data', 'cache', 'ats-full-checkpoint.json'), checkpoint('cwd'), 'utf-8');
  const tag = inChild(`
    const m = await import(${atsUrl});
    console.log(m.loadCheckpoint()?.tag ?? 'none');
  `);
  tag === 'data-root'
    ? pass('loadCheckpoint() resumes from the data root’s checkpoint')
    : fail(`loadCheckpoint() read the ${tag} checkpoint — a resume would restart or resume the wrong sweep (#3510)`);

  // 4. The sibling scanners must not re-derive paths they write to through
  //    scan.mjs. Importing one and comparing the resolved constants is the only
  //    check that stays true as the files move around.
  const shared = inChild(`
    const scan = await import(${scanUrl});
    const ats = await import(${atsUrl});
    console.log(JSON.stringify({ pipeline: scan.PIPELINE_PATH, portals: scan.PORTALS_PATH }));
  `);
  const paths = JSON.parse(shared);
  // Undefined means the export is missing entirely — a sibling re-deriving its
  // own copy. Checked rather than dereferenced, so a regression here reports
  // itself instead of aborting the checks below.
  typeof paths.pipeline === 'string' && typeof paths.portals === 'string'
    && paths.pipeline.startsWith(dataRoot) && paths.portals.startsWith(dataRoot)
    ? pass('scan.mjs exports pipeline/portals paths anchored to the data root')
    : fail(`scan.mjs does not export pipeline/portals paths under the data root: ${shared}`);

  // 5. scan-interamt.mjs must not scan the internet just because it was
  //    imported. It called main() unguarded, so importing it drove a live
  //    browser scan and appended the results to the user's pipeline.
  const interamtSrc = readFileSync(join(ROOT, 'scan-interamt.mjs'), 'utf-8');
  /isMainModule\(import\.meta\.url\)/.test(interamtSrc)
    ? pass('scan-interamt.mjs runs its scan behind a main guard, like its siblings')
    : fail('scan-interamt.mjs calls main() at module scope — importing it starts a live scan (#3510)');

  // 6. No scanner may reintroduce a bare-relative user-data path. The behavioral
  //    checks above cover today's constants; this covers the next one added.
  const offenders = [];
  for (const file of ['scan.mjs', 'scan-ats-full.mjs', 'scan-interamt.mjs', 'scan-hn.mjs']) {
    const src = readFileSync(join(ROOT, file), 'utf-8');
    for (const m of src.matchAll(/^(?:export )?const\s+(\w+)\s*=\s*'((?:data|output)\/[^']*|portals\.yml)'/gm)) {
      offenders.push(`${file}: ${m[1]} = '${m[2]}'`);
    }
  }
  offenders.length === 0
    ? pass('no scanner declares a bare cwd-relative user-data path')
    : fail(`cwd-relative user-data path(s) reintroduced (#3510): ${offenders.join('; ')}`);
} catch (e) {
  fail(`scan data-path suite crashed: ${e.message}`);
} finally {
  rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  rmSync(decoyCwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
