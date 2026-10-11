// Regression coverage for root scaffold negations matching user data at deeper
// paths (and for updater-managed installs that retain their old patterns).
import { execFileSync, spawnSync } from 'child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { fail, pass, ROOT } from './helpers.mjs';

const userDirectories = ['jds', 'output', 'documents', 'interview-prep'];
const canonicalIgnore = readFileSync(join(ROOT, '.gitignore'), 'utf8');
const legacyIgnore = canonicalIgnore.replace(
  /^!\/(data|output|jds|interview-prep|documents)\/$/gm,
  '!$1/',
);

function checkIgnored(root, file) {
  const result = spawnSync('git', ['-C', root, 'check-ignore', '--quiet', file], { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`git check-ignore failed for ${file}: ${result.stderr || result.status}`);
  }
  return result.status === 0;
}

function verifyIgnoreRules(label, contents) {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-gitignore-'));
  try {
    writeFileSync(join(root, '.gitignore'), contents);
    execFileSync('git', ['init', '--quiet', root]);

    for (const name of userDirectories) {
      const userFile = `data/${name}/private.md`;
      const userFilePath = join(root, userFile);
      mkdirSync(join(root, 'data', name), { recursive: true });
      writeFileSync(userFilePath, 'synthetic user data');
      if (checkIgnored(root, userFile)) pass(`${label}: ${userFile} stays ignored`);
      else fail(`${label}: ${userFile} is visible to git`);

      const scaffold = `${name}/.gitkeep`;
      const scaffoldPath = join(root, scaffold);
      mkdirSync(join(root, name), { recursive: true });
      writeFileSync(scaffoldPath, '');
      if (!checkIgnored(root, scaffold)) pass(`${label}: ${scaffold} remains available to track`);
      else fail(`${label}: ${scaffold} is ignored`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

try {
  verifyIgnoreRules('fresh checkout', canonicalIgnore);
  verifyIgnoreRules('legacy updater install', legacyIgnore);
} catch (error) {
  fail(`nested user-data ignore checks crashed: ${error.stack || error.message}`);
}
