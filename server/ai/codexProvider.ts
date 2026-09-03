import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { WORKSPACE_ROOT } from "../fileAccess.ts";
import type { AiProvider, AiRequest, AiResponse, ModelInfo } from "./types.ts";
import { execFileAsync, executableAvailable, ProviderExecutionError } from "./provider.ts";

export class CodexProvider implements AiProvider {
  readonly id = "codex";
  readonly name = "Codex";

  async isAvailable(): Promise<boolean> {
    return executableAvailable("codex");
  }

  async getModels(): Promise<ModelInfo[]> {
    return [{ id: "default", name: "Default (Codex CLI config)", isDefault: true }];
  }

  async execute(request: AiRequest): Promise<AiResponse> {
    if (!(await this.isAvailable())) {
      throw new ProviderExecutionError("Codex CLI is not installed (expected executable: codex)", "not_installed");
    }

    const outputPath = path.join(os.tmpdir(), `career-ops-codex-${randomUUID()}.txt`);
    const model = request.model && !["auto", "default"].includes(request.model) ? request.model : "default";
    const args = [
      "exec",
      "--ephemeral",
      "--sandbox", "read-only",
      "--color", "never",
      "--cd", WORKSPACE_ROOT,
      "--output-last-message", outputPath
    ];
    if (request.outputSchemaPath) args.push("--output-schema", request.outputSchemaPath);
    if (model !== "default") args.push("--model", model);
    args.push(request.prompt);

    const start = Date.now();
    try {
      const { stdout, stderr } = await execFileAsync("codex", args, { cwd: WORKSPACE_ROOT, timeoutMs: request.timeoutMs });
      const content = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8").trim() : stdout.trim();
      if (!content) throw new ProviderExecutionError("Codex returned an empty response", "error", stderr);
      return { content, providerId: this.id, providerName: this.name, model, durationMs: Date.now() - start, stderr: stderr.trim() };
    } finally {
      if (fs.existsSync(outputPath)) fs.rmSync(outputPath, { force: true });
    }
  }
}
