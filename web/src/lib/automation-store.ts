import fs from "node:fs";
import path from "node:path";

import { careerOpsRoot, rootScript } from "@/lib/career-ops";
import { runDiscovery } from "@/lib/core/scan";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";
import {
  DEFAULT_WATCH,
  isWatchDue,
  normalizeWatch,
  rankOffers,
  type CareerWatch,
  type RankedAutomationOffer,
} from "@/lib/automation-model.mjs";
import { createOmniRouteClient, type OmniRouteStatus } from "@/lib/omniroute-client.mjs";
import type { DiscoveredOffer, ExploreFilters, ScanEvent } from "@/lib/explore";

export type AutomationRun = {
  id: string;
  startedAt: string;
  finishedAt: string;
  discovered: number;
  matched: number;
  aiUsed: boolean;
  status: "ok" | "degraded" | "error";
  message: string;
};

export type AutomationState = {
  version: 1;
  watch: CareerWatch;
  results: RankedAutomationOffer[];
  runs: AutomationRun[];
  updatedAt: string;
};

type AutomationAiResult = {
  ok: boolean;
  usedAi: boolean;
  model: string;
  ranked: RankedAutomationOffer[];
  warning: string;
};

const STATE_RELATIVE_PATH = path.join("data", "automation.json");
const MAX_RESULTS = 200;
const MAX_RUNS = 30;

function emptyState(): AutomationState {
  return {
    version: 1,
    watch: normalizeWatch(DEFAULT_WATCH),
    results: [],
    runs: [],
    updatedAt: new Date(0).toISOString(),
  };
}

function statePath(): string {
  return path.join(careerOpsRoot(), STATE_RELATIVE_PATH);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function readAutomationState(): AutomationState {
  try {
    const raw = JSON.parse(fs.readFileSync(statePath(), "utf8")) as unknown;
    if (!isRecord(raw)) return emptyState();
    const results = Array.isArray(raw.results) ? (raw.results as RankedAutomationOffer[]).slice(0, MAX_RESULTS) : [];
    const runs = Array.isArray(raw.runs) ? (raw.runs as AutomationRun[]).slice(0, MAX_RUNS) : [];
    return {
      version: 1,
      watch: normalizeWatch(isRecord(raw.watch) ? raw.watch : DEFAULT_WATCH),
      results,
      runs,
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date(0).toISOString(),
    };
  } catch {
    return emptyState();
  }
}

export function writeAutomationState(state: AutomationState): AutomationState {
  const next: AutomationState = {
    version: 1,
    watch: normalizeWatch(state.watch),
    results: state.results.slice(0, MAX_RESULTS),
    runs: state.runs.slice(0, MAX_RUNS),
    updatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(statePath()), { recursive: true });
  atomicWriteWithBackup(statePath(), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export function saveWatch(raw: unknown): AutomationState {
  const state = readAutomationState();
  const input = isRecord(raw) ? (raw as Partial<CareerWatch>) : {};
  return writeAutomationState({ ...state, watch: normalizeWatch(input) });
}

function modeLocationTerms(watch: CareerWatch): string[] {
  const terms = [...watch.locations];
  if (watch.workModes.includes("remote")) terms.push("remote", "distans");
  if (watch.workModes.includes("hybrid")) terms.push("hybrid");
  if (watch.workModes.includes("mobile")) terms.push("field", "travel", "mobile", "resande", "fält");
  return Array.from(new Set(terms));
}

function watchToFilters(watch: CareerWatch): ExploreFilters {
  return {
    positive: watch.roles,
    negative: watch.excludeKeywords,
    allow: modeLocationTerms(watch),
    block: [],
    alwaysAllow: watch.workModes.includes("remote") ? ["remote", "distans"] : [],
    sinceDays: 30,
    ats: watch.sources,
    limitPerAts: 150,
  };
}

function toAutomationOffer(offer: DiscoveredOffer) {
  return {
    title: offer.title,
    company: offer.company,
    location: offer.location,
    url: offer.url,
    date: offer.postedAt,
    source: offer.source || offer.ats,
  };
}

function runId(now: Date): string {
  return now.toISOString().replace(/[-:.TZ]/g, "");
}

let activeRun: Promise<AutomationState> | null = null;

async function executeAutomationRun(force = false): Promise<AutomationState> {
  const started = new Date();
  const state = readAutomationState();
  const watch = state.watch;

  if (!force && (!watch.enabled || !isWatchDue(watch, started))) return state;
  if (!watch.enabled) throw new Error("Bevakningen är pausad.");
  if (!fs.existsSync(rootScript("scan-ats-full"))) throw new Error("ATS-skannern saknas i installationen.");

  const events: ScanEvent[] = [];
  let discovered: DiscoveredOffer[] = [];
  let runStatus: AutomationRun["status"] = "ok";
  let message = "Sökningen slutfördes.";
  let aiResult: AutomationAiResult = {
    ok: false,
    usedAi: false,
    model: "auto/reliable",
    ranked: [],
    warning: "AI-rankning avstängd",
  };

  try {
    discovered = await runDiscovery(watchToFilters(watch), (event) => events.push(event));
    const ranked = rankOffers(discovered.map(toAutomationOffer), watch, started);
    if (watch.aiEnabled) {
      const omniResult = await createOmniRouteClient().rank(ranked, watch);
      aiResult = {
        ok: omniResult.ok,
        usedAi: omniResult.ok && ranked.length > 0,
        model: omniResult.model,
        ranked: omniResult.offers,
        warning: omniResult.error || "",
      };
    } else {
      aiResult = {
          ok: false,
          usedAi: false,
          model: "auto/reliable",
          ranked,
          warning: "AI-rankning avstängd",
      };
    }

    if (watch.aiEnabled && !aiResult.ok) {
      runStatus = "degraded";
      message = `Sökningen slutfördes med deterministisk matchning. OmniRoute: ${aiResult.warning}`;
    }

    const eventError = events.find((event): event is Extract<ScanEvent, { kind: "error" }> => event.kind === "error");
    if (eventError) {
      runStatus = "degraded";
      message = `Sökningen gav ett delresultat: ${eventError.message}`;
    }
  } catch (error) {
    runStatus = "error";
    message = error instanceof Error ? error.message : "Jobbsökningen misslyckades.";
  }

  const finished = new Date();
  const offers = aiResult.ranked;
  const run: AutomationRun = {
    id: runId(started),
    startedAt: started.toISOString(),
    finishedAt: finished.toISOString(),
    discovered: discovered.length,
    matched: offers.length,
    aiUsed: aiResult.usedAi,
    status: runStatus,
    message,
  };

  return writeAutomationState({
    ...state,
    watch: { ...watch, lastRunAt: finished.toISOString() },
    results: offers,
    runs: [run, ...state.runs],
    updatedAt: finished.toISOString(),
  });
}

export function runAutomation(force = false): Promise<AutomationState> {
  if (activeRun) return activeRun;
  activeRun = executeAutomationRun(force).finally(() => {
    activeRun = null;
  });
  return activeRun;
}

export function automationRunActive(): boolean {
  return activeRun !== null;
}

export async function automationSnapshot(): Promise<{
  state: AutomationState;
  gateway: OmniRouteStatus;
  due: boolean;
  running: boolean;
}> {
  const state = readAutomationState();
  const gateway = await createOmniRouteClient().status();
  return {
    state,
    gateway,
    due: isWatchDue(state.watch),
    running: automationRunActive(),
  };
}
