// scan.mjs prints a timestamped progress line on stderr every 25 sources, and
// after the last one, so a long --quiet or --json run is visibly alive.
import { pass, fail, ROOT, NODE, rmSync } from './helpers.mjs';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

console.log('\nscan: stderr progress line');

const SCAN = join(ROOT, 'scan.mjs');
const PARSER = join(ROOT, 'tests', 'fixtures', 'noc-board.mjs');

function scan(companyCount, flags) {
  const dir = mkdtempSync(join(tmpdir(), 'co-scan-progress-'));
  try {
    mkdirSync(join(dir, 'data'));
    const companies = Array.from({ length: companyCount }, (_, i) => [
      `  - name: Fabrikam Unit ${i + 1}`,
      `    careers_url: https://unit${i + 1}.example.invalid/jobs`,
      '    parser:',
      '      command: node',
      `      script: ${JSON.stringify(PARSER)}`,
    ].join('\n')).join('\n');
    const portals = join(dir, 'portals.yml');
    writeFileSync(portals, `title_filter:\n  positive:\n    - "Engineer"\ntracked_companies:\n${companies}\njob_boards: []\n`);
    return spawnSync(NODE, [SCAN, '--dry-run', ...flags], {
      cwd: dir,
      env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_PORTALS: portals },
      encoding: 'utf-8',
      timeout: 120_000,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const LINE = /^\[\d{2}:\d{2}:\d{2}\] scan: (\d+)\/(\d+) sources done$/gm;

function progress(stderr) {
  return [...stderr.matchAll(LINE)].map(m => `${m[1]}/${m[2]}`);
}

{
  const run = scan(30, ['--quiet']);
  const seen = progress(run.stderr);
  if (run.status === 0 && seen.join(',') === '25/30,30/30' && !/sources done/.test(run.stdout)) {
    pass('--quiet still reports progress every 25 sources and at the end');
  } else {
    fail(`--quiet progress: status ${run.status}, lines ${JSON.stringify(seen)}\n${run.stderr.slice(-400)}`);
  }
}

{
  const run = scan(3, ['--json']);
  let receipt = null;
  try { receipt = JSON.parse(run.stdout).version; } catch { /* reported below */ }
  const seen = progress(run.stderr);
  if (run.status === 0 && receipt === 'careerops.scan.receipt@1' && seen.join(',') === '3/3') {
    pass('--json keeps stdout to the receipt and reports progress on stderr');
  } else {
    fail(`--json progress: status ${run.status}, receipt ${receipt}, lines ${JSON.stringify(seen)}\n${run.stderr.slice(-400)}`);
  }
}
