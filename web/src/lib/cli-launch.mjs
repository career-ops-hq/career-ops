import fs from "node:fs";
import path from "node:path";

/**
 * Prepare a CLI process without routing user-controlled prompts through a shell.
 *
 * npm installs an extensionless POSIX shim plus `.cmd` and `.ps1` wrappers on
 * Windows. `findBin()` can discover the extensionless shim, but CreateProcess
 * cannot execute it (`ENOENT`); `.cmd` also requires a shell (`EINVAL`). npm's
 * generated PowerShell wrapper names the real JS/native entrypoint immediately
 * before `$args`. Resolve that trusted local target and spawn it directly, so
 * prompts keep their argument boundaries without `shell: true` or PowerShell's
 * lossy `-File` argument conversion.
 *
 * @param {string} binPath
 * @param {string[]} args
 * @param {string} [platform]
 * @returns {{ command: string, args: string[] }}
 */
export function prepareCliLaunch(binPath, args, platform = process.platform) {
  if (platform !== "win32") return { command: binPath, args };

  const ext = path.extname(binPath).toLowerCase();
  if (ext && ![".cmd", ".bat", ".ps1"].includes(ext)) return { command: binPath, args };

  const shimBase = ext ? binPath.slice(0, -ext.length) : binPath;
  const ps1Shim = `${shimBase}.ps1`;
  if (!fs.existsSync(ps1Shim)) return { command: binPath, args };

  let wrapper = "";
  try {
    wrapper = fs.readFileSync(ps1Shim, "utf8");
  } catch {
    return { command: binPath, args };
  }

  const targetMatches = wrapper.matchAll(/["']\$basedir[\\/]([^"']+)["']\s+\$args/g);
  for (const match of targetMatches) {
    const target = path.resolve(path.dirname(ps1Shim), match[1].replace(/[\\/]/g, path.sep));
    if (!fs.existsSync(target)) continue;
    const targetExt = path.extname(target).toLowerCase();
    if ([".js", ".cjs", ".mjs"].includes(targetExt)) {
      return { command: process.execPath, args: [target, ...args] };
    }
    if ([".exe", ".com"].includes(targetExt)) {
      return { command: target, args };
    }
  }

  return { command: binPath, args };
}
