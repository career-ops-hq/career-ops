import { careerOpsRoot } from "@/lib/career-ops";
import { spawnCli } from "@/lib/cli-spawn";
import { buildCliArgs, detectCliPlaintextError, processStreamJsonLines, usesStreamJson } from "@/lib/cli-stream";
import type { CliSpec } from "@/lib/clis";

/**
 * Spawn a headless AI CLI and stream its plain-text output as a ReadableStream.
 * Shared by every "run the user's CLI headless, parse <<offer:>> envelopes" route
 * (AI search, Portals/Level-3 search) so the close/cancel/backpressure handling
 * exists in exactly one place instead of drifting across forks.
 *
 * Claude Code and Cursor CLI emit --output-format stream-json (JSON-lines);
 * every other CLI prints plain text directly.
 */
export function streamAgentCli({
  cliId,
  binPath,
  spec,
  prompt,
  allowedTools,
  disallowedTools,
}: {
  cliId: string;
  binPath: string;
  spec: CliSpec;
  prompt: string;
  allowedTools: string[];
  disallowedTools: string[];
}): ReadableStream<Uint8Array> {
  const streamJson = usesStreamJson(cliId);
  const args = streamJson
    ? buildCliArgs(cliId, spec, {
        prompt,
        permissionMode: cliId === "claude" ? "acceptEdits" : undefined,
        allowedTools: allowedTools.join(","),
        disallowedTools: disallowedTools.join(","),
      })
    : spec.args(prompt);

  const child = spawnCli(binPath, args, { cwd: careerOpsRoot() });
  const encoder = new TextEncoder();
  let closed = false;
  let killer: ReturnType<typeof setTimeout> | undefined;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let buf = "";
      let emitted = false;
      killer = setTimeout(() => {
        try {
          child.kill("SIGTERM");
        } catch {
          /* ignore */
        }
      }, 480_000);
      const safeClose = () => {
        if (!closed) {
          closed = true;
          if (killer) clearTimeout(killer);
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      };
      const safeEnqueue = (s: string): boolean => {
        if (closed || !s) return false;
        try {
          controller.enqueue(encoder.encode(s));
          return true;
        } catch {
          closed = true;
          return false;
        }
      };
      const emit = (s: string) => {
        if (safeEnqueue(s)) emitted = true;
      };

      child.stdout.on("data", (d: Buffer) => {
        if (closed) return;
        if (!streamJson) {
          emit(d.toString());
          return;
        }
        buf = processStreamJsonLines(cliId, buf + d.toString(), emit, (meta) => {
          if (meta.authError) safeEnqueue(`\n**Error:** ${meta.authError}\n`);
        });
      });
      child.stderr.on("data", (d: Buffer) => {
        const s = d.toString();
        if (/error|not found|denied|fatal/i.test(s)) {
          safeEnqueue(`\n[${spec.name}] ${s.trim()}\n`);
        }
      });
      child.on("error", (e) => {
        safeEnqueue(`\n[error launching ${spec.name}: ${e.message}]`);
        safeClose();
      });
      child.on("close", () => {
        const tailErr = detectCliPlaintextError(buf);
        if (tailErr) safeEnqueue(`\n**Error:** ${tailErr}\n`);
        else if (!emitted) safeEnqueue("_(no output — is the CLI authenticated? If using FCC, start `fcc-server` first.)_");
        safeClose();
      });
    },
    cancel() {
      closed = true;
      if (killer) clearTimeout(killer);
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    },
  });
}
