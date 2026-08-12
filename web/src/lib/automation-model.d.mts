export type WorkMode = "remote" | "hybrid" | "onsite" | "mobile";
export type AutomationSource = "greenhouse" | "lever" | "ashby" | "workday";

export type CareerWatch = {
  id: string;
  name: string;
  enabled: boolean;
  roles: string[];
  locations: string[];
  workModes: WorkMode[];
  includeKeywords: string[];
  excludeKeywords: string[];
  sources: AutomationSource[];
  sinceDays: number;
  intervalMinutes: number;
  minimumScore: number;
  aiEnabled: boolean;
  autoAddToPipeline: boolean;
  lastRunAt: string | null;
};

export type AutomationOffer = {
  title: string;
  company: string;
  location: string;
  url: string;
  date?: string;
  source?: string;
  description?: string;
};

export type RankedAutomationOffer = AutomationOffer & {
  score: number;
  workModes: WorkMode[];
  reasons: string[];
  canonicalUrl: string;
  aiScore?: number;
  aiReason?: string;
};

export const DEFAULT_WATCH: Readonly<CareerWatch>;
export const AUTOMATION_WORK_MODES: readonly WorkMode[];
export const AUTOMATION_SOURCES: readonly AutomationSource[];
export function normalizeWatch(value?: Partial<CareerWatch>): CareerWatch;
export function inferWorkModes(offer: Partial<AutomationOffer>): WorkMode[];
export function canonicalOfferUrl(raw: string): string;
export function rankOffers(
  offers: AutomationOffer[],
  watch: Partial<CareerWatch>,
  now?: Date,
): RankedAutomationOffer[];
export function isWatchDue(
  watch: Partial<CareerWatch>,
  now?: Date | string,
): boolean;
