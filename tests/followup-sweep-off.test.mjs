#!/usr/bin/env node
/**
 * scripts/followup-sweep.sh must exit before starting an agent when
 * follow_ups.enabled is false. Otherwise a launchd job still spends a Claude
 * run that only writes "follow-ups are off".
 *
 * It runs two ways, so both are checked: the launchd recipe passes the script
 * to `/bin/zsh -l`, and the cron recipe executes it directly, through its
 * shebang. The direct run is what proves the script works without zsh.
 *
 * Run: node test-all.mjs --only followup-sweep-off
 */

import { spawnSync } from 'child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, ROOT, rmSync } from './helpers.mjs';

console.log('\nfollowup-sweep.sh honors follow_ups.enabled: false');

const sweep = join(ROOT, 'scripts', 'followup-sweep.sh');

function checkOffRun(label, command, args) {
  const dir = mkdtempSync(join(tmpdir(), 'co-followup-sweep-'));
  try {
    mkdirSync(join(dir, 'data'));
    mkdirSync(join(dir, 'config'));
    mkdirSync(join(dir, 'output'));
    // An empty ZDOTDIR keeps the developer's own .zshenv/.zprofile out of the
    // login-shell run, so the result doesn't depend on whose machine it is.
    mkdirSync(join(dir, 'zdotdir'));
    writeFileSync(join(dir, 'data', 'applications.md'), [
      '# Applications Tracker',
      '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|------|---------|------|-------|--------|-----|--------|-------|',
      '| 1 | 2026-01-05 | Acme | Engineer | 4.0/5 | Applied | ❌ | — | Applied 2026-01-05 |',
      '',
    ].join('\n'));
    writeFileSync(join(dir, 'config', 'profile.yml'), 'follow_ups:\n  enabled: false\n');

    const bin = join(dir, 'bin');
    mkdirSync(bin);
    const claudeStub = join(bin, 'claude');
    writeFileSync(claudeStub, '#!/bin/sh\necho CLAUDE_RAN > "$CAREER_OPS_ROOT/output/claude-ran"\nexit 0\n');
    chmodSync(claudeStub, 0o755);

    const result = spawnSync(command, args, {
      cwd: ROOT,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        CAREER_OPS_ROOT: dir,
        CAREER_OPS_TRACKER: join(dir, 'data', 'applications.md'),
        CAREER_OPS_FOLLOWUPS: join(dir, 'data', 'follow-ups.md'),
        CAREER_OPS_PROFILE: join(dir, 'config', 'profile.yml'),
        ZDOTDIR: join(dir, 'zdotdir'),
      },
      encoding: 'utf8',
      timeout: 30000,
    });

    if (result.status === 0) pass(`${label}: sweep exits 0 when follow-ups are off`);
    else fail(`${label}: sweep exit ${result.status} error=${result.error}: ${result.stdout}\n${result.stderr}`);

    if (!existsSync(join(dir, 'output', 'claude-ran'))) {
      pass(`${label}: sweep does not start claude when follow-ups are off`);
    } else {
      fail(`${label}: sweep started claude even though follow-ups are off`);
    }

    const log = existsSync(join(dir, 'data', 'followup-sweep.log'))
      ? readFileSync(join(dir, 'data', 'followup-sweep.log'), 'utf8')
      : '';
    if (/turned off|follow_ups\.enabled/i.test(log)) {
      pass(`${label}: sweep log records that follow-ups are off`);
    } else {
      fail(`${label}: sweep log did not mention follow-ups are off.\nstdout=${result.stdout}\nstderr=${result.stderr}\nlog=${log}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const zshProbe = spawnSync('zsh', ['-c', 'exit 0'], { encoding: 'utf8' });
if (zshProbe.error?.code === 'ENOENT') {
  pass('zsh run skipped: zsh is not available (the launchd recipe is macOS-only)');
} else if (zshProbe.error || zshProbe.status !== 0) {
  fail(`zsh probe failed before the sweep could run: error=${zshProbe.error} status=${zshProbe.status} stderr=${zshProbe.stderr}`);
} else {
  // -l as in the launchd recipe's ProgramArguments (/bin/zsh -l <script>).
  checkOffRun('zsh -l (launchd)', 'zsh', ['-l', sweep]);
}

// Windows can't execute a script through its shebang; the sweep's recipes
// are launchd and cron.
if (process.platform === 'win32') {
  pass('direct run skipped: Windows does not execute scripts by shebang');
} else {
  checkOffRun('direct (cron)', sweep, []);
}
