import fs from "node:fs";
import path from "node:path";

export const CODEX_WINDOWS_LAUNCH_ERROR = "Codex CLI could not be launched on Windows. A codex.cmd, codex.exe, or runnable codex.ps1 launcher was not found.";

export function cliBinCandidates(bin, { platform = process.platform, pathext = process.env.PATHEXT } = {}) {
  if (platform !== "win32") return [bin];
  if (bin.toLowerCase() === "codex") return ["codex.cmd", "codex.exe", "codex.ps1", "codex"];
  const extensions = (pathext || ".COM;.EXE;.BAT;.CMD").split(";").map((v) => v.trim()).filter(Boolean);
  return [...extensions.map((extension) => bin + extension.toLowerCase()), bin];
}

export function findCliBin(bin, dirs, options = {}) {
  const access = options.accessSync || fs.accessSync;
  for (const dir of dirs) for (const candidate of cliBinCandidates(bin, options)) {
    const file = path.join(dir, candidate);
    try { access(file, fs.constants.X_OK); return file; } catch { /* next candidate */ }
  }
  return null;
}

export function findExecutableOnPath(bin, { platform = process.platform, env = process.env, accessSync } = {}) {
  const delimiter = platform === "win32" ? ";" : path.delimiter;
  const dirs = String(env.PATH || "").split(delimiter).filter(Boolean);
  return findCliBin(bin, dirs, { platform, pathext: env.PATHEXT, accessSync });
}

// Based on the quoting rules used by mature Windows process launchers: quote
// each argv item, double backslashes before quotes, then escape cmd metacharacters.
// Untrusted prompts remain argv values; none are interpolated without escaping.
export function quoteCmdArgument(value) {
  let argument = String(value);
  if (!argument) return '""';
  argument = argument.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/g, "$1$1");
  argument = `"${argument}"`;
  return argument.replace(/([()%!^"<>&|])/g, "^$1");
}

export function prepareCliSpawn(binPath, args, { platform = process.platform, env = process.env, findExecutable } = {}) {
  if (platform !== "win32") return { command: binPath, args, options: {} };
  const extension = path.extname(binPath).toLowerCase();
  if (extension === ".cmd" || extension === ".bat") {
    const command = env.ComSpec || env.COMSPEC || "cmd.exe";
    const commandLine = [binPath, ...args].map(quoteCmdArgument).join(" ");
    return { command, args: ["/d", "/s", "/c", commandLine], options: { windowsVerbatimArguments: true } };
  }
  if (extension === ".ps1") {
    const lookup = findExecutable || ((name) => findExecutableOnPath(name, { platform, env }));
    const powershell = lookup("pwsh") || lookup("powershell.exe") || lookup("powershell");
    if (!powershell) throw new Error(CODEX_WINDOWS_LAUNCH_ERROR);
    return { command: powershell, args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", binPath, ...args], options: {} };
  }
  if (extension === ".exe" || extension === ".com" || extension === "") return { command: binPath, args, options: {} };
  throw new Error(CODEX_WINDOWS_LAUNCH_ERROR);
}
