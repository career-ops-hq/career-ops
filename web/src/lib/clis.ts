import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Server-only (node imports). The agnostic runtimes career-ops can delegate to
// in headless mode (AGENTS.md). Install URLs from career-ops-docs.

/**
 * How one CLI is invoked as the PLANNER for the agentic browser-drive loop
 * (web/src/lib/apply/drive.ts).
 *
 * Why this is per-CLI metadata rather than a `cliId !== "claude"` check: the
 * drive loop itself is provider-neutral — snapshot -> parseAction -> execute on
 * OUR page. What actually differed was the TRANSPORT (CLI flags + the stdout
 * envelope), so that is the only thing a capability needs to describe. The
 * never-submit guarantee does NOT live here: it is enforced by SUBMIT_RX in
 * drive.ts against the element's own text, so it holds for every driver.
 */
export type DriveCapability = {
  /**
   * argv for one planner turn.
   * @param prompt   the observation + action-vocabulary prompt
   * @param resumeId a prior turn's session id, or null. CLIs with no
   *   continuation flag should ignore it (the loop then re-sends full context
   *   every turn, which costs tokens but stays correct).
   */
  args: (prompt: string, resumeId: string | null) => string[];
  /** Unwrap this CLI's stdout envelope into reply text + a resumable id. */
  parse: (stdout: string) => { out: string; sessionId: string | null };
};

export type CliSpec = {
  id: string;
  name: string;
  bin: string;
  /** Alternate executable names (e.g. cursor-agent → agent). */
  altBins?: string[];
  run: string;
  url: string;
  /** headless invocation args for a single prompt */
  args: (prompt: string) => string[];
  /**
   * Set when this CLI can plan form-driving actions. Read by drive.ts as
   * `spec.drive` — a capability flag on the spec, not an id allowlist, so
   * adding a proxy or a local model is a one-line registry edit.
   */
  drive?: DriveCapability;
};

export const KNOWN: CliSpec[] = [
  // Prefer fcc-claude (Free Claude Code proxy) over stock claude when both exist —
  // many setups route Claude Code through a local FCC proxy instead of OAuth.
  // Same id, same drive capability: the proxy is a transport swap, which is
  // exactly the seam `drive` encodes.
  {
    id: "claude",
    name: "Claude Code",
    bin: "fcc-claude",
    altBins: ["claude"],
    run: "fcc-claude -p",
    url: "https://claude.ai/code",
    args: (p) => ["-p", p],
    drive: {
      // `--resume` is what keeps a multi-step loop cheap; without it every turn
      // re-sends the full observation. The tool denylist is belt-and-braces —
      // drive.ts executes actions itself and the vocabulary has no "submit".
      args: (prompt, resumeId) => [
        ...(resumeId ? ["-p", "--resume", resumeId, prompt] : ["-p", prompt]),
        "--output-format",
        "json",
        "--strict-mcp-config",
        "--disallowedTools",
        "Bash,Read,Write,Edit,NotebookEdit,Task,WebFetch,WebSearch,Glob,Grep",
      ],
      parse: (stdout) => {
        try {
          const j = JSON.parse(stdout);
          return { out: j.result ?? stdout, sessionId: j.session_id ?? null };
        } catch {
          return { out: stdout, sessionId: null };
        }
      },
    },
  },
  // Prefer `cursor-agent` — a generic `agent` on PATH often belongs to Grok or
  // another CLI and breaks headless runs when mistaken for Cursor.
  { id: "cursor", name: "Cursor CLI", bin: "cursor-agent", altBins: ["agent"], run: "cursor-agent -p", url: "https://cursor.com/docs/cli/overview", args: (p) => ["-p", p, "--trust"] },
  { id: "codex", name: "Codex", bin: "codex", run: "codex exec", url: "https://github.com/openai/codex", args: (p) => ["exec", p] },
  { id: "gemini", name: "Gemini CLI", bin: "gemini", run: "gemini -p", url: "https://github.com/google-gemini/gemini-cli", args: (p) => ["-p", p] },
  {
    id: "opencode",
    name: "OpenCode",
    bin: "opencode",
    run: "opencode run",
    url: "https://opencode.ai",
    args: (p) => ["run", p],
    drive: {
      // No `--resume` equivalent, so resumeId is deliberately ignored: the loop
      // stays correct (each turn re-sends the current page snapshot) but costs
      // more tokens per turn than the Claude path. That trade is why this is
      // opt-in per CLI rather than "whichever CLI is installed".
      args: (prompt) => ["run", "--print-logs", prompt],
      // opencode prints the reply as plain text; tolerate a JSON envelope too.
      parse: (stdout) => {
        try {
          const j = JSON.parse(stdout);
          return { out: j.result ?? stdout, sessionId: null };
        } catch {
          return { out: stdout, sessionId: null };
        }
      },
    },
  },
  { id: "copilot", name: "GitHub Copilot CLI", bin: "copilot", run: "copilot -p", url: "https://docs.github.com/en/copilot/github-copilot-cli", args: (p) => ["-p", p] },
  { id: "qwen", name: "Qwen CLI", bin: "qwen", run: "qwen -p", url: "https://qwen.ai/qwencode", args: (p) => ["-p", p] },
  { id: "antigravity", name: "Antigravity CLI", bin: "agy", run: "agy -p", url: "https://antigravity.google", args: (p) => ["-p", p] },
];

function isCursorAgentBinary(resolvedPath: string): boolean {
  try {
    const real = fs.realpathSync(resolvedPath);
    return /cursor-agent|Cursor/i.test(real);
  } catch {
    return false;
  }
}

function resolveSpecBin(spec: CliSpec, dirs = searchDirs()): string | null {
  for (const bin of [spec.bin, ...(spec.altBins ?? [])]) {
    const found = findBin(bin, dirs);
    if (!found) continue;
    // Grok and others ship an `agent` shim — never treat it as Cursor CLI.
    if (spec.id === "cursor" && bin === "agent" && !isCursorAgentBinary(found)) continue;
    return found;
  }
  return null;
}

function searchDirs(): string[] {
  const home = os.homedir();
  const extra = [
    path.join(home, "free-claude-code", ".venv", "bin"),
    path.join(home, ".local/bin"),
    path.join(home, ".npm-global/bin"),
    path.join(home, ".bun/bin"),
    path.join(home, ".deno/bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
  ];
  if (process.platform === "win32") {
    // Windows CLIs frequently install under per-user AppData roots and don't
    // reliably add themselves to PATH (e.g. Antigravity → %LOCALAPPDATA%\agy\bin).
    const localAppData = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    extra.push(
      path.join(localAppData, "agy", "bin"), // Antigravity CLI
      path.join(localAppData, "Microsoft", "WindowsApps"), // winget/Store shims
      path.join(appData, "npm"), // npm global prefix on Windows
    );
  }
  const fromPath = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  return [...new Set([...fromPath, ...extra])];
}

// On Windows, executables carry an extension (claude.exe, claude.cmd, ...).
// Mirror the shell's PATHEXT resolution so a native-installer claude.exe is
// found, not just an extensionless npm shim. On POSIX, "" keeps the bare name.
function binCandidates(bin: string): string[] {
  if (process.platform !== "win32") return [bin];
  const pathext = process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD";
  const exts = pathext
    .split(";")
    .map((e) => e.trim())
    .filter(Boolean)
    // Only include extensions that `child_process.spawn()` can execute directly.
    .filter((e) => [".com", ".exe", ".bat", ".cmd"].includes(e.toLowerCase()));

  // Try the bare name too (some environments provide an extensionless shim).
  return [bin, ...exts.map((ext) => bin + ext)];
}

export function findBin(bin: string, dirs = searchDirs()): string | null {
  for (const dir of dirs) {
    for (const candidate of binCandidates(bin)) {
      const p = path.join(dir, candidate);
      try {
        fs.accessSync(p, fs.constants.X_OK);
        return p;
      } catch {
        /* not here */
      }
    }
  }
  return null;
}

function displayName(spec: CliSpec, binPath: string | null): string {
  if (spec.id === "claude" && binPath && /fcc-claude/i.test(binPath)) {
    return "Claude Code (FCC)";
  }
  return spec.name;
}

export function detectClis() {
  const dirs = searchDirs();
  return KNOWN.map((c) => {
    const found = resolveSpecBin(c, dirs);
    const name = displayName(c, found);
    const run = found && /fcc-claude/i.test(found) ? "fcc-claude -p" : c.run;
    return { id: c.id, name, run, url: c.url, installed: !!found, path: found };
  });
}

export function resolveCli(id: string): { spec: CliSpec; binPath: string } | null {
  const spec = KNOWN.find((c) => c.id === id);
  if (!spec) return null;
  const binPath = resolveSpecBin(spec);
  if (!binPath) return null;
  return { spec, binPath };
}
