import type { CliSpec } from "@/lib/clis";
import { opencodePermissionBlock } from "@/lib/opencode-permission.mjs";
import { opencodeStreamMeta, opencodeStreamText, opencodeWorkerArgs, usesOpencodeNdjson } from "@/lib/opencode-stream.mjs";

/**
 * Which surface is asking. opencode's NDJSON is opt-in for the WORKER card only:
 * the chat assistant and the CV-ingest route keep their existing raw-stdout
 * behaviour. Flipping the default would silently change two other surfaces, and
 * cv/ingest uses `!usesStreamJson(cliId)` as its "can this CLI read a PDF from
 * /tmp?" capability gate — which opencode cannot do, because its headless
 * permission block (see buildCliEnv) rejects any path outside the workspace.
 */
export type StreamSurface = "default" | "worker";

export function usesStreamJson(cliId: string, surface: StreamSurface = "default"): boolean {
  if (cliId === "claude" || cliId === "cursor") return true;
  return usesOpencodeNdjson(cliId, surface);
}

export type CliSpawnOptions = {
  prompt: string;
  permissionMode?: string;
  allowedTools?: string;
  disallowedTools?: string;
  strictMcpConfig?: boolean;
  /** Cursor CLI: pass --force so node/bash runs aren't blocked by a tight Shell() allowlist. */
  needsShell?: boolean;
};

/** Non-streaming headless argv (planner/prefill routes buffer stdout as plain text). */
export function buildPlannerArgs(cliId: string, spec: CliSpec, opts: CliSpawnOptions): string[] {
  const { prompt, permissionMode, allowedTools, disallowedTools, strictMcpConfig, needsShell } = opts;
  if (cliId === "claude") {
    const args = ["-p", prompt];
    if (permissionMode) args.push("--permission-mode", permissionMode);
    if (strictMcpConfig) args.push("--strict-mcp-config");
    if (allowedTools) args.push("--allowedTools", allowedTools);
    if (disallowedTools) args.push("--disallowedTools", disallowedTools);
    return args;
  }
  if (cliId === "cursor") {
    const args = ["-p", prompt, "--trust"];
    if (needsShell) args.push("--force");
    return args;
  }
  if (cliId === "codex") {
    // Codex has no per-tool allowlist; its headless sandbox flag is the fence
    // (read-only for web-only kinds, workspace-write when the worker shells out).
    return ["exec", prompt, "--sandbox", needsShell ? "workspace-write" : "read-only"];
  }
  return spec.args(prompt);
}

/** Headless argv for a CLI run. Claude/Cursor use stream-json; others use each spec's args(). */
export function buildCliArgs(cliId: string, spec: CliSpec, opts: CliSpawnOptions): string[] {
  const { prompt, permissionMode, allowedTools, disallowedTools, strictMcpConfig, needsShell } = opts;
  if (cliId === "claude") {
    const args = ["-p", prompt, "--output-format", "stream-json", "--verbose", "--include-partial-messages"];
    if (permissionMode) args.push("--permission-mode", permissionMode);
    if (strictMcpConfig) args.push("--strict-mcp-config");
    if (allowedTools) args.push("--allowedTools", allowedTools);
    if (disallowedTools) args.push("--disallowedTools", disallowedTools);
    return args;
  }
  if (cliId === "cursor") {
    const args = ["-p", prompt, "--output-format", "stream-json", "--stream-partial-output", "--trust"];
    // Headless web workers must run core scripts (merge-tracker, generate-pdf, …).
    // Cursor's default approvalMode is often "allowlist" with only Shell(ls) —
    // without --force the agent falls back to Write-only and PDF never renders.
    if (needsShell) args.push("--force");
    return args;
  }
  if (cliId === "codex") {
    return ["exec", prompt, "--sandbox", needsShell ? "workspace-write" : "read-only"];
  }
  if (cliId === "opencode") {
    // Only the worker route reaches here for opencode (usesStreamJson is
    // surface-gated), so the assistant and cv/ingest keep spec.args() unchanged.
    return opencodeWorkerArgs(prompt);
  }
  return spec.args(prompt);
}

/**
 * Extra env a CLI run needs beyond the ambient process env. Only opencode has
 * one today: its headless scope rides in OPENCODE_CONFIG_CONTENT (opencode has
 * no per-tool argv flags, and its default headless run auto-rejects any tool
 * touching a path outside its workspace — /tmp payloads). Returns {} for every
 * other CLI so spawn sites stay CLI-agnostic.
 */
export function buildCliEnv(cliId: string, opts: Pick<CliSpawnOptions, "allowedTools" | "disallowedTools">): Record<string, string> {
  if (cliId !== "opencode") return {};
  return { OPENCODE_CONFIG_CONTENT: opencodePermissionBlock({ allowed: opts.allowedTools, disallowed: opts.disallowedTools }) };
}

function claudeAssistantText(obj: Record<string, unknown>): string | null {
  if (obj.type !== "assistant") return null;
  const msg = obj.message as { content?: { type?: string; text?: string }[] } | undefined;
  let text = "";
  for (const block of msg?.content ?? []) {
    if (block.type === "text" && block.text) text += block.text;
  }
  return text || null;
}

export function extractStreamText(cliId: string, obj: Record<string, unknown>): string | null {
  if (cliId === "claude") {
    if (obj.type === "stream_event") {
      const e = obj.event as Record<string, unknown> | undefined;
      if (e?.type !== "content_block_delta") return null;
      const delta = e.delta as { text?: string } | undefined;
      return typeof delta?.text === "string" ? delta.text : null;
    }
    // Auth failures often arrive as a final assistant frame, not stream_event deltas.
    return claudeAssistantText(obj);
  }
  if (cliId === "cursor") {
    if (obj.type !== "assistant") return null;
    // Partial deltas carry timestamp_ms; the final cumulative replay does not.
    if (!("timestamp_ms" in obj)) return null;
    const msg = obj.message as { content?: { type?: string; text?: string }[] } | undefined;
    let text = "";
    for (const block of msg?.content ?? []) {
      if (block.type === "text" && block.text) text += block.text;
    }
    return text || null;
  }
  if (cliId === "opencode") return opencodeStreamText(obj);
  return null;
}

/** Plain-text startup failures (e.g. fcc-claude when fcc-server is down). */
export function detectCliPlaintextError(text: string): string | null {
  const t = text.trim();
  if (!t || t.startsWith("{")) return null;
  if (/Free Claude Code proxy is not reachable/i.test(t)) {
    const hint = /:3001\b/.test(t)
      ? "fcc-claude was pointed at the career-ops web port (3001) instead of fcc-server (8082). Restart the web UI after updating."
      : t.includes("fcc-server")
        ? t
        : `${t}\nStart the proxy in another terminal: fcc-server`;
    return hint;
  }
  return null;
}

export type StreamMeta = {
  tokens?: number;
  /**
   * How `tokens` combines with the run so far. claude/cursor emit ONE final
   * result event carrying the whole run ("replace"); opencode emits a
   * `step_finish` per model step, each carrying that step's delta ("delta").
   * Overwriting instead of accumulating under-reports every multi-step run.
   */
  tokensMode?: "replace" | "delta";
  costUsd?: number | null;
  toolName?: string;
  status?: string;
  /** Set when the CLI reports an auth/login failure in stream-json output. */
  authError?: string;
  /**
   * Set when the CLI reports a provider/transport failure in stream-json output
   * (opencode's `{"type":"error"}`). Distinct from `authError` because the cause
   * and the fix differ — a 500/quota/upstream error is not a login problem — but
   * terminal in the same way: the CLI cannot continue, so the route reports the
   * real message instead of the generic "exited with an error" guess.
   */
  fatalError?: string;
};

export function extractStreamMeta(cliId: string, obj: Record<string, unknown>): StreamMeta | null {
  if (cliId === "claude") {
    if (obj.type === "stream_event") {
      const e = obj.event as Record<string, unknown> | undefined;
      if (e?.type === "content_block_start") {
        const cb = e.content_block as { type?: string; name?: string } | undefined;
        if (cb?.type === "tool_use" && cb.name) return { toolName: cb.name };
      }
      return null;
    }
    if (obj.type === "assistant" && obj.error === "authentication_failed") {
      const text = claudeAssistantText(obj);
      return { authError: text || "Failed to authenticate — run `claude login` in a terminal, then retry." };
    }
    if (obj.type === "system" && obj.subtype === "init") return { status: "Agent ready" };
    if (obj.type === "result") {
      if (obj.is_error && typeof obj.result === "string" && /auth/i.test(obj.result)) {
        return { authError: obj.result };
      }
      const u = obj.usage as Record<string, number> | undefined;
      const tokens = u
        ? (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0)
        : undefined;
      const costUsd = typeof obj.total_cost_usd === "number" ? obj.total_cost_usd : null;
      return { tokens, costUsd };
    }
    return null;
  }
  if (cliId === "cursor") {
    if (obj.type === "system" && obj.subtype === "init") return { status: "Agent ready" };
    if (obj.type === "result" && obj.subtype === "success") {
      const u = obj.usage as Record<string, number> | undefined;
      const tokens = u ? (u.inputTokens || 0) + (u.outputTokens || 0) : undefined;
      return { tokens, costUsd: null };
    }
    return null;
  }
  if (cliId === "opencode") return opencodeStreamMeta(obj);
  return null;
}

/** Line-buffer NDJSON from a stream-json CLI; returns the leftover partial line. */
export function processStreamJsonLines(
  cliId: string,
  buf: string,
  onText: (text: string) => void,
  onMeta?: (meta: StreamMeta) => void,
): string {
  let remaining = buf;
  let nl: number;
  while ((nl = remaining.indexOf("\n")) !== -1) {
    const line = remaining.slice(0, nl).trim();
    remaining = remaining.slice(nl + 1);
    if (!line) continue;
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      const text = extractStreamText(cliId, obj);
      if (text) onText(text);
      const meta = extractStreamMeta(cliId, obj);
      if (meta && onMeta) onMeta(meta);
    } catch {
      const plainErr = detectCliPlaintextError(line);
      if (plainErr && onMeta) onMeta({ authError: plainErr });
    }
  }
  return remaining;
}
