#!/usr/bin/env node
/**
 * remember-cli.mjs — record the agent CLI this install runs in.
 *
 *   node remember-cli.mjs <cli>
 *
 * Writes CAREER_OPS_CLI=<cli> to the data root's .env. doctor, rank-pipeline
 * and the web UI read it, so they all use the CLI the user set up in.
 */
import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { AGENT_CLIS } from './lib/agent-cli.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { writeFileAtomic } from './tracker-utils.mjs';

/**
 * Set CAREER_OPS_CLI in the data root's .env, keeping every other line and the
 * file's mode. The write is atomic, so an interrupted run never loses the rest
 * of .env.
 *
 * @param {string} root
 * @param {string} cli
 */
export function rememberCli(root, cli) {
  if (!AGENT_CLIS.includes(cli)) throw new Error(`"${cli}" is not a supported CLI. Use one of: ${AGENT_CLIS.join(', ')}.`);
  const file = join(root, '.env');
  const exists = existsSync(file);
  const lines = exists ? readFileSync(file, 'utf8').split('\n') : [];
  if (lines.at(-1) === '') lines.pop();
  const kept = lines.filter((line) => !/^\s*(?:export\s+)?CAREER_OPS_CLI\s*=/.test(line));
  const mode = exists ? statSync(file).mode & 0o777 : undefined;
  writeFileAtomic(file, [...kept, `CAREER_OPS_CLI=${cli}`, ''].join('\n'), { mode });
}

const USAGE = `Usage: node remember-cli.mjs <cli>
CLIs: ${AGENT_CLIS.join(', ')}`;

export function main(argv = process.argv.slice(2)) {
  if (argv.length !== 1 || argv[0] === '--help' || argv[0] === '-h') {
    console.log(USAGE);
    return argv.length === 1 ? 0 : 1;
  }
  try {
    rememberCli(getCareerOpsRoot(), argv[0]);
  } catch (err) {
    console.error(err.message);
    return 1;
  }
  console.log(`Remembered ${argv[0]} as your agent CLI in .env.`);
  return 0;
}

if (isMainModule(import.meta.url)) process.exitCode = main();
