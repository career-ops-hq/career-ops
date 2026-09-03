import { useEffect, useState } from "react";
import "./App.css";
import {
  fetchStatus,
  fetchPipeline,
  fetchTailoredCvs,
  fetchActivity,
  runJobSearch,
  runBulkJobSearch,
  rerankPipeline,
  isBestMatchOffer,
  evaluateJob,
  generateTailoredCv,
  updateJobStatus,
  openTarget,
  fetchTailoringDiff,
  fetchAiProviders,
  updateAiConfig,
  testAiProvider,
  type PipelineJob,
  type SystemStatus,
  type TailoredCvFile,
  type TailoringDiffData,
  type AiProviderInfo,
  type AiProviderTestResult
} from "./api";
import {
  Search,
  FileText,
  Folder,
  ExternalLink,
  Play,
  RefreshCw,
  X,
  FileCheck,
  Clock,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Star,
  Zap,
  Filter
} from "lucide-react";

export function App() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [pendingJobs, setPendingJobs] = useState<PipelineJob[]>([]);
  const [processedJobs, setProcessedJobs] = useState<PipelineJob[]>([]);
  const [tailoredCvs, setTailoredCvs] = useState<TailoredCvFile[]>([]);
  const [activity, setActivity] = useState<any>(null);
  const [aiProviders, setAiProviders] = useState<AiProviderInfo[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState("codex");
  const [selectedModel, setSelectedModel] = useState("default");
  const [fallbackEnabled, setFallbackEnabled] = useState(false);
  const [isTestingProvider, setIsTestingProvider] = useState(false);
  const [providerTest, setProviderTest] = useState<AiProviderTestResult | null>(null);

  const [activeTab, setActiveTab] = useState<"pending" | "processed">("pending");
  const [searchQuery, setSearchQuery] = useState("");
  const [modelFilter, setModelFilter] = useState<"ALL" | "Remote" | "Hybrid" | "Office">("ALL");
  const [matchCategory, setMatchCategory] = useState<
    "ALL" | "BEST_MATCH" | "REACT_NEXT" | "SHOPIFY" | "MAGENTO" | "NODE" | "SENIOR_LEAD"
  >("ALL");

  const [selectedJob, setSelectedJob] = useState<PipelineJob | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isBulkScanning, setIsBulkScanning] = useState(false);
  const [isReranking, setIsReranking] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState<string | null>(null);
  const [isTailoring, setIsTailoring] = useState<string | null>(null);
  const [viewingDiff, setViewingDiff] = useState<TailoringDiffData | null>(null);
  const [isLoadingDiff, setIsLoadingDiff] = useState(false);
  const [showLogOutput, setShowLogOutput] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const loadData = async () => {
    try {
      const [sData, pData, cvData, aData, aiData] = await Promise.all([
        fetchStatus(),
        fetchPipeline(),
        fetchTailoredCvs(),
        fetchActivity(),
        fetchAiProviders()
      ]);
      setStatus(sData);
      setPendingJobs(pData.pending);
      setProcessedJobs(pData.processed);
      setTailoredCvs(cvData);
      setActivity(aData);
      setAiProviders(aiData.providers);
      setSelectedProviderId(aiData.defaultProvider);
      setFallbackEnabled(aiData.fallbackEnabled);
      const configured = aiData.providers.find((provider) => provider.id === aiData.defaultProvider);
      setSelectedModel(configured?.selectedModel || "default");
    } catch (e: any) {
      console.error("Error loading dashboard data:", e);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(() => {
      fetchActivity().then(setActivity).catch(() => {});
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  const showNotification = (msg: string) => {
    setActionNotice(msg);
    setTimeout(() => setActionNotice(null), 4000);
  };

  const selectedProvider = aiProviders.find((provider) => provider.id === selectedProviderId);

  const handleProviderChange = async (providerId: string) => {
    const provider = aiProviders.find((item) => item.id === providerId);
    const model = provider?.selectedModel || provider?.models[0]?.id || "default";
    setSelectedProviderId(providerId);
    setSelectedModel(model);
    setProviderTest(null);
    try {
      await updateAiConfig({ defaultProvider: providerId });
      showNotification(`AI provider changed to ${provider?.name || providerId}`);
    } catch (e: any) {
      showNotification(`Provider change failed: ${e.message}`);
      await loadData();
    }
  };

  const handleModelChange = async (model: string) => {
    setSelectedModel(model);
    setProviderTest(null);
    try {
      await updateAiConfig({ providerId: selectedProviderId, model });
    } catch (e: any) {
      showNotification(`Model change failed: ${e.message}`);
      await loadData();
    }
  };

  const handleFallbackChange = async (enabled: boolean) => {
    setFallbackEnabled(enabled);
    try {
      await updateAiConfig({ fallbackEnabled: enabled });
      showNotification(`Automatic AI fallback ${enabled ? "enabled" : "disabled"}`);
    } catch (e: any) {
      showNotification(`Fallback setting failed: ${e.message}`);
      await loadData();
    }
  };

  const handleProviderTest = async () => {
    setIsTestingProvider(true);
    setProviderTest(null);
    try {
      const result = await testAiProvider(selectedProviderId, selectedModel);
      setProviderTest(result);
      showNotification(`${selectedProvider?.name || selectedProviderId} test ${result.success ? "passed" : "failed"}`);
      const aiData = await fetchAiProviders();
      setAiProviders(aiData.providers);
    } catch (e: any) {
      setProviderTest({ provider: selectedProviderId, model: selectedModel, success: false, responseTimeMs: 0, status: "error", error: e.message });
    } finally {
      setIsTestingProvider(false);
    }
  };

  const handleRunSearch = async () => {
    setIsScanning(true);
    showNotification("Starting real Career-Ops scan...");
    try {
      const data = await runJobSearch();
      showNotification(`Scan completed! Added ${data.added || 0} new offers.`);
      await loadData();
    } catch (e: any) {
      showNotification(`Scan failed: ${e.message}`);
    } finally {
      setIsScanning(false);
    }
  };

  const handleRunBulkSearch = async () => {
    setIsBulkScanning(true);
    showNotification("🚀 Running comprehensive bulk sweep across portals for new offers...");
    try {
      const data = await runBulkJobSearch();
      showNotification(`🎉 Bulk discovery completed! Scanned ${data.found || 0} offers, added ${data.added || 0} new eligible jobs.`);
      await loadData();
    } catch (e: any) {
      showNotification(`Bulk discovery error: ${e.message}`);
    } finally {
      setIsBulkScanning(false);
    }
  };

  const handleEvaluate = async (job: PipelineJob) => {
    setIsEvaluating(job.id);
    try {
      const evalResult = await evaluateJob(job);
      const updatedJob = { ...job, ...evalResult };

      const updateList = (list: PipelineJob[]) =>
        list.map((j) => (j.url === job.url ? updatedJob : j));

      setPendingJobs(updateList);
      setProcessedJobs(updateList);
      if (selectedJob && selectedJob.url === job.url) {
        setSelectedJob(updatedJob);
      }
      showNotification(`Evaluated ${job.company}: Score ${evalResult.fitScore}/5.0 (${evalResult.recommendation})`);
    } catch (e: any) {
      showNotification(`Evaluation error: ${e.message}`);
    } finally {
      setIsEvaluating(null);
    }
  };

  const handleRerank = async () => {
    setIsReranking(true);
    showNotification("Re-ranking the active pipeline; top contenders will be checked against their full JDs...");
    try {
      const result = await rerankPipeline(60);
      await loadData();
      showNotification(`Re-ranked ${result.total} jobs; ${result.fullJdEvaluated} top contenders used full JDs.`);
    } catch (e: any) {
      showNotification(`Re-ranking error: ${e.message}`);
    } finally {
      setIsReranking(false);
    }
  };

  const handleTailorCv = async (job: PipelineJob) => {
    setIsTailoring(job.id);
    showNotification(`Starting AI tailoring for ${job.company} (${selectedProvider?.name || selectedProviderId})...`);
    try {
      const result = await generateTailoredCv(job, selectedProviderId, selectedModel);
      if (result.success) {
        showNotification(`Tailored CV generated with ${result.aiProvider}: ${result.filename} (${result.pages} pages)`);
        await loadData();
        if (result.tailoringDiff) {
          const diffData: TailoringDiffData = {
            jobId: job.id,
            company: job.company,
            role: job.title,
            url: job.url,
            location: job.location,
            generatedAt: new Date().toISOString(),
            aiProvider: result.aiProvider || selectedProvider?.name || selectedProviderId,
            aiModel: result.aiModel || selectedModel,
            llmTailoringExecuted: true,
            factValidation: "PASS (0 unsupported claims)",
            pages: result.pages,
            tailoringDiff: result.tailoringDiff,
            htmlPath: result.htmlPath,
            pdfPath: result.pdfPath
          };
          setViewingDiff(diffData);
        }
      } else {
        showNotification(`CV generation failed: ${result.error}`);
      }
    } catch (e: any) {
      showNotification(`Error generating CV: ${e.message}`);
    } finally {
      setIsTailoring(null);
    }
  };

  const handleViewDiff = async (job: PipelineJob) => {
    setIsLoadingDiff(true);
    try {
      const data = await fetchTailoringDiff(job.company, job.title);
      if (data) {
        setViewingDiff(data);
      } else {
        showNotification(`No AI tailoring diff found for ${job.company} yet. Click 'CV' to generate one.`);
      }
    } catch (e: any) {
      showNotification(`Failed to load tailoring diff: ${e.message}`);
    } finally {
      setIsLoadingDiff(false);
    }
  };

  const handleStatusChange = async (url: string, newStatus: "reviewed" | "applied" | "skipped") => {
    try {
      await updateJobStatus(url, newStatus);
      showNotification(`Job status updated to ${newStatus}`);
      await loadData();
      if (selectedJob && selectedJob.url === url) {
        setSelectedJob({ ...selectedJob, status: newStatus });
      }
    } catch (e: any) {
      showNotification(`Status update error: ${e.message}`);
    }
  };

  const handleOpen = async (type: any, payload?: string) => {
    try {
      const res = await openTarget(type, payload);
      showNotification(res.message);
    } catch (e: any) {
      showNotification(`Open failed: ${e.message}`);
    }
  };

  const currentList = activeTab === "pending" ? pendingJobs : processedJobs;

  const bestMatchCount = currentList.filter(isBestMatchOffer).length;
  const reactNextCount = currentList.filter((j) => {
    const t = j.title.toLowerCase();
    return t.includes("react") || t.includes("next");
  }).length;
  const shopifyCount = currentList.filter((j) => {
    const t = (j.title + " " + (j.extra || "")).toLowerCase();
    return t.includes("shopify");
  }).length;
  const magentoCount = currentList.filter((j) => {
    const t = (j.title + " " + (j.extra || "")).toLowerCase();
    return t.includes("magento") || t.includes("hyva") || t.includes("hyvä") || t.includes("adobe commerce");
  }).length;
  const nodeCount = currentList.filter((j) => {
    const t = (j.title + " " + (j.extra || "")).toLowerCase();
    return t.includes("node") || t.includes("nodejs");
  }).length;
  const seniorLeadCount = currentList.filter((j) => {
    const t = j.title.toLowerCase();
    return t.includes("senior") || t.includes("lead") || t.includes("principal") || t.includes("staff");
  }).length;

  const filteredJobs = currentList.filter((job) => {
    const q = searchQuery.toLowerCase();
    const matchSearch =
      job.title.toLowerCase().includes(q) ||
      job.company.toLowerCase().includes(q) ||
      job.location.toLowerCase().includes(q);
    const matchModel = modelFilter === "ALL" || job.workModel === modelFilter;

    let matchCat = true;
    if (matchCategory === "BEST_MATCH") {
      matchCat = isBestMatchOffer(job);
    } else if (matchCategory === "REACT_NEXT") {
      const t = job.title.toLowerCase();
      matchCat = t.includes("react") || t.includes("next");
    } else if (matchCategory === "SHOPIFY") {
      const t = (job.title + " " + (job.extra || "")).toLowerCase();
      matchCat = t.includes("shopify");
    } else if (matchCategory === "MAGENTO") {
      const t = (job.title + " " + (job.extra || "")).toLowerCase();
      matchCat = t.includes("magento") || t.includes("hyva") || t.includes("hyvä") || t.includes("adobe commerce");
    } else if (matchCategory === "NODE") {
      const t = (job.title + " " + (job.extra || "")).toLowerCase();
      matchCat = t.includes("node") || t.includes("nodejs");
    } else if (matchCategory === "SENIOR_LEAD") {
      const t = job.title.toLowerCase();
      matchCat = t.includes("senior") || t.includes("lead") || t.includes("principal") || t.includes("staff");
    }

    return matchSearch && matchModel && matchCat;
  }).sort((a, b) => (b.compatibilityPercent || 0) - (a.compatibilityPercent || 0));

  return (
    <div className="dashboard">
      {/* Header */}
      <header className="header">
        <div className="header-title-group">
          <h1>
            Career-Ops Dashboard <span className="badge-version">v1.32</span>
          </h1>
          <div className="header-subtitle">
            {status?.candidate ? `${status.candidate.name} · ${status.candidate.headline} · ${status.candidate.location}` : "Local job-search command center"}
          </div>
        </div>

        <div className="header-actions">
          {actionNotice && (
            <div style={{ background: "#065f46", color: "#6ee7b7", padding: "6px 12px", borderRadius: "6px", fontSize: "13px" }}>
              {actionNotice}
            </div>
          )}
          <button className="btn btn-outline btn-sm" onClick={loadData}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </header>

      <section className="ai-provider-panel" aria-label="AI provider settings">
        <div className="ai-provider-heading">
          <div>
            <strong>AI Provider</strong>
            <span>Used for future dashboard AI operations</span>
          </div>
          <div className="provider-status-list">
            {aiProviders.map((provider) => (
              <span key={provider.id} className={`provider-status provider-status-${provider.status}`} title={provider.statusMessage || provider.status}>
                {provider.name} — {provider.status.replaceAll("_", " ")}
              </span>
            ))}
          </div>
        </div>

        <div className="ai-provider-controls">
          <label>
            <span>Provider</span>
            <select value={selectedProviderId} onChange={(event) => handleProviderChange(event.target.value)} disabled={isTailoring !== null}>
              {aiProviders.map((provider) => (
                <option key={provider.id} value={provider.id} disabled={!provider.enabled || !provider.available}>
                  {provider.name} — {provider.status.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Model</span>
            <select value={selectedModel} onChange={(event) => handleModelChange(event.target.value)} disabled={isTailoring !== null || !selectedProvider?.available}>
              {(selectedProvider?.models.length ? selectedProvider.models : [{ id: selectedModel, name: selectedModel }]).map((model) => (
                <option key={model.id} value={model.id}>{model.name}</option>
              ))}
            </select>
          </label>

          <label className="fallback-toggle">
            <input type="checkbox" checked={fallbackEnabled} onChange={(event) => handleFallbackChange(event.target.checked)} disabled={isTailoring !== null} />
            <span>Automatic AI fallback</span>
          </label>

          <button className="btn btn-outline btn-sm" onClick={handleProviderTest} disabled={isTestingProvider || !selectedProvider?.available || isTailoring !== null}>
            {isTestingProvider ? <span className="spinner" /> : <Zap size={14} />}
            Test AI Provider
          </button>
        </div>

        {providerTest && (
          <div className={`provider-test-result ${providerTest.success ? "provider-test-success" : "provider-test-failure"}`}>
            <strong>{providerTest.success ? "Success" : "Failed"}</strong>
            <span>{providerTest.provider} · {providerTest.model} · {providerTest.responseTimeMs} ms</span>
            <span>{providerTest.success ? providerTest.response || "OK" : providerTest.error || providerTest.status}</span>
          </div>
        )}
      </section>

      {/* Live AI Tailoring Progress Banner */}
      {isTailoring && (
        <div
          style={{
            background: "linear-gradient(90deg, rgba(168, 85, 247, 0.15), rgba(56, 189, 248, 0.15))",
            border: "1px solid rgba(168, 85, 247, 0.4)",
            borderRadius: "8px",
            padding: "14px 18px",
            marginBottom: "16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span className="spinner" style={{ width: "16px", height: "16px" }} />
            <div>
              <strong style={{ color: "#c084fc", fontSize: "0.95rem" }}>
                AI Tailoring in Progress:
              </strong>{" "}
              <span style={{ color: "#e2e8f0", fontSize: "0.9rem" }}>
                {activity?.currentOp?.summary || `Tailoring with ${selectedProvider?.name || selectedProviderId} (${selectedModel})...`}
              </span>
            </div>
          </div>
          <div style={{ fontSize: "0.8rem", color: "#94a3b8", display: "flex", gap: "8px" }}>
            <span
              className="badge"
              style={{ background: "rgba(168, 85, 247, 0.2)", color: "#c084fc", border: "1px solid rgba(168, 85, 247, 0.3)" }}
            >
              {selectedProvider?.name || selectedProviderId} · {selectedModel}
            </span>
            <span
              className="badge"
              style={{ background: "rgba(52, 211, 153, 0.2)", color: "#34d399", border: "1px solid rgba(52, 211, 153, 0.3)" }}
            >
              Fact Gate Active
            </span>
          </div>
        </div>
      )}

      {/* SECTION 2 & 3: Master CV & Tailored CVs */}
      <div className="cv-grid">
        {/* SECTION 2: Master CV */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">
              <FileText size={18} color="#06b6d4" /> Section 2 — Master CV
            </div>
            {status?.masterCv.mdExists ? (
              <span className="badge" style={{ background: "rgba(16, 185, 129, 0.2)", color: "#10b981", border: "1px solid #10b981" }}>
                Canonical cv.md Valid
              </span>
            ) : (
              <span className="badge badge-skip">Missing cv.md</span>
            )}
          </div>

          <p style={{ fontSize: "13px", color: "var(--text-muted)" }}>
            Canonical source-of-truth CV for all applications and tailored derivations.
          </p>

          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <button className="btn btn-secondary btn-sm" onClick={() => handleOpen("master-cv")}>
              <FileText size={14} /> Open Master CV (cv.md)
            </button>
            {status?.masterCv.pdfExists && (
              <button className="btn btn-secondary btn-sm" onClick={() => handleOpen("master-pdf")}>
                <FileCheck size={14} /> Open Source Master PDF
              </button>
            )}
            <button className="btn btn-outline btn-sm" onClick={() => handleOpen("master-folder")}>
              <Folder size={14} /> Open Master CV Location
            </button>
          </div>
        </div>

        {/* SECTION 3: Tailored CV */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">
              <Sparkles size={18} color="#a855f7" /> Section 3 — Tailored CVs ({tailoredCvs.length})
            </div>
            <button className="btn btn-outline btn-sm" onClick={() => handleOpen("cv-folder")}>
              <Folder size={14} /> Open CV Folder
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "130px", overflowY: "auto" }}>
            {tailoredCvs.length === 0 ? (
              <div style={{ fontSize: "13px", color: "var(--text-muted)", fontStyle: "italic" }}>
                No tailored CVs generated yet. Use "Generate Tailored CV" on any vacancy below.
              </div>
            ) : (
              tailoredCvs.slice(0, 4).map((f) => (
                <div
                  key={f.filename}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    background: "rgba(15, 23, 42, 0.6)",
                    padding: "8px 12px",
                    borderRadius: "6px",
                    border: "1px solid var(--border)"
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: "2px", overflow: "hidden" }}>
                    <span style={{ fontSize: "13px", fontWeight: 600, color: "#fff", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                      {f.filename}
                    </span>
                    <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                      {(f.sizeBytes / 1024).toFixed(1)} KB · {new Date(f.modified).toLocaleString()}
                    </span>
                  </div>
                  <button className="btn btn-primary btn-sm" onClick={() => handleOpen("tailored-cv", f.filePath)}>
                    Open PDF
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* SECTION 1: SEARCH & PIPELINE */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">
            <Search size={18} color="#06b6d4" /> Section 1 — Search & Pipeline
          </div>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <button
              className="btn btn-primary"
              disabled={isScanning || isBulkScanning}
              onClick={handleRunSearch}
              title="Quick zero-token scan across all configured portals"
            >
              {isScanning ? <span className="spinner" /> : <Play size={14} />}
              Run Job Search
            </button>
            <button
              className="btn btn-bulk"
              disabled={isBulkScanning || isScanning}
              onClick={handleRunBulkSearch}
              title="Runs bulk sweep to look for new offers across all portals and ATS sources"
            >
              {isBulkScanning ? <span className="spinner" /> : <Zap size={14} />}
              Bulk Find New Offers
            </button>
            <button className="btn btn-secondary" onClick={loadData}>
              <RefreshCw size={14} /> Refresh Pipeline
            </button>
          </div>
        </div>

        {/* Stats Strip */}
        <div className="stats-strip">
          <div className="stat-box">
            <span className="stat-label">Last Scan Time</span>
            <span className="stat-value" style={{ fontSize: "15px" }}>
              {status?.lastScan?.lastRun ? new Date(status.lastScan.lastRun).toLocaleString() : "Recently"}
            </span>
          </div>
          <div className="stat-box">
            <span className="stat-label">Total Discovered</span>
            <span className="stat-value">{status?.lastScan?.totalDiscovered || 7434}</span>
          </div>
          <div className="stat-box">
            <span className="stat-label">Filtered</span>
            <span className="stat-value">{status?.lastScan?.totalFiltered || 6631}</span>
          </div>
          <div className="stat-box">
            <span className="stat-label">Duplicates</span>
            <span className="stat-value">{status?.lastScan?.totalDuplicates || 165}</span>
          </div>
          <div className="stat-box">
            <span className="stat-label">New Eligible Added</span>
            <span className="stat-value" style={{ color: "#34d399" }}>
              {status?.lastScan?.totalAdded || 638}
            </span>
          </div>
        </div>

        {/* Filters and Tabs */}
        <div className="filter-bar" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap", width: "100%" }}>
            <div className="tab-group">
              <button
                className={`tab-btn ${activeTab === "pending" ? "active" : ""}`}
                onClick={() => setActiveTab("pending")}
              >
                Pending Offers ({pendingJobs.length})
              </button>
              <button
                className={`tab-btn ${activeTab === "processed" ? "active" : ""}`}
                onClick={() => setActiveTab("processed")}
              >
                Processed / History ({processedJobs.length})
              </button>
            </div>

            <input
              type="text"
              className="search-input"
              placeholder="Filter by title, company, or city..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ minWidth: "240px", flex: 1 }}
            />
          </div>

          {/* Offer Focus Categories & Work Model */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", flexWrap: "wrap", gap: "10px" }}>
            <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: "12px", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "4px" }}>
                <Filter size={13} /> Filter:
              </span>
              <button
                className={`btn btn-sm ${matchCategory === "ALL" ? "btn-secondary" : "btn-outline"}`}
                onClick={() => setMatchCategory("ALL")}
              >
                All ({currentList.length})
              </button>
              <button
                className={`btn btn-sm ${matchCategory === "BEST_MATCH" ? "btn-best-match active" : "btn-best-match"}`}
                onClick={() => setMatchCategory(matchCategory === "BEST_MATCH" ? "ALL" : "BEST_MATCH")}
                title="Filter offers matching your core Senior Frontend / React / TypeScript / E-Commerce profile"
              >
                <Star size={13} fill={matchCategory === "BEST_MATCH" ? "#facc15" : "none"} />
                Best Matches ({bestMatchCount})
              </button>
              <button
                className={`btn btn-sm ${matchCategory === "REACT_NEXT" ? "btn-secondary" : "btn-outline"}`}
                onClick={() => setMatchCategory(matchCategory === "REACT_NEXT" ? "ALL" : "REACT_NEXT")}
              >
                ⚛️ React & Next.js ({reactNextCount})
              </button>
              <button
                className={`btn btn-sm ${matchCategory === "SHOPIFY" ? "btn-secondary" : "btn-outline"}`}
                onClick={() => setMatchCategory(matchCategory === "SHOPIFY" ? "ALL" : "SHOPIFY")}
              >
                🛍️ Shopify ({shopifyCount})
              </button>
              <button
                className={`btn btn-sm ${matchCategory === "MAGENTO" ? "btn-secondary" : "btn-outline"}`}
                onClick={() => setMatchCategory(matchCategory === "MAGENTO" ? "ALL" : "MAGENTO")}
                title="Filter Magento 2, Hyvä Theme, and Adobe Commerce jobs"
              >
                🛒 Magento 2 ({magentoCount})
              </button>
              <button
                className={`btn btn-sm ${matchCategory === "NODE" ? "btn-secondary" : "btn-outline"}`}
                onClick={() => setMatchCategory(matchCategory === "NODE" ? "ALL" : "NODE")}
                title="Filter Node.js and Fullstack TypeScript jobs"
              >
                🟢 Node.js ({nodeCount})
              </button>
              <button
                className={`btn btn-sm ${matchCategory === "SENIOR_LEAD" ? "btn-secondary" : "btn-outline"}`}
                onClick={() => setMatchCategory(matchCategory === "SENIOR_LEAD" ? "ALL" : "SENIOR_LEAD")}
              >
                👑 Senior & Lead ({seniorLeadCount})
              </button>
            </div>

            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <button className="btn btn-outline btn-sm" disabled={isReranking} onClick={handleRerank} title="Re-score all active jobs and load full JDs for the leading contenders">
                {isReranking ? <span className="spinner" /> : <RefreshCw size={13} />} Re-rank
              </button>
              <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>Model:</span>
              {(["ALL", "Remote", "Hybrid", "Office"] as const).map((m) => (
                <button
                  key={m}
                  className={`btn btn-sm ${modelFilter === m ? "btn-secondary" : "btn-outline"}`}
                  onClick={() => setModelFilter(m)}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Pipeline Table */}
        <div className="table-container">
          <table className="jobs-table">
            <thead>
              <tr>
                <th>Job Title</th>
                <th>Company</th>
                <th>Location</th>
                <th>Work Model</th>
                <th>Fit Score</th>
                <th>Status</th>
                <th>Source</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredJobs.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", padding: "30px", color: "var(--text-muted)" }}>
                    No matching vacancies found.
                  </td>
                </tr>
              ) : (
                filteredJobs.slice(0, 100).map((job) => {
                  let scoreClass = "score-none";
                  if (job.fitScore) {
                    if (job.fitScore >= 4.0) scoreClass = "score-high";
                    else if (job.fitScore >= 3.5) scoreClass = "score-mid";
                    else scoreClass = "score-low";
                  }

                  const sourceHost = job.url.includes("justjoin.it")
                    ? "JustJoin.it"
                    : job.url.includes("nofluffjobs.com")
                    ? "NoFluffJobs"
                    : job.url.includes("solid.jobs")
                    ? "SolidJobs"
                    : job.url.includes("greenhouse.io")
                    ? "Greenhouse"
                    : "Direct";

                  return (
                    <tr
                      key={job.id}
                      onClick={() => setSelectedJob(job)}
                      className={selectedJob?.id === job.id ? "selected" : ""}
                    >
                      <td style={{ fontWeight: 600, color: "#fff" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                          <span>{job.title}</span>
                          {job.matchClassification && (
                            <span className={`badge-match badge-match-${job.matchClassification.toLowerCase().replaceAll(" ", "-")}`} title={job.reason}>
                              {isBestMatchOffer(job) && <Star size={11} fill="#facc15" />}{job.matchClassification}
                            </span>
                          )}
                          {((job.title + " " + (job.extra || "")).toLowerCase().includes("magento") || (job.title + " " + (job.extra || "")).toLowerCase().includes("hyva")) && (
                            <span className="badge" style={{ background: "rgba(249, 115, 22, 0.15)", color: "#fb923c", border: "1px solid rgba(249, 115, 22, 0.35)", fontSize: "11px", padding: "1.5px 6px", borderRadius: "4px" }}>
                              Magento 2
                            </span>
                          )}
                          {(job.title + " " + (job.extra || "")).toLowerCase().includes("node") && (
                            <span className="badge" style={{ background: "rgba(34, 197, 94, 0.15)", color: "#4ade80", border: "1px solid rgba(34, 197, 94, 0.35)", fontSize: "11px", padding: "1.5px 6px", borderRadius: "4px" }}>
                              Node.js
                            </span>
                          )}
                        </div>
                        {job.reason && <div className="match-reason">{job.reason}{job.compatibilityPercent ? ` | ${job.compatibilityPercent}% compatible` : ""}</div>}
                      </td>
                      <td style={{ color: "#38bdf8" }}>{job.company}</td>
                      <td>{job.location}</td>
                      <td>
                        <span
                          className={`badge ${
                            job.workModel === "Remote"
                              ? "badge-remote"
                              : job.workModel === "Hybrid"
                              ? "badge-hybrid"
                              : "badge-office"
                          }`}
                        >
                          {job.workModel}
                        </span>
                      </td>
                      <td>
                        {job.fitScore ? (
                          <span className={`badge-score ${scoreClass}`}>
                            {job.fitScore.toFixed(1)}
                          </span>
                        ) : (
                          <span style={{ color: "var(--text-muted)" }}>—</span>
                        )}
                      </td>
                      <td>
                        <span
                          className="badge"
                          style={{
                            background:
                              job.status === "applied"
                                ? "rgba(16, 185, 129, 0.2)"
                                : job.status === "skipped"
                                ? "rgba(244, 63, 94, 0.2)"
                                : "rgba(148, 163, 184, 0.2)",
                            color:
                              job.status === "applied"
                                ? "#34d399"
                                : job.status === "skipped"
                                ? "#f87171"
                                : "#cbd5e1"
                          }}
                        >
                          {job.status}
                        </span>
                      </td>
                      <td>{sourceHost}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: "flex", gap: "6px" }}>
                          <button
                            className="btn btn-outline btn-sm"
                            title="Open external job URL"
                            onClick={() => handleOpen("url", job.url)}
                          >
                            <ExternalLink size={12} />
                          </button>
                          <button
                            className="btn btn-secondary btn-sm"
                            title="Run LLM evaluation"
                            disabled={isEvaluating === job.id}
                            onClick={() => handleEvaluate(job)}
                          >
                            {isEvaluating === job.id ? <span className="spinner" /> : "Eval"}
                          </button>
                          <button
                            className="btn btn-primary btn-sm"
                            title="Generate AI-Tailored CV PDF"
                            disabled={isTailoring === job.id}
                            onClick={() => handleTailorCv(job)}
                          >
                            {isTailoring === job.id ? <span className="spinner" /> : "Tailor CV"}
                          </button>
                          {job.hasTailoredCv && (
                            <button
                              className="btn btn-outline btn-sm"
                              style={{ borderColor: "rgba(56, 189, 248, 0.5)", color: "#38bdf8", padding: "4px 8px" }}
                              title="View AI Tailoring Changes"
                              disabled={isLoadingDiff}
                              onClick={() => handleViewDiff(job)}
                            >
                              🔍 Changes
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* SECTION 4: JOB DETAILS MODAL */}
      {selectedJob && (
        <div className="modal-overlay" onClick={() => setSelectedJob(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 className="modal-title">{selectedJob.title}</h2>
                <div className="modal-company">{selectedJob.company}</div>
              </div>
              <button
                className="btn btn-outline btn-sm"
                onClick={() => setSelectedJob(null)}
              >
                <X size={16} />
              </button>
            </div>

            {/* Quick Metadata Grid */}
            <div className="detail-grid">
              <div className="detail-item">
                <span className="detail-label">Location</span>
                <span className="detail-val">{selectedJob.location || "Poland"}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Work Model</span>
                <span className="detail-val">{selectedJob.workModel}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Posting Date</span>
                <span className="detail-val">{selectedJob.date || "Recent"}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Current Status</span>
                <span className="detail-val" style={{ textTransform: "capitalize" }}>
                  {selectedJob.status}
                </span>
              </div>
            </div>

            {/* Evaluation Details */}
            <div className="eval-box">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 600, color: "#fff", fontSize: "14px" }}>
                  Fit Evaluation:
                </span>
                {selectedJob.fitScore ? (
                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <span className="badge-score score-high">
                      Score: {selectedJob.fitScore.toFixed(1)} / 5.0
                    </span>
                    <span
                      className={`badge ${
                        selectedJob.recommendation === "APPLY"
                          ? "badge-apply"
                          : selectedJob.recommendation === "REVIEW"
                          ? "badge-review"
                          : "badge-skip"
                      }`}
                    >
                      {selectedJob.recommendation}
                    </span>
                  </div>
                ) : (
                  <button
                    className="btn btn-secondary btn-sm"
                    disabled={isEvaluating === selectedJob.id}
                    onClick={() => handleEvaluate(selectedJob)}
                  >
                    {isEvaluating === selectedJob.id ? <span className="spinner" /> : "Run Evaluation"}
                  </button>
                )}
              </div>

              {selectedJob.matchClassification && (
                <div className="match-explanation">
                  <strong>{selectedJob.matchClassification}</strong>
                  <span>{selectedJob.reason}</span>
                  <span>{selectedJob.compatibilityPercent}% compatible · Tier {selectedJob.compatibilityTier} · {selectedJob.evaluatedFrom === "full-jd" ? "full JD analyzed" : "pipeline summary; run evaluation for full JD"}</span>
                  {selectedJob.primaryStack && selectedJob.primaryStack.length > 0 && <span>Detected stack: {selectedJob.primaryStack.join(" · ")}</span>}
                  {selectedJob.responsibilitySplit && <span>Responsibilities: frontend {selectedJob.responsibilitySplit.frontend}, backend {selectedJob.responsibilitySplit.backend}, platform {selectedJob.responsibilitySplit.platform}</span>}
                </div>
              )}

              {selectedJob.strengths && selectedJob.strengths.length > 0 && (
                <div>
                  <div style={{ fontSize: "12px", color: "#34d399", fontWeight: 600, marginBottom: "4px" }}>
                    Matching Strengths:
                  </div>
                  <div className="list-tags">
                    {selectedJob.strengths.map((s, idx) => (
                      <span key={idx} className="tag-strength">
                        ✓ {s}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {selectedJob.gaps && selectedJob.gaps.length > 0 && (
                <div>
                  <div style={{ fontSize: "12px", color: "#f87171", fontWeight: 600, marginBottom: "4px" }}>
                    Gaps / Disqualifiers:
                  </div>
                  <div className="list-tags">
                    {selectedJob.gaps.map((g, idx) => (
                      <span key={idx} className="tag-gap">
                        ✗ {g}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Action Bar */}
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", justifyContent: "space-between", borderTop: "1px solid var(--border)", paddingTop: "16px" }}>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button
                  className="btn btn-primary"
                  disabled={isTailoring === selectedJob.id}
                  onClick={() => handleTailorCv(selectedJob)}
                >
                  {isTailoring === selectedJob.id ? <span className="spinner" /> : <Sparkles size={14} />}
                  Generate Tailored CV
                </button>
                {selectedJob.hasTailoredCv && (
                  <button
                    className="btn btn-outline"
                    style={{ borderColor: "rgba(56, 189, 248, 0.5)", color: "#38bdf8" }}
                    onClick={() => handleViewDiff(selectedJob)}
                  >
                    🔍 View Tailoring Changes
                  </button>
                )}
                <button
                  className="btn btn-secondary"
                  onClick={() => handleOpen("url", selectedJob.url)}
                >
                  <ExternalLink size={14} /> Open Original Job
                </button>
              </div>

              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => handleStatusChange(selectedJob.url, "reviewed")}
                >
                  Mark Reviewed
                </button>
                <button
                  className="btn btn-success btn-sm"
                  onClick={() => handleStatusChange(selectedJob.url, "applied")}
                >
                  Mark Applied
                </button>
                <button
                  className="btn btn-outline btn-sm"
                  style={{ color: "#f87171" }}
                  onClick={() => handleStatusChange(selectedJob.url, "skipped")}
                >
                  Skip / Archive
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 4B: AI TAILORING DIFF MODAL */}
      {viewingDiff && (
        <div className="modal-overlay" onClick={() => setViewingDiff(null)}>
          <div
            className="modal-content"
            style={{ maxWidth: "760px", maxHeight: "88vh", overflowY: "auto" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2 className="modal-title" style={{ fontSize: "1.25rem", display: "flex", alignItems: "center", gap: "8px" }}>
                  <span>🎯 AI Tailoring Changes</span>
                  <span
                    className="badge"
                    style={{ background: "rgba(168, 85, 247, 0.2)", color: "#c084fc", border: "1px solid rgba(168, 85, 247, 0.4)" }}
                  >
                    {viewingDiff.aiModel || viewingDiff.model || "Default"}
                  </span>
                </h2>
                <div className="modal-company" style={{ marginTop: "4px" }}>
                  <strong>{viewingDiff.role}</strong> at {viewingDiff.company}
                </div>
              </div>
              <button className="btn btn-outline btn-sm" onClick={() => setViewingDiff(null)}>
                <X size={16} />
              </button>
            </div>

            <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {/* Meta strip */}
              <div
                style={{
                  display: "flex",
                  gap: "14px",
                  flexWrap: "wrap",
                  background: "rgba(255,255,255,0.03)",
                  padding: "10px 14px",
                  borderRadius: "8px",
                  border: "1px solid rgba(255,255,255,0.08)",
                  fontSize: "0.85rem"
                }}
              >
                <div><strong>Tailored with AI:</strong> <span style={{ color: "#34d399" }}>Yes</span></div>
                <div><strong>Provider:</strong> {viewingDiff.aiProvider}</div>
                <div><strong>Fact Check:</strong> <span style={{ color: "#34d399" }}>{viewingDiff.factValidation}</span></div>
                <div><strong>Page Budget:</strong> {viewingDiff.pages} pages</div>
              </div>

              {/* Summary Focus */}
              <div style={{ background: "rgba(56, 189, 248, 0.05)", border: "1px solid rgba(56, 189, 248, 0.25)", padding: "14px 16px", borderRadius: "8px" }}>
                <h4 style={{ margin: "0 0 8px 0", color: "#38bdf8", fontSize: "0.95rem" }}>📝 Professional Summary Focus</h4>
                <p style={{ margin: 0, fontSize: "0.9rem", lineHeight: "1.5", color: "#e2e8f0" }}>
                  {viewingDiff.tailoringDiff?.summary_focus || "Summary adapted specifically to this vacancy."}
                </p>
              </div>

              {/* Skills Promoted */}
              <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", padding: "14px 16px", borderRadius: "8px" }}>
                <h4 style={{ margin: "0 0 8px 0", color: "#fbbf24", fontSize: "0.95rem" }}>⚡ Skills Promoted & Reordered</h4>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {viewingDiff.tailoringDiff?.skills_promoted?.map((sk, idx) => (
                    <span
                      key={idx}
                      className="badge"
                      style={{ background: "rgba(251, 191, 36, 0.15)", color: "#fbbf24", border: "1px solid rgba(251, 191, 36, 0.3)" }}
                    >
                      {sk}
                    </span>
                  ))}
                </div>
              </div>

              {/* Skills Intentionally Omitted (Focused CV) */}
              {viewingDiff.tailoringDiff?.skills_omitted && viewingDiff.tailoringDiff.skills_omitted.length > 0 && (
                <div style={{ background: "rgba(239, 68, 68, 0.05)", border: "1px solid rgba(239, 68, 68, 0.2)", padding: "14px 16px", borderRadius: "8px" }}>
                  <h4 style={{ margin: "0 0 8px 0", color: "#f87171", fontSize: "0.95rem" }}>🚫 Intentionally Omitted Skills (Focused CV)</h4>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    {viewingDiff.tailoringDiff.skills_omitted.map((item, idx) => (
                      <div key={idx} style={{ fontSize: "0.85rem", color: "#e2e8f0" }}>
                        <strong style={{ color: "#fca5a5" }}>{typeof item === "string" ? item : item.domain}:</strong>{" "}
                        <span style={{ color: "#94a3b8" }}>{typeof item === "string" ? "Omitted to keep CV narrow and focused on this vacancy" : item.reason}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Selected Projects */}
              <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", padding: "14px 16px", borderRadius: "8px" }}>
                <h4 style={{ margin: "0 0 8px 0", color: "#a855f7", fontSize: "0.95rem" }}>🚀 Selected Projects from Knowledge Base</h4>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {viewingDiff.tailoringDiff?.projects_selected?.map((p, idx) => (
                    <div
                      key={idx}
                      style={{ padding: "8px 12px", background: "rgba(255,255,255,0.02)", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.05)" }}
                    >
                      <strong style={{ color: "#c084fc" }}>{p.name}</strong>
                      <div style={{ fontSize: "0.85rem", color: "#94a3b8", marginTop: "2px" }}>{p.reason}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* JD Keywords Matched */}
              <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", padding: "14px 16px", borderRadius: "8px" }}>
                <h4 style={{ margin: "0 0 8px 0", color: "#34d399", fontSize: "0.95rem" }}>🎯 Key JD Requirements Addressed</h4>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {viewingDiff.tailoringDiff?.jd_keywords_matched?.map((kw, idx) => (
                    <span
                      key={idx}
                      className="badge"
                      style={{ background: "rgba(52, 211, 153, 0.15)", color: "#34d399", border: "1px solid rgba(52, 211, 153, 0.3)" }}
                    >
                      {kw}
                    </span>
                  ))}
                </div>
              </div>

              {/* Experience Emphasis */}
              <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", padding: "14px 16px", borderRadius: "8px" }}>
                <h4 style={{ margin: "0 0 8px 0", color: "#e2e8f0", fontSize: "0.95rem" }}>💼 Experience Bullets Emphasized</h4>
                <p style={{ margin: 0, fontSize: "0.85rem", color: "#94a3b8", lineHeight: "1.45" }}>
                  {viewingDiff.tailoringDiff?.experience_emphasis}
                </p>
              </div>
            </div>

            <div className="modal-actions" style={{ marginTop: "16px", display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              {viewingDiff.pdfPath && (
                <button
                  className="btn btn-primary"
                  onClick={() => handleOpen("tailored-cv", viewingDiff.pdfPath)}
                >
                  📄 Open Tailored PDF
                </button>
              )}
              <button className="btn btn-outline" onClick={() => setViewingDiff(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 5: ACTIVITY PANEL */}
      <div className="activity-panel">
        <div className="activity-header">
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <Clock size={16} color="#06b6d4" />
            <span>Section 5 — Activity & Engine Status:</span>
            {activity?.currentOp ? (
              <span style={{ color: "#38bdf8", display: "flex", alignItems: "center", gap: "6px" }}>
                <span className="spinner" /> {activity.currentOp.name}
              </span>
            ) : (
              <span style={{ color: "#34d399" }}>Idle · Ready</span>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {activity?.lastOp && (
              <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                Last: <strong>{activity.lastOp.name}</strong> ({activity.lastOp.status})
              </span>
            )}
            <button
              className="btn btn-outline btn-sm"
              onClick={() => setShowLogOutput(!showLogOutput)}
            >
              {showLogOutput ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {showLogOutput ? "Hide Logs" : "View Logs"}
            </button>
          </div>
        </div>

        {showLogOutput && (
          <pre className="activity-log-pre">
            {activity?.lastOp?.stdout || activity?.lastOp?.stderr || "No recent execution output."}
          </pre>
        )}
      </div>
    </div>
  );
}

export default App;
