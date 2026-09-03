import fs from "node:fs";
import path from "node:path";
import { load as loadYaml, dump as dumpYaml } from "js-yaml";
import { WORKSPACE_ROOT } from "../fileAccess.ts";
import { CodexProvider } from "./codexProvider.ts";
import { GeminiProvider } from "./geminiProvider.ts";
import { ProviderExecutionError, classifyProviderError, usefulError } from "./provider.ts";
import type { AiConfig, AiProvider, AiRequest, AiResponse, ProviderExecutionEvent, ProviderHealth } from "./types.ts";

const CONFIG_PATH = path.join(WORKSPACE_ROOT, "config", "ai.yml");
const DEFAULT_CONFIG: AiConfig = {
  default_provider: "codex",
  fallback_enabled: false,
  providers: {
    codex: { enabled: true, model: "default" },
    gemini: { enabled: true, model: "gemini-3.7-flash-high" }
  }
};

const FALLBACK_STATUSES = new Set(["not_installed", "rate_limited", "quota_exhausted", "temporary_unavailable"]);

export class AiProviderRegistry {
  private providers = new Map<string, AiProvider>();
  private lastHealth = new Map<string, Partial<ProviderHealth>>();

  constructor() {
    this.register(new CodexProvider());
    this.register(new GeminiProvider());
  }

  register(provider: AiProvider): void {
    this.providers.set(provider.id, provider);
  }

  getConfig(): AiConfig {
    let loaded: Partial<AiConfig> = {};
    if (fs.existsSync(CONFIG_PATH)) {
      try {
        loaded = (loadYaml(fs.readFileSync(CONFIG_PATH, "utf8")) as Partial<AiConfig>) || {};
      } catch (error: any) {
        throw new Error(`Invalid config/ai.yml: ${error.message}`);
      }
    }
    const providers: AiConfig["providers"] = {};
    for (const [id, defaults] of Object.entries(DEFAULT_CONFIG.providers)) {
      providers[id] = { ...defaults, ...(loaded.providers?.[id] || {}) };
    }
    const defaultProvider = typeof loaded.default_provider === "string" && this.providers.has(loaded.default_provider)
      ? loaded.default_provider
      : DEFAULT_CONFIG.default_provider;
    return {
      default_provider: defaultProvider,
      fallback_enabled: loaded.fallback_enabled === true,
      providers
    };
  }

  saveConfig(update: { defaultProvider?: string; fallbackEnabled?: boolean; providerId?: string; model?: string }): AiConfig {
    const config = this.getConfig();
    if (update.defaultProvider !== undefined) {
      if (!this.providers.has(update.defaultProvider)) throw new Error(`Unknown AI provider: ${update.defaultProvider}`);
      config.default_provider = update.defaultProvider;
    }
    if (update.fallbackEnabled !== undefined) config.fallback_enabled = Boolean(update.fallbackEnabled);
    if (update.providerId !== undefined && update.model !== undefined) {
      if (!this.providers.has(update.providerId)) throw new Error(`Unknown AI provider: ${update.providerId}`);
      config.providers[update.providerId].model = String(update.model).slice(0, 120);
    }
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, dumpYaml(config, { noRefs: true, lineWidth: 120 }), "utf8");
    return config;
  }

  async getHealth(): Promise<{ defaultProvider: string; fallbackEnabled: boolean; providers: ProviderHealth[] }> {
    const config = this.getConfig();
    const providers = await Promise.all([...this.providers.values()].map(async (provider) => {
      const settings = config.providers[provider.id];
      const enabled = settings?.enabled !== false;
      const available = enabled ? await provider.isAvailable() : false;
      const previous = this.lastHealth.get(provider.id) || {};
      const models = available ? await provider.getModels() : [];
      return {
        id: provider.id,
        name: provider.name,
        enabled,
        available,
        status: !enabled ? "disabled" : !available ? "not_installed" : previous.status || "ready",
        statusMessage: previous.statusMessage,
        models,
        selectedModel: settings?.model || "default",
        lastTestedAt: previous.lastTestedAt,
        responseTimeMs: previous.responseTimeMs
      } as ProviderHealth;
    }));
    return { defaultProvider: config.default_provider, fallbackEnabled: config.fallback_enabled, providers };
  }

  async testProvider(providerId: string, model?: string) {
    const provider = this.providers.get(providerId);
    if (!provider) throw new Error(`Unknown AI provider: ${providerId}`);
    const configured = this.getConfig().providers[providerId];
    const start = Date.now();
    try {
      const result = await provider.execute({ prompt: "Return exactly: OK", model: model || configured?.model, timeoutMs: 60_000 });
      const responseTimeMs = Date.now() - start;
      this.lastHealth.set(providerId, { status: "ready", statusMessage: "Provider test passed", lastTestedAt: new Date().toISOString(), responseTimeMs });
      return { provider: provider.id, model: result.model, success: true, responseTimeMs, response: result.content.slice(0, 200), status: "ready" };
    } catch (error: any) {
      const responseTimeMs = Date.now() - start;
      const message = usefulError(error.message, error.stderr);
      const status = error instanceof ProviderExecutionError ? error.status : classifyProviderError(message);
      this.lastHealth.set(providerId, { status, statusMessage: message, lastTestedAt: new Date().toISOString(), responseTimeMs });
      return { provider: provider.id, model: model || configured?.model || "default", success: false, responseTimeMs, status, error: message };
    }
  }

  async execute(
    request: AiRequest,
    selection: { providerId?: string; model?: string } = {},
    onEvent?: (event: ProviderExecutionEvent) => void
  ): Promise<AiResponse & { fallbackUsed: boolean }> {
    const config = this.getConfig();
    const selectedId = selection.providerId || config.default_provider;
    if (!this.providers.has(selectedId)) throw new Error(`Unknown AI provider: ${selectedId}`);
    const orderedIds = [selectedId];
    if (config.fallback_enabled) {
      for (const id of this.providers.keys()) {
        if (id !== selectedId && config.providers[id]?.enabled !== false) orderedIds.push(id);
      }
    }

    let lastError: unknown;
    for (let index = 0; index < orderedIds.length; index += 1) {
      const id = orderedIds[index];
      const provider = this.providers.get(id)!;
      const settings = config.providers[id];
      if (settings?.enabled === false) continue;
      const model = index === 0 && selection.model ? selection.model : settings?.model;
      onEvent?.({ type: "attempt", providerId: id, providerName: provider.name, message: `Invoking ${provider.name}${model ? ` (${model})` : ""}` });
      try {
        const result = await provider.execute({ ...request, model });
        this.lastHealth.set(id, { status: "ready", statusMessage: "Last operation succeeded", lastTestedAt: new Date().toISOString(), responseTimeMs: result.durationMs });
        onEvent?.({ type: "success", providerId: id, providerName: provider.name, message: `${provider.name} completed successfully` });
        return { ...result, fallbackUsed: index > 0 };
      } catch (error: any) {
        lastError = error;
        const message = usefulError(error.message, error.stderr);
        const status = error instanceof ProviderExecutionError ? error.status : classifyProviderError(message);
        this.lastHealth.set(id, { status, statusMessage: message, lastTestedAt: new Date().toISOString() });
        onEvent?.({ type: "failure", providerId: id, providerName: provider.name, message: `${provider.name} failed: ${message}` });
        const canFallback = config.fallback_enabled && FALLBACK_STATUSES.has(status) && index + 1 < orderedIds.length;
        if (!canFallback) throw error;
        const next = this.providers.get(orderedIds[index + 1])!;
        onEvent?.({ type: "fallback", providerId: next.id, providerName: next.name, message: `${provider.name} failed (${status}); retrying with ${next.name}` });
      }
    }
    throw lastError || new Error("No enabled AI provider is available");
  }
}

export const aiProviderRegistry = new AiProviderRegistry();
