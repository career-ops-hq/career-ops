"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { scoreTone } from "@/lib/format";

export type JobStep = { kind: "tool" | "status"; label: string; ts: number };
export type JobResult = { score: number | null; summary: string; tone: "good" | "warn" | "bad" | "muted" };

export type Job = {
  id: string;
  title: string;
  subtitle?: string;
  page?: string; // route the job was launched from / refers to
  input?: string; // the URL/posting it processed (links inbox rows to their worker)
  kind?: string;
  batchId?: string; // groups jobs fired together (e.g. "evaluate all Anthropic")
  status: "running" | "done" | "error";
  steps: JobStep[];
  text: string;
  result?: JobResult;
  cost?: { tokens: number; usd?: number }; // per-run token cost (Claude result event) — local only
  // Gate 3 post-tailoring compliance audit (pdf lane only). Advisory: every
  // failure mode reports `unavailable` rather than blocking the run, so this is
  // "the gate could not answer" — never "the CV is fine" by default.
  gate3?: {
    decision: "pass" | "halt" | "unavailable";
    reason?: string;
    reasons?: string[];
    source?: string;
  };
  startedAt: number;
  endedAt?: number;
};

type StartOpts = { title: string; subtitle?: string; kind: string; input: string; page?: string; batchId?: string };

type Ctx = {
  jobs: Job[];
  startJob: (opts: StartOpts) => string | null;
  retryJob: (id: string) => string | null;
  removeJob: (id: string) => void;
  clearFinished: () => void;
};

const JobsContext = createContext<Ctx | null>(null);
export function useJobs() {
  const c = useContext(JobsContext);
  if (!c) throw new Error("useJobs must be used within <JobsProvider>");
  return c;
}

const CONFIG_KEY = "career-ops:config";
const JOBS_KEY = "career-ops:jobs";

function parseVerdict(text: string): JobResult {
  const m = text.match(/VERDICT:\s*([\d.]+)\s*\/\s*5\s*[—:|-]+\s*(.+)/i);
  if (m) {
    const score = parseFloat(m[1]);
    return { score, summary: m[2].trim().replace(/\s+/g, " ").slice(0, 90), tone: scoreTone(`${score}`) };
  }
  const s = text.match(/\b([0-5](?:\.\d)?)\s*\/\s*5\b/);
  if (s) {
    const score = parseFloat(s[1]);
    return { score, summary: "", tone: scoreTone(`${score}`) };
  }
  return { score: null, summary: "", tone: "muted" };
}

export function JobsProvider({ children }: { children: React.ReactNode }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const seq = useRef(0);
  const loaded = useRef(false);

  // restore history
  useEffect(() => {
    try {
      const raw = localStorage.getItem(JOBS_KEY);
      const arr = raw ? JSON.parse(raw) : null;
      if (Array.isArray(arr)) {
        // anything left "running" from a previous session is stale → mark interrupted
        setJobs(arr.map((j: Job) => (j.status === "running" ? { ...j, status: "error", steps: [...(j.steps || []), { kind: "status", label: "Interrupted (page reloaded)", ts: Date.now() }] } : j)));
      }
    } catch {
      /* ignore */
    }
    loaded.current = true;
  }, []);

  // persist
  useEffect(() => {
    if (!loaded.current) return;
    try {
      localStorage.setItem(JOBS_KEY, JSON.stringify(jobs.slice(0, 40)));
    } catch {
      /* quota */
    }
  }, [jobs]);

  const patch = useCallback((id: string, fn: (j: Job) => Job) => {
    setJobs((js) => js.map((j) => (j.id === id ? fn(j) : j)));
  }, []);

  const startJob = useCallback(
    (opts: StartOpts): string | null => {
      // Dedupe: one live worker per kind+input (double-submit used to spawn two
      // evals of the same URL; the second stole wroteReport and raced git locks).
      const clash = jobs.find((j) => j.status === "running" && j.kind === opts.kind && j.input === opts.input);
      if (clash) return null;
      // Also refuse a re-evaluate of an input we ALREADY scored (belt for the
      // /api/run guard): the posting's lifecycle ended when the first run saved
      // its report. An errored run — no score — is retryable.
      const finished = jobs.find(
        (j) => j.status === "done" && j.kind === opts.kind && j.input === opts.input && j.result?.score != null,
      );
      if (finished) return null;

      let cliId: string | null = null;
      try {
        const raw = localStorage.getItem(CONFIG_KEY);
        cliId = raw ? JSON.parse(raw).cliId || null : null;
      } catch {
        cliId = null;
      }
      const id = `job-${Date.now()}-${seq.current++}`;
      const job: Job = {
        id,
        title: opts.title,
        subtitle: opts.subtitle,
        page: opts.page,
        input: opts.input,
        kind: opts.kind,
        batchId: opts.batchId,
        status: "running",
        steps: [{ kind: "status", label: "Starting…", ts: Date.now() }],
        text: "",
        startedAt: Date.now(),
      };
      setJobs((js) => [job, ...js]);

      if (!cliId) {
        patch(id, (j) => ({ ...j, status: "error", endedAt: Date.now(), steps: [...j.steps, { kind: "status", label: "No CLI configured — open Config", ts: Date.now() }] }));
        return id;
      }

      (async () => {
        let text = "";
        let verdictLine = ""; // latched separately so the 8000-char tail can't drop it
        let doneTokens = 0; // per-run token cost, forwarded on the done event (#6)
        let doneCostUsd: number | null = null;
        let doneGate3: Job["gate3"] = undefined; // Gate 3 telemetry, forwarded on the done event
        const steps: JobStep[] = [];
        const finish = (status: "done" | "error", lastLabel?: string) => {
          const result = status === "done" ? parseVerdict(verdictLine || text) : undefined;
          const cost = status === "done" && doneTokens > 0 ? { tokens: doneTokens, usd: doneCostUsd ?? undefined } : undefined;
          patch(id, (j) => ({
            ...j,
            status,
            result,
            cost,
            gate3: doneGate3,
            endedAt: Date.now(),
            steps: lastLabel ? [...j.steps, { kind: "status", label: lastLabel, ts: Date.now() }] : j.steps,
          }));
          // Persist a readable log file so the CLI/assistant can read past runs —
          // on FAILURE too. A run killed mid-write (the evaluate SIGTERM budget,
          // a dropped connection) leaves the report unwritten and the card red,
          // and with no log on disk there is nothing left to diagnose it from:
          // that is exactly how the Airtel APM evaluation of 2026-09-28 left two
          // orphaned report reservations and no trace of why.
          fetch("/api/runs/save", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, kind: opts.kind, title: opts.title, subtitle: opts.subtitle, page: opts.page, input: opts.input, result, cost, gate3: doneGate3, steps, status, lastLabel, output: text }),
          }).catch(() => {});
          // Only a run that actually landed its artifacts should invalidate the
          // server-snapshot surfaces (Today, pipeline) — a failed one wrote nothing.
          if (status === "done" && typeof window !== "undefined" && (opts.kind === "evaluate" || opts.kind === "pdf")) {
            window.dispatchEvent(new CustomEvent("co-job-done", { detail: { kind: opts.kind, input: opts.input } }));
          }
        };

        try {
          const res = await fetch("/api/run", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kind: opts.kind, input: opts.input, cliId }),
          });
          if (!res.ok || !res.body) {
            const e = await res.json().catch(() => ({}));
            finish("error", e.error || "Failed to start");
            return;
          }
          const reader = res.body.getReader();
          const dec = new TextDecoder();
          let buf = "";
          let settled = false;
          const settle = (status: "done" | "error", lastLabel?: string) => {
            if (settled) return;
            settled = true;
            finish(status, lastLabel);
            try { reader.cancel(); } catch { /* already closed */ }
          };
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            let nl: number;
            while ((nl = buf.indexOf("\n")) !== -1) {
              const line = buf.slice(0, nl).trim();
              buf = buf.slice(nl + 1);
              if (!line) continue;
              try {
                const ev = JSON.parse(line);
                if (ev.type === "tool") {
                  steps.push({ kind: "tool", label: ev.name, ts: Date.now() });
                  patch(id, (j) => ({ ...j, steps: [...j.steps, { kind: "tool", label: ev.name, ts: Date.now() }] }));
                } else if (ev.type === "status") {
                  steps.push({ kind: "status", label: ev.label, ts: Date.now() });
                  patch(id, (j) => ({ ...j, steps: [...j.steps, { kind: "status", label: ev.label, ts: Date.now() }] }));
                } else if (ev.type === "text") {
                  const full = text + ev.text;
                  const vm = full.match(/VERDICT:[^\n]*/i);
                  if (vm) verdictLine = vm[0];
                  text = full.slice(-8000);
                  patch(id, (j) => ({ ...j, text }));
                } else if (ev.type === "warning") {
                  // At most one stderr ⚠ (route already rate-limits); never finalize.
                  const already = steps.some((s) => s.kind === "status" && s.label.startsWith("⚠ "));
                  if (!already) {
                    const label = `⚠ ${String(ev.msg || "").slice(0, 140)}`;
                    steps.push({ kind: "status", label, ts: Date.now() });
                    patch(id, (j) => ({ ...j, steps: [...j.steps, { kind: "status", label, ts: Date.now() }] }));
                  }
                } else if (ev.type === "done") {
                  if (typeof ev.tokens === "number") doneTokens = ev.tokens;
                  if (typeof ev.costUsd === "number") doneCostUsd = ev.costUsd;
                  // Gate 3 telemetry rides the same event. Guarded on `decision`
                  // so a malformed object can never overwrite the type-narrowed
                  // field with something the card would choke on.
                  if (ev.gate3 && typeof ev.gate3.decision === "string") doneGate3 = ev.gate3;
                  settle("done", "Done");
                  return;
                } else if (ev.type === "error") {
                  // Terminal — only the route's close/spawn gate emits this.
                  settle("error", ev.msg || "Error");
                  return;
                }
              } catch {
                /* skip */
              }
            }
          }
          // Stream ended without a terminal event (client/server cut mid-run).
          settle("error", "Stream ended before the run finished");
        } catch {
          finish("error", "Connection error");
        }
      })();

      return id;
    },
    [jobs, patch],
  );

  const retryJob = useCallback(
    (id: string): string | null => {
      const j = jobs.find((x) => x.id === id);
      if (!j?.kind || !j.input) return null;
      return startJob({
        title: j.title,
        subtitle: j.subtitle,
        kind: j.kind,
        input: j.input,
        page: j.page,
        batchId: j.batchId,
      });
    },
    [jobs, startJob],
  );

  const removeJob = useCallback((id: string) => setJobs((js) => js.filter((j) => j.id !== id)), []);
  const clearFinished = useCallback(() => setJobs((js) => js.filter((j) => j.status === "running")), []);

  return <JobsContext.Provider value={{ jobs, startJob, retryJob, removeJob, clearFinished }}>{children}</JobsContext.Provider>;
}
