// How the core starts an agent CLI. Kept apart from lib/agent-cli.mjs, which
// loads dotenv, so a script that only launches a CLI (batch-tailor.mjs) needs
// no npm package to do it.
import { statSync } from 'fs';
import { extname, join, win32 } from 'path';
import { prepareCliLaunch } from './cli-launch.mjs';

const WIN_EXTS = ['.com', '.exe', '.bat', '.cmd'];

// Find `bin` the way cmd.exe does: each PATH directory in order, each PATHEXT
// extension in order. A name with a directory in it is taken as given.
function findOnWindowsPath(bin, env) {
  const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
  if (/[\\/]/.test(bin)) return isFile(bin) ? bin : null;
  const exts = (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';')
    .map(e => e.trim().toLowerCase()).filter(e => WIN_EXTS.includes(e));
  const names = WIN_EXTS.includes(extname(bin).toLowerCase()) ? [bin] : exts.map(e => bin + e);
  // win32.delimiter, not the host's: the test simulates Windows on POSIX too.
  for (const dir of (env.PATH ?? env.Path ?? '').split(win32.delimiter).filter(Boolean)) {
    for (const name of names) {
      if (isFile(join(dir, name))) return join(dir, name);
    }
  }
  return null;
}

/**
 * The command and argv that run `bin` with `args`.
 *
 * On Windows an npm-installed CLI is a `.cmd` shim (with a `.ps1` and an
 * extensionless POSIX script beside it). execFileSync('codex') runs none of
 * them: CreateProcess only adds `.exe`, and a `.cmd` needs a shell, which would
 * split the prompt at its spaces and run whatever follows an `&` in a posting
 * as a command. So the binary is found on PATH and the `.js` or `.exe` the shim
 * wraps is launched directly, as the web UI does (lib/cli-launch.mjs is a copy
 * of web/src/lib/cli-launch.mjs). Elsewhere the bare name is passed through.
 *
 * @param {string} bin
 * @param {string[]} args
 * @param {{platform?: string, env?: NodeJS.ProcessEnv}} [opts]
 * @returns {{command: string, args: string[]}}
 */
export function resolveCliLaunch(bin, args, { platform = process.platform, env = process.env } = {}) {
  if (platform !== 'win32') return { command: bin, args };
  const found = findOnWindowsPath(bin, env);
  if (!found) return { command: bin, args };
  try {
    return prepareCliLaunch(found, args, platform);
  } catch (err) {
    err.code = 'ERR_CLI_LAUNCH';
    throw err;
  }
}
