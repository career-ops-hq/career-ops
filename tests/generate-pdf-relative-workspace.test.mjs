// Relative PDF paths follow the tracker workspace when the current directory
// is somewhere else. Cover letters already map --out output/<file> onto the
// data root. A path that already lands inside the workspace still keeps the
// current directory, so a launch from the repo itself is unchanged.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NODE, ROOT, fail, ownRootEnv, pass } from './helpers.mjs';

const html = '<!doctype html>\n<html><body><main><h1>Avery Quinn</h1><p>Analytics engineer.</p></main></body></html>\n';

function render(args, cwd, dataRoot) {
  return spawnSync(NODE, [join(ROOT, 'generate-pdf.mjs'), ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 30_000,
    env: ownRootEnv({
      CAREER_OPS_ROOT: dataRoot,
      CAREER_OPS_TRACKER: '',
      CAREER_OPS_PROFILE: '',
      CAREER_OPS_PDF_INDEX: '',
    }),
  });
}

function combined(result) {
  return `${result.stdout || ''}${result.stderr || ''}`;
}

const dir = mkdtempSync(join(tmpdir(), 'career-ops-pdf-rel-'));
const dataRoot = join(dir, 'data');
const decoy = join(dir, 'decoy');
mkdirSync(join(dataRoot, 'output'), { recursive: true });
mkdirSync(join(dataRoot, 'data'), { recursive: true });
mkdirSync(decoy, { recursive: true });
writeFileSync(join(dataRoot, 'data', 'applications.md'), '# Applications Tracker\n', 'utf8');
writeFileSync(join(dataRoot, 'output', 'cv.html'), html, 'utf8');

let failures = 0;
function check(label, fn) {
  try {
    fn();
    pass(label);
  } catch (err) {
    fail(`${label}: ${err.message}`);
    failures++;
  }
}

try {
  const outside = render(['output/cv.html', 'output/cv.pdf'], decoy, dataRoot);
  const outsideText = combined(outside);
  check('relative output/cv.html from outside the workspace reads the data root', () => {
    if (/escapes the tracker workspace/.test(outsideText)) {
      throw new Error(outsideText.trim().slice(0, 500));
    }
    const inputLine = outsideText.split('\n').find((line) => line.includes('Input:'));
    if (!inputLine || !inputLine.includes(join(dataRoot, 'output', 'cv.html'))) {
      throw new Error(`input was not the workspace file:\n${outsideText.trim().slice(0, 500)}`);
    }
    const outputLine = outsideText.split('\n').find((line) => line.includes('Output:'));
    if (!outputLine || !outputLine.includes(join(dataRoot, 'output', 'cv.pdf'))) {
      throw new Error(`output was not the workspace file:\n${outsideText.trim().slice(0, 500)}`);
    }
    if (outside.status !== 0) {
      if (!/browser|chromium|playwright|executable|Failed to launch/i.test(outsideText)) {
        throw new Error(`render failed before the browser:\n${outsideText.trim().slice(0, 500)}`);
      }
    } else if (!existsSync(join(dataRoot, 'output', 'cv.pdf'))) {
      throw new Error('PDF was not written under the data root output/');
    }
    if (existsSync(join(decoy, 'output', 'cv.pdf')) || existsSync(join(decoy, 'cv.pdf'))) {
      throw new Error('PDF was written into the current directory');
    }
  });
} finally {
  rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
}

if (failures) process.exitCode = 1;
