import fs from "node:fs";
import express from "express";
import cors from "cors";
import path from "node:path";
import {
  WORKSPACE_ROOT,
  parsePipeline,
  updatePipelineStatus,
  getMasterCvStatus,
  getTailoredCvs,
  getLastScanInfo,
  openLocalTarget,
  getTailoringDiff
} from "./fileAccess.ts";
import { careerOps } from "./careerOps.ts";
import { aiProviderRegistry } from "./ai/providerRegistry.ts";
import { loadDashboardProfile } from "./profile.ts";

const app = express();
const PORT = 3001;
const HOST = "127.0.0.1"; // Security: localhost only

app.use(cors({
  origin: ["http://127.0.0.1:5173", "http://localhost:5173"],
  methods: ["GET", "POST", "PUT"]
}));

app.use(express.json());

// AI providers are backend-owned allowlisted implementations; the browser never supplies commands.
app.get("/api/ai/providers", async (req, res) => {
  try {
    const health = await aiProviderRegistry.getHealth();
    res.json({ success: true, ...health });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put("/api/ai/config", (req, res) => {
  try {
    const { defaultProvider, fallbackEnabled, providerId, model } = req.body || {};
    const config = aiProviderRegistry.saveConfig({ defaultProvider, fallbackEnabled, providerId, model });
    res.json({ success: true, config });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post("/api/ai/providers/:providerId/test", async (req, res) => {
  try {
    const result = await aiProviderRegistry.testProvider(req.params.providerId, req.body?.model);
    res.status(result.success ? 200 : 503).json(result);
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 1. Overall System Status
app.get("/api/status", (req, res) => {
  try {
    const masterCv = getMasterCvStatus();
    const lastScan = getLastScanInfo();
    const tailoredCvs = getTailoredCvs();
    const pipelineData = parsePipeline();
    const activity = careerOps.getActivity();

    res.json({
      success: true,
      candidate: loadDashboardProfile(),
      masterCv,
      lastScan,
      tailoredCount: tailoredCvs.length,
      pipelineCounts: {
        pending: pipelineData.pending.length,
        processed: pipelineData.processed.length
      },
      activity
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Pipeline Jobs
app.get("/api/pipeline", (req, res) => {
  try {
    const { pending, processed } = parsePipeline();

    // Attach cached evaluations
    const enrich = (job: any) => {
      const evalData = careerOps.getEvaluationForDisplay(job);
      if (evalData) {
        return { ...job, ...evalData };
      }
      return job;
    };

    res.json({
      success: true,
      pending: pending.map(enrich),
      processed: processed.map(enrich)
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Trigger Real Scan
app.post("/api/scan", async (req, res) => {
  try {
    const result = await careerOps.runScan();
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 3b. Trigger Bulk Scan to Look for New Offers
app.post("/api/scan/bulk", async (req, res) => {
  try {
    const result = await careerOps.runBulkScan();
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 4. Evaluate Single Job
app.post("/api/evaluate", async (req, res) => {
  try {
    const { job } = req.body;
    if (!job || !job.url) {
      return res.status(400).json({ success: false, error: "Missing job object or url" });
    }
    const evalResult = await careerOps.evaluateJob(job);
    res.json({ success: true, evaluation: evalResult });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/evaluate/all", async (req, res) => {
  try {
    const { pending } = parsePipeline();
    const limit = Number.isFinite(Number(req.body?.fullJdLimit)) ? Number(req.body.fullJdLimit) : 60;
    const result = await careerOps.rerankJobs(pending, limit);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Generate Tailored CV
app.post("/api/tailor-cv", async (req, res) => {
  try {
    const { job, providerId, model } = req.body;
    if (!job || !job.company || !job.title) {
      return res.status(400).json({ success: false, error: "Missing job company or title" });
    }
    const result = await careerOps.generateTailoredCv(job, { providerId, model });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5b. Get Tailoring Diff and Metadata
app.get("/api/tailor-cv/diff", (req, res) => {
  try {
    const company = (req.query.company as string) || "";
    const title = (req.query.title as string) || "";
    const diff = getTailoringDiff(company, title);
    if (!diff) {
      return res.status(404).json({ success: false, error: "No tailoring metadata found for this job" });
    }
    res.json({ success: true, data: diff });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Update Job Status in pipeline.md
app.post("/api/pipeline/status", (req, res) => {
  try {
    const { url, status } = req.body;
    if (!url || !status) {
      return res.status(400).json({ success: false, error: "Missing url or status" });
    }
    const updated = updatePipelineStatus(url, status);
    res.json({ success: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Open Local Target (xdg-open)
app.post("/api/open", async (req, res) => {
  try {
    const { type, payload } = req.body;
    const result = await openLocalTarget(type, payload);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 8. List Tailored CVs
app.get("/api/tailored-cvs", (req, res) => {
  try {
    const cvs = getTailoredCvs();
    res.json({ success: true, cvs });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 9. Activity Log
app.get("/api/activity", (req, res) => {
  try {
    const activity = careerOps.getActivity();
    res.json({ success: true, ...activity });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// Serve static built UI if available
const distPath = path.join(WORKSPACE_ROOT, "ui", "dist");
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get("*", (req, res) => {
    if (!req.path.startsWith("/api")) {
      res.sendFile(path.join(distPath, "index.html"));
    }
  });
}

// Start listening strictly on 127.0.0.1
app.listen(PORT, HOST, () => {
  console.log(`🚀 Career-Ops Local Backend running at http://${HOST}:${PORT}`);
});
