#!/usr/bin/env node
/**
 * scripts/followup-sweep.sh runs `claude -p` unattended. Headless Claude Code
 * denies every tool call that would need approval, so a bare `claude -p`
 * could not run followup-cadence.mjs or write the draft file, and the sweep
 * left no drafts behind. The script must grant exactly those calls, and must
 * not grant the scripts that record a follow-up as sent.
 *
 * Run: node test-all.mjs --only followup-sweep-permissions
 */

import { spawnSync } from 'child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, ROOT, rmSync } from './helpers.mjs';

// The sweep names its draft file with `date +%Y-%m-%d`, the local calendar day.
const localDate = (d = new Date()) => [
  d.getFullYear(),
  String(d.getMonth() + 1).padStart(2, '0'),
  String(d.getDate()).padStart(2, '0'),
].join('-');

console.log('\nfollowup-sweep.sh grants the tools the headless run needs');

const zshProbe = spawnSync('zsh', ['-c', 'exit 0'], { encoding: 'utf8' });
if (zshProbe.error?.code === 'ENOENT') {
  pass('sweep permission check skipped: zsh is not available (launchd sweep is macOS-only)');
} else if (zshProbe.error || zshProbe.status !== 0) {
  fail(`zsh probe failed before the sweep could run: error=${zshProbe.error} status=${zshProbe.status} stderr=${zshProbe.stderr}`);
} else {
  const dir = mkdtempSync(join(tmpdir(), 'co-followup-sweep-perms-'));
  try {
    mkdirSync(join(dir, 'data'));
    mkdirSync(join(dir, 'config'));
    writeFileSync(join(dir, 'data', 'applications.md'), [
      '# Applications Tracker',
      '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|------|---------|------|-------|--------|-----|--------|-------|',
      '| 1 | 2026-01-05 | Acme | Engineer | 4.0/5 | Applied | ❌ | — | Applied 2026-01-05 |',
      '',
    ].join('\n'));
    writeFileSync(join(dir, 'config', 'profile.yml'), 'follow_ups:\n  enabled: true\n');

    // The stub records its argv one per line and writes no draft, so the
    // sweep's macOS notification never fires.
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    const argvFile = join(dir, 'claude-argv');
    writeFileSync(join(bin, 'claude'), `#!/bin/sh\nprintf '%s\\n' "$@" > '${argvFile}'\nexit 0\n`);
    chmodSync(join(bin, 'claude'), 0o755);

    const sweep = join(ROOT, 'scripts', 'followup-sweep.sh');
    const dayBefore = localDate();
    const result = spawnSync('zsh', [sweep], {
      cwd: ROOT,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        CAREER_OPS_ROOT: dir,
        CAREER_OPS_TRACKER: join(dir, 'data', 'applications.md'),
        CAREER_OPS_FOLLOWUPS: join(dir, 'data', 'follow-ups.md'),
        CAREER_OPS_PROFILE: join(dir, 'config', 'profile.yml'),
      },
      encoding: 'utf8',
      timeout: 30000,
    });
    const dayAfter = localDate();

    if (result.status === 0) pass('sweep exits 0 with follow-ups on');
    else fail(`sweep exit ${result.status}: ${result.stdout}\n${result.stderr}`);

    if (!existsSync(argvFile)) {
      fail(`sweep did not start claude.\nstdout=${result.stdout}\nstderr=${result.stderr}`);
    } else {
      // printf ends every argument with a newline, so drop the empty tail.
      const argv = readFileSync(argvFile, 'utf8').replace(/\n$/, '').split('\n');
      const after = (flag) => {
        const i = argv.indexOf(flag);
        if (i === -1) return [];
        const values = [];
        for (const arg of argv.slice(i + 1)) {
          if (arg.startsWith('--')) break;
          values.push(arg);
        }
        return values;
      };
      const sorted = (list) => [...list].sort();
      const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

      if (argv[0] === '-p') pass('claude runs headless (-p)');
      else fail(`claude argv did not start with -p: ${JSON.stringify(argv.slice(0, 2))}`);

      if (same(after('--permission-mode'), ['dontAsk'])) pass('--permission-mode dontAsk overrides an inherited acceptEdits/auto default');
      else fail(`expected --permission-mode dontAsk: ${JSON.stringify(after('--permission-mode'))}`);

      if (same(after('--add-dir'), [dir])) pass('--add-dir names the data root');
      else fail(`--add-dir does not name only the data root ${dir}: ${JSON.stringify(after('--add-dir'))}`);

      // The complete allow list: the four read-only scripts and one write,
      // to today's draft file. `//` anchors a permission path at the
      // filesystem root; a single `/` would anchor it at the working directory.
      // Either day is accepted in case the run straddles midnight.
      const readOnly = [
        'Bash(node followup-cadence.mjs *)',
        'Bash(node funnel-velocity.mjs *)',
        'Bash(node rejection-latency.mjs *)',
        'Bash(node company-history.mjs *)',
      ];
      const allowed = after('--allowedTools');
      const expectedFor = (day) => [...readOnly, `Edit(/${join(dir, 'output', `followup-drafts-${day}.md`)})`];
      if (same(allowed, expectedFor(dayBefore)) || same(allowed, expectedFor(dayAfter))) {
        pass('--allowedTools is exactly the four read-only scripts and today\'s draft file');
      } else {
        fail(`--allowedTools ${JSON.stringify(allowed)} != ${JSON.stringify(expectedFor(dayBefore))}`);
      }

      // Deny rules beat any allow rule, the user's own included.
      const denied = after('--disallowedTools');
      const expectedDenied = [
        'Bash(node set-status.mjs *)',
        'Bash(node followup-seed.mjs *)',
        `Edit(/${join(dir, 'data')}/**)`,
      ];
      if (same(denied, expectedDenied)) pass('--disallowedTools blocks recording a follow-up and editing the data folder');
      else fail(`--disallowedTools ${JSON.stringify(denied)} != ${JSON.stringify(expectedDenied)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
