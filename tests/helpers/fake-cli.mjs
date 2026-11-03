// A fake agent CLI, installed the way the scripts that start one meet a real
// one. Elsewhere that is an executable script with a node shebang. On Windows
// it is what npm leaves in its global bin directory: <bin>.cmd, <bin>.ps1 and
// the script they wrap. rank-pipeline.mjs and batch-tailor.mjs launch that
// script through resolveCliLaunch() (lib/agent-launch.mjs), so a suite built on
// this runs on Windows too.
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';

/**
 * Write a fake CLI named `bin` into `dir`.
 *
 * @param {string} dir - The directory that goes first on PATH.
 * @param {string} bin - The command name the ranker is given (`--cli <bin>`).
 * @param {string} body - The CLI's JavaScript (CommonJS).
 * @returns {string} The file that holds `body`.
 */
export function writeFakeCli(dir, bin, body) {
  if (process.platform !== 'win32') {
    const file = join(dir, bin);
    writeFileSync(file, `#!${process.execPath}\n${body}`);
    chmodSync(file, 0o755);
    return file;
  }
  const script = join(dir, 'node_modules', `fake-${bin}`, 'cli.js');
  mkdirSync(dirname(script), { recursive: true });
  writeFileSync(script, body);
  writeFileSync(join(dir, `${bin}.cmd`), `@ECHO off\r\n"%~dp0\\node.exe" "%~dp0\\node_modules\\fake-${bin}\\cli.js" %*\r\n`);
  writeFileSync(join(dir, `${bin}.ps1`), [
    '#!/usr/bin/env pwsh',
    '$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent',
    `& "$basedir/node$exe"  "$basedir/node_modules/fake-${bin}/cli.js" $args`,
    'exit $LASTEXITCODE',
    '',
  ].join('\n'));
  return script;
}

/**
 * This process's environment with `dir` first on PATH, plus `extra`.
 *
 * On Windows the inherited block spells the variable Path. Adding PATH next to
 * it gives the child two spellings, and which one it reads is left to chance,
 * so every spelling is dropped and one PATH is written.
 *
 * @param {string} dir
 * @param {Record<string, string>} [extra]
 * @returns {NodeJS.ProcessEnv}
 */
export function envWithPathFirst(dir, extra = {}) {
  return { ...withoutPath(), PATH: `${dir}${delimiter}${process.env.PATH ?? ''}`, ...extra };
}

/**
 * This process's environment with PATH set to `dir` alone, plus `extra`: for a
 * suite that stubs the spawn and must not find a real CLI on the machine.
 *
 * @param {string} dir
 * @param {Record<string, string>} [extra]
 * @returns {NodeJS.ProcessEnv}
 */
export function envWithPathOnly(dir, extra = {}) {
  return { ...withoutPath(), PATH: dir, ...extra };
}

function withoutPath() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^path$/i.test(key)));
}
