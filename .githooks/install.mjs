#!/usr/bin/env node
/**
 * .githooks/install.mjs — `npm run hooks:install` (#6535).
 *
 * Points this clone's core.hooksPath at .githooks/. An existing value is left
 * alone unless you pass --force: replacing it would stop whatever hooks it
 * names from running, and `git config --unset core.hooksPath` cannot bring the
 * old value back. With --force the old value is printed, so you can restore it.
 */

import { spawnSync } from 'node:child_process';
import { validateFlags } from '../lib/cli-flags.mjs';
import { isMainModule } from '../lib/is-main-module.mjs';

export const HOOKS_PATH = '.githooks';

const USAGE = `Usage: npm run hooks:install [-- --force]

Sets core.hooksPath to ${HOOKS_PATH} for this clone, so git runs the
career-ops pre-commit checks. Refuses to replace an existing core.hooksPath
unless you pass --force.

Turn the hook off again with: git config --unset core.hooksPath`;

/**
 * What to do, given the current core.hooksPath.
 *
 * @param {string|null} current - The effective value, or null when unset.
 * @param {boolean} force
 * @returns {{action: 'set'|'keep'|'refuse', message: string}}
 */
export function planInstall(current, force) {
  if (current === HOOKS_PATH) {
    return { action: 'keep', message: `core.hooksPath is already ${HOOKS_PATH}; nothing to do.` };
  }
  if (current && !force) {
    return {
      action: 'refuse',
      message:
        `core.hooksPath is already set to "${current}", and replacing it would stop those hooks running.\n` +
        'Rerun with `npm run hooks:install -- --force` to replace it anyway.',
    };
  }
  return {
    action: 'set',
    message: current
      ? `core.hooksPath set to ${HOOKS_PATH}. It was "${current}"; restore it with: git config core.hooksPath "${current}"`
      : `core.hooksPath set to ${HOOKS_PATH}. Turn it off with: git config --unset core.hooksPath`,
  };
}

function main() {
  const args = process.argv.slice(2);
  validateFlags(args, ['--force', '--help', '-h'], USAGE, { usageExitCode: 2 });

  // Without --local, so a global or system value counts too: a local setting
  // would override it just the same.
  const got = spawnSync('git', ['config', '--get', 'core.hooksPath'], { encoding: 'utf-8' });
  if (got.error) {
    console.error(`hooks:install: could not run git: ${got.error.message}`);
    process.exit(1);
  }
  // Exit 1 means the key is unset; anything else is git failing.
  if (got.status !== 0 && got.status !== 1) {
    console.error(`hooks:install: git config failed: ${got.stderr.trim()}`);
    process.exit(1);
  }
  const current = got.status === 0 ? got.stdout.trim() : null;

  const plan = planInstall(current, args.includes('--force'));
  if (plan.action === 'refuse') {
    console.error(plan.message);
    process.exit(1);
  }
  if (plan.action === 'set') {
    const set = spawnSync('git', ['config', 'core.hooksPath', HOOKS_PATH], { encoding: 'utf-8' });
    if (set.status !== 0) {
      console.error(`hooks:install: git config failed: ${(set.stderr || set.error?.message || '').trim()}`);
      process.exit(1);
    }
  }
  console.log(plan.message);
}

if (isMainModule(import.meta.url)) main();
