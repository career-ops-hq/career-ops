export interface PipelineJob {
  id: string;
  url: string;
  company: string;
  title: string;
  location: string;
  workModel: string;
  date: string;
  status: "pending" | "reviewed" | "applied" | "skipped";
  extra: string;
  fitScore?: number;
  recommendation?: "APPLY" | "REVIEW" | "SKIP";
  strengths?: string[];
  gaps?: string[];
  missingMandatorySkills?: string[];
  compatibilityPercent?: number;
  matchClassification?: "BEST MATCH" | "STRONG MATCH" | "POSSIBLE MATCH" | "LOW MATCH" | "SKIP";
  compatibilityTier?: "A" | "B" | "C" | "D";
  reason?: string;
  primaryStack?: string[];
  responsibilitySplit?: { frontend: string; backend: string; platform: string };
  evaluatedFrom?: "full-jd" | "pipeline-summary";
  salary?: string;
  hasTailoredCv?: boolean;
  tailoredPdfPath?: string;
}

export interface SystemStatus {
  candidate: { name: string; headline: string; location: string };
  masterCv: {
    mdExists: boolean;
    mdPath: string;
    mdModified: string | null;
    mdSize: number;
    pdfExists: boolean;
    pdfPath: string;
    pdfModified: string | null;
    pdfSize: number;
    pdfFilename: string;
  };
  lastScan: {
    lastRun: string | null;
    totalDiscovered: number;
    totalFiltered: number;
    totalDuplicates: number;
    totalAdded: number;
  };
  tailoredCount: number;
  pipelineCounts: {
    pending: number;
    processed: number;
  };
  activity: {
    currentOp: any;
    lastOp: any;
    history: any[];
  };
}

export interface TailoredCvFile {
  filename: string;
  filePath: string;
  sizeBytes: number;
  modified: string;
  isPdf: boolean;
}

export interface AiModelInfo {
  id: string;
  name: string;
  isDefault?: boolean;
}

export interface AiProviderInfo {
  id: string;
  name: string;
  enabled: boolean;
  available: boolean;
  status: "ready" | "not_installed" | "disabled" | "rate_limited" | "quota_exhausted" | "auth_required" | "temporary_unavailable" | "error";
  statusMessage?: string;
  models: AiModelInfo[];
  selectedModel: string;
  lastTestedAt?: string;
  responseTimeMs?: number;
}

export interface AiProvidersResponse {
  defaultProvider: string;
  fallbackEnabled: boolean;
  providers: AiProviderInfo[];
}

export interface AiProviderTestResult {
  provider: string;
  model: string;
  success: boolean;
  responseTimeMs: number;
  response?: string;
  status: string;
  error?: string;
}

const API_BASE = "";

export async function fetchStatus(): Promise<SystemStatus> {
  const res = await fetch(`${API_BASE}/api/status`);
  if (!res.ok) throw new Error("Failed to fetch status");
  const data = await res.json();
  return data;
}

export async function fetchPipeline(): Promise<{ pending: PipelineJob[]; processed: PipelineJob[] }> {
  const res = await fetch(`${API_BASE}/api/pipeline`);
  if (!res.ok) throw new Error("Failed to fetch pipeline");
  const data = await res.json();
  return { pending: data.pending, processed: data.processed };
}

export async function runJobSearch(): Promise<any> {
  const res = await fetch(`${API_BASE}/api/scan`, { method: "POST" });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || "Search failed");
  return data.data;
}

export async function runBulkJobSearch(): Promise<any> {
  const res = await fetch(`${API_BASE}/api/scan/bulk`, { method: "POST" });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || "Bulk search failed");
  return data.data;
}

export function isBestMatchOffer(job: PipelineJob): boolean {
  return job.matchClassification === "BEST MATCH";
}

export async function rerankPipeline(fullJdLimit = 60): Promise<any> {
  const res = await fetch(`${API_BASE}/api/evaluate/all`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fullJdLimit })
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || "Re-ranking failed");
  return data;
}

export async function evaluateJob(job: PipelineJob): Promise<any> {
  const res = await fetch(`${API_BASE}/api/evaluate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ job })
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || "Evaluation failed");
  return data.evaluation;
}

export async function generateTailoredCv(job: PipelineJob, providerId: string, model?: string): Promise<any> {
  const res = await fetch(`${API_BASE}/api/tailor-cv`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ job, providerId, model })
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || "Tailoring failed");
  return data;
}

export async function fetchAiProviders(): Promise<AiProvidersResponse> {
  const res = await fetch(`${API_BASE}/api/ai/providers`);
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || "Failed to load AI providers");
  return { defaultProvider: data.defaultProvider, fallbackEnabled: data.fallbackEnabled, providers: data.providers };
}

export async function updateAiConfig(update: {
  defaultProvider?: string;
  fallbackEnabled?: boolean;
  providerId?: string;
  model?: string;
}): Promise<void> {
  const res = await fetch(`${API_BASE}/api/ai/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update)
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || "Failed to update AI settings");
}

export async function testAiProvider(providerId: string, model?: string): Promise<AiProviderTestResult> {
  const res = await fetch(`${API_BASE}/api/ai/providers/${encodeURIComponent(providerId)}/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model })
  });
  const data = await res.json();
  if (!data || typeof data.success !== "boolean") throw new Error(data.error || "Provider test failed");
  return data;
}

export async function updateJobStatus(url: string, status: "reviewed" | "applied" | "skipped"): Promise<boolean> {
  const res = await fetch(`${API_BASE}/api/pipeline/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, status })
  });
  const data = await res.json();
  return data.success;
}

export async function openTarget(type: "master-cv" | "master-pdf" | "master-folder" | "cv-folder" | "tailored-cv" | "url", payload?: string): Promise<any> {
  const res = await fetch(`${API_BASE}/api/open`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, payload })
  });
  const data = await res.json();
  return data;
}

export async function fetchTailoredCvs(): Promise<TailoredCvFile[]> {
  const res = await fetch(`${API_BASE}/api/tailored-cvs`);
  const data = await res.json();
  return data.cvs || [];
}

export async function fetchActivity(): Promise<any> {
  const res = await fetch(`${API_BASE}/api/activity`);
  const data = await res.json();
  return data;
}

export interface TailoringDiffData {
  jobId: string;
  company: string;
  role: string;
  url: string;
  location?: string;
  generatedAt: string;
  provider?: string;
  model?: string;
  durationMs?: number;
  success?: boolean;
  factCheck?: string;
  aiProvider: string;
  aiModel: string;
  llmTailoringExecuted: boolean;
  factValidation: string;
  pages: number;
  tailoringDiff: {
    summary_focus: string;
    skills_promoted: string[];
    skills_omitted?: Array<{ domain: string; reason: string }>;
    projects_selected: Array<{ name: string; reason: string }>;
    jd_keywords_matched: string[];
    experience_emphasis: string;
  };
  htmlPath: string;
  pdfPath: string;
}

export async function fetchTailoringDiff(company: string, title?: string): Promise<TailoringDiffData | null> {
  const params = new URLSearchParams({ company, title: title || "" });
  const res = await fetch(`${API_BASE}/api/tailor-cv/diff?${params.toString()}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.data || null;
}
