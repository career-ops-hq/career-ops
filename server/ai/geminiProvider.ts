import type { AiProvider, AiRequest, AiResponse, ModelInfo } from "./types.ts";
import { execFileAsync, executableAvailable, ProviderExecutionError } from "./provider.ts";

const DEFAULT_MODEL = "gemini-3.7-flash-high";
let modelCache: { expiresAt: number; models: ModelInfo[] } | null = null;

export class GeminiProvider implements AiProvider {
  readonly id = "gemini";
  readonly name = "Gemini / Antigravity";

  async isAvailable(): Promise<boolean> {
    return executableAvailable("agy");
  }

  async getModels(): Promise<ModelInfo[]> {
    if (modelCache && modelCache.expiresAt > Date.now()) return modelCache.models;
    try {
      const { stdout } = await execFileAsync("agy", ["models"], { timeoutMs: 20_000 });
      const models = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.toLowerCase().startsWith("fetching"))
        .map((line) => {
          const [id, ...label] = line.split(/\t+/);
          return { id, name: label.join(" ") || id, isDefault: id === DEFAULT_MODEL };
        });
      modelCache = { expiresAt: Date.now() + 5 * 60_000, models };
      return models;
    } catch {
      return [{ id: DEFAULT_MODEL, name: DEFAULT_MODEL, isDefault: true }];
    }
  }

  async execute(request: AiRequest): Promise<AiResponse> {
    if (!(await this.isAvailable())) {
      throw new ProviderExecutionError("Gemini / Antigravity CLI is not installed (expected executable: agy)", "not_installed");
    }
    const model = request.model && !["auto", "default"].includes(request.model) ? request.model : DEFAULT_MODEL;
    const start = Date.now();
    const { stdout, stderr } = await execFileAsync(
      "agy",
      ["--model", model, "--dangerously-skip-permissions", "-p", request.prompt],
      { timeoutMs: request.timeoutMs }
    );
    return {
      content: stdout.trim(),
      providerId: this.id,
      providerName: this.name,
      model,
      durationMs: Date.now() - start,
      stderr: stderr.trim()
    };
  }
}
