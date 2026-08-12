import type { CareerWatch, RankedAutomationOffer } from "./automation-model.mjs";

export type OmniRouteStatus = {
  reachable: boolean;
  model: string;
  models: string[];
  baseUrl: string;
  detail: string;
};

export type OmniRouteRankResult = {
  ok: boolean;
  model: string;
  offers: RankedAutomationOffer[];
  error?: string;
};

export type OmniRouteChatResult = {
  ok: boolean;
  content: string;
  model: string;
  error?: string;
};

export function createOmniRouteClient(options?: {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): {
  baseUrl: string;
  model: string;
  status(): Promise<OmniRouteStatus>;
  chat(prompt: string): Promise<OmniRouteChatResult>;
  rank(
    offers: RankedAutomationOffer[],
    watch: CareerWatch,
  ): Promise<OmniRouteRankResult>;
};
