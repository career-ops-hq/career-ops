import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import dotenv from 'dotenv';

export const AGENT_CLIS = ['claude', 'codex', 'opencode', 'pi', 'antigravity', 'grok', 'qwen', 'kimi', 'copilot', 'gemini', 'hermes'];

/**
 * The agent CLI the user chose: CAREER_OPS_CLI from the shell, else from the
 * data root's .env. Reads .env without loading it into process.env.
 *
 * @param {string} root
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string|null}
 */
export function readRememberedCli(root, env = process.env) {
  if (env.CAREER_OPS_CLI) return env.CAREER_OPS_CLI;
  const file = join(root, '.env');
  if (!existsSync(file)) return null;
  return dotenv.parse(readFileSync(file, 'utf8')).CAREER_OPS_CLI || null;
}
