import type { CareerWatch, RankedOffer } from "./automation-model.mjs";

export type OmniRouteStatus = {
  reachable: boolean;
  model: string;
  models: string[];
  baseUrl: string;
  detail: string;
};

export type OmniRouteRankResult = {
  ok: boolean;
  offers: RankedOffer[];
  model: string;
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
  rank(offers: RankedOffer[], watch: CareerWatch): Promise<OmniRouteRankResult>;
};
