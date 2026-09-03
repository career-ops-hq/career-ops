export interface ModelInfo {
  id: string;
  name: string;
  isDefault?: boolean;
}
export interface AiRequest {
  prompt: string;
  model?: string;
  outputSchemaPath?: string;
  timeoutMs?: number;
}

export interface AiResponse {
  content: string;
  providerId: string;
  providerName: string;
  model: string;
  durationMs: number;
  stderr?: string;
}

export type AiProviderStatus =
  | "ready"
  | "not_installed"
  | "disabled"
  | "rate_limited"
  | "quota_exhausted"
  | "auth_required"
  | "temporary_unavailable"
  | "error";

export interface AiProvider {
  id: string;
  name: string;
  isAvailable(): Promise<boolean>;
  getModels(): Promise<ModelInfo[]>;
  execute(request: AiRequest): Promise<AiResponse>;
}

export interface ProviderSettings {
  enabled: boolean;
  model: string;
}

export interface AiConfig {
  default_provider: string;
  fallback_enabled: boolean;
  providers: Record<string, ProviderSettings>;
}

export interface ProviderHealth {
  id: string;
  name: string;
  enabled: boolean;
  available: boolean;
  status: AiProviderStatus;
  statusMessage?: string;
  models: ModelInfo[];
  selectedModel: string;
  lastTestedAt?: string;
  responseTimeMs?: number;
}

export interface ProviderExecutionEvent {
  type: "attempt" | "fallback" | "success" | "failure";
  providerId: string;
  providerName: string;
  message: string;
}
