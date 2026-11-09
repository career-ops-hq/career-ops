/** Ignored local files must receive the same preservation as other untracked files. */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, hermeticGitRunner, rmSync } from './helpers.mjs';
import { locallyModifiedSystemFiles, backupSystemFiles } from '../update-system.mjs';

// Exercise all Git ignore sources; global ignores are scoped to the fixture.
for (const ignoreSource of ['gitignore', 'info-exclude', 'global-exclude']) {
  const dir = mkdtempSync(join(tmpdir(), 'co-ignored-collision-'));
  try {
    const g = hermeticGitRunner(dir, { stdio: ['pipe', 'pipe', 'pipe'] });
    g('init', '-q', '-b', 'main', '.');
    g('config', 'user.email', 'test@example.com');
    g('config', 'user.name', 'Test');
    g('config', 'core.autocrlf', 'false');
    mkdirSync(join(dir, 'modes'));
    writeFileSync(join(dir, 'modes/existing.md'), 'base\n');
    g('add', '-A');
    g('commit', '-qm', 'base');
    g('checkout', '-q', '-b', 'upstream');
    writeFileSync(join(dir, 'modes/incoming.md'), 'upstream incoming\n');
    writeFileSync(join(dir, 'modes/ordinary.md'), 'upstream ordinary\n');
    writeFileSync(join(dir, 'modes/existing.md'), 'upstream existing\n');
    g('add', '-A');
    g('commit', '-qm', 'upstream adds files');
    g('checkout', '-q', 'main');

    const ignoreFile = ignoreSource === 'gitignore' ? '.gitignore'
      : ignoreSource === 'info-exclude' ? '.git/info/exclude'
        : '.git/global-exclude';
    writeFileSync(join(dir, ignoreFile), 'modes/incoming.md\nmodes/private.md\n');
    if (ignoreSource === 'global-exclude') g('config', 'core.excludesFile', join(dir, ignoreFile));
    const local = 'local customization with no committed copy\n';
    writeFileSync(join(dir, 'modes/incoming.md'), local);
    writeFileSync(join(dir, 'modes/ordinary.md'), 'ordinary local customization\n');
    writeFileSync(join(dir, 'modes/private.md'), 'purely local file\n');

    // Establish the loss oracle: the same raw checkout used by apply ignores
    // the ignore rule and replaces the only local copy without prompting.
    g('check-ignore', 'modes/incoming.md');
    g('checkout', 'upstream', '--', 'modes/incoming.md');
    if (readFileSync(join(dir, 'modes/incoming.md'), 'utf-8') === 'upstream incoming\n') {
      pass(`${ignoreSource}: raw update checkout overwrites the ignored local file`);
    } else {
      fail(`${ignoreSource}: fixture did not reproduce the overwrite`);
    }
    g('rm', '-f', '--', 'modes/incoming.md');
    writeFileSync(join(dir, 'modes/incoming.md'), local);

    const ctx = { git: g, root: dir };
    const atRisk = locallyModifiedSystemFiles(['modes/'], 'upstream', ctx);
    if (JSON.stringify(atRisk) === JSON.stringify(['modes/incoming.md', 'modes/ordinary.md'])) {
      pass(`${ignoreSource}: both untracked collisions are detected, purely local files are excluded`);
    } else {
      fail(`${ignoreSource}: expected both collisions, got ${JSON.stringify(atRisk)}`);
    }

    // Use apply's actual backup and exclusion behavior against the fixture.
    backupSystemFiles(atRisk, ctx);
    g('checkout', 'upstream', '--', 'modes/', ...atRisk.map(file => `:(exclude)${file}`));
    const backup = join(dir, 'modes/incoming.md.bak');
    if (readFileSync(join(dir, 'modes/incoming.md'), 'utf-8') === local
      && existsSync(backup) && readFileSync(backup, 'utf-8') === local
      && readFileSync(join(dir, 'modes/existing.md'), 'utf-8') === 'upstream existing\n'
      && readFileSync(join(dir, 'modes/private.md'), 'utf-8') === 'purely local file\n') {
      pass(`${ignoreSource}: update preserves and backs up the collision while refreshing other files`);
    } else {
      fail(`${ignoreSource}: update lost the ignored customization or failed to refresh ordinary files`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
