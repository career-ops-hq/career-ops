"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ApplyField } from "@/lib/apply/extract";
import type { ApplyIssue, DriveStep } from "@/lib/apply/issue";
import { resolveLateSession } from "@/lib/apply/exit.mjs";

export type FillStep = { fieldId: string; label: string; ok: boolean; thumb?: string };
type Meta = { needsConfirmation?: boolean };
type Status = "idle" | "opening" | "driving" | "prefilling" | "ready" | "filling" | "done" | "error";

type ApplyCtx = {
  status: Status;
  url: string;
  title: string;
  company: string;
  /** Tracker row this session was opened for, "" when opened from a pasted URL. */
  n: string;
  /** Path the session was opened from, so the page has somewhere to go back to. */
  from: string;
  fields: ApplyField[];
  answers: Record<string, string>;
  meta: Record<string, Meta>;
  steps: FillStep[];
  shots: string[];
  prefillLog: string[];
  issues: ApplyIssue[];
  driveSteps: DriveStep[];
  error: string;
  open: (url: string, opts?: { prefill?: boolean; company?: string; n?: string; from?: string }) => Promise<void>;
  prefill: () => Promise<void>;
  setAnswer: (idOrLabel: string, value: string) => void;
  fill: () => Promise<void>;
  agentFill: () => Promise<void>;
  reset: () => void;
};

const Ctx = createContext<ApplyCtx | null>(null);
export function useApply(): ApplyCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useApply must be used within <ApplyProvider>");
  return c;
}

/** Release the headless browser behind a session id. Fire-and-forget: the page
 *  is usually navigating away as this goes out, hence keepalive. */
function closeSession(id: string) {
  void fetch("/api/apply/close", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: id }), keepalive: true }).catch(() => {});
}

const CONFIG_KEY = "career-ops:config";
function cliId(): string | null {
  try {
    return JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}").cliId || null;
  } catch {
    return null;
  }
}

export function ApplyProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>("idle");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [n, setN] = useState("");
  const [from, setFrom] = useState("");
  const [fields, setFields] = useState<ApplyField[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [meta, setMeta] = useState<Record<string, Meta>>({});
  const [steps, setSteps] = useState<FillStep[]>([]);
  const [shots, setShots] = useState<string[]>([]);
  const [prefillLog, setPrefillLog] = useState<string[]>([]);
  const [issues, setIssues] = useState<ApplyIssue[]>([]);
  const [driveSteps, setDriveSteps] = useState<DriveStep[]>([]);
  const [error, setError] = useState("");
  const sessionId = useRef<string | null>(null);
  const companyRef = useRef<string>("");
  const fieldsRef = useRef<ApplyField[]>([]);
  fieldsRef.current = fields;
  const answersRef = useRef<Record<string, string>>({});
  answersRef.current = answers;
  // Bumped every time a session is abandoned or replaced. Leaving the page is
  // reachable while a request or stream is still in flight, and none of them can
  // be recalled, so each one carries the generation it started in and drops its
  // results if that generation is no longer current.
  const generation = useRef(0);
  // When a session opens with {prefill:true}, auto-fire prefill once fields are
  // ready — driven by an effect (not a fragile setTimeout) so it can't race the
  // session response or a navigation.
  const pendingPrefill = useRef(false);

  // Stream the agentic drive (the AI reaching the form live) and finalize the
  // session when it succeeds → fields ready → auto-prefill fires.
  const drive = useCallback(async (id: string) => {
    const gen = generation.current;
    setDriveSteps([]);
    try {
      const r = await fetch("/api/apply/drive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: id, cliId: cliId(), goal: "reach" }) });
      if (generation.current !== gen) return; // left mid-drive
      if (!r.body) {
        setError("The agent couldn't start.");
        setStatus("error");
        return;
      }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let finished = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (generation.current !== gen) return; // left mid-drive
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let ev: { t?: string; message?: string; fields?: ApplyField[]; title?: string; issues?: ApplyIssue[] } & DriveStep;
          try {
            ev = JSON.parse(line);
          } catch {
            continue;
          }
          if (ev.t === "step") setDriveSteps((p) => [...p, ev as DriveStep]);
          else if (ev.t === "done") {
            finished = true;
            setFields(ev.fields ?? []);
            if (ev.title) setTitle(ev.title);
            setIssues(ev.issues ?? []);
            setStatus("ready"); // → the ready-effect auto-prefills if pending
          } else if (ev.t === "error") {
            finished = true;
            setError(ev.message || "The agent couldn't reach a fillable form.");
            setStatus("error");
          }
        }
      }
      if (generation.current !== gen) return; // left mid-drive
      if (!finished) {
        setError("The agent stopped before reaching a form.");
        setStatus("error");
      }
    } catch (e) {
      if (generation.current !== gen) return; // left mid-drive
      setError(`The agent couldn't reach the form: ${e instanceof Error ? e.message : "stream error"}.`);
      setStatus("error");
    }
  }, []);

  const open = useCallback(async (u: string, opts?: { prefill?: boolean; company?: string; n?: string; from?: string }) => {
    const gen = ++generation.current;
    // Opening a second form abandons the first one's browser exactly the way
    // leaving the page does, so it is released here too.
    if (sessionId.current) closeSession(sessionId.current);
    sessionId.current = null;
    setStatus("opening");
    setError("");
    setFields([]);
    setAnswers({});
    setMeta({});
    setSteps([]);
    setShots([]);
    setIssues([]);
    setDriveSteps([]);
    setUrl(u);
    setCompany(opts?.company ?? "");
    companyRef.current = opts?.company ?? "";
    setN(opts?.n ?? "");
    setFrom(opts?.from ?? "");
    pendingPrefill.current = false;
    try {
      const r = await fetch("/api/apply/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: u, cliId: cliId() }) });
      const d = await r.json();
      // The user can leave while this is in flight, and the request can't be
      // recalled — a session that lands after they left is closed here or its
      // headless browser runs forever, unreferenced.
      const late = resolveLateSession({ stale: generation.current !== gen, sessionId: d.id });
      if (late !== "apply") {
        if (late === "close") closeSession(d.id);
        return;
      }
      if (d.error) {
        setError(d.error);
        setStatus("error");
        return;
      }
      sessionId.current = d.id;
      setTitle(d.title);
      setShots(d.shots ?? []);
      pendingPrefill.current = !!opts?.prefill;
      if (d.needsDrive) {
        // The form is behind navigation → the agent drives to reach it, streamed.
        setStatus("driving");
        await drive(d.id);
        return;
      }
      setFields(d.fields);
      setIssues(d.issues ?? []);
      setStatus("ready");
    } catch {
      if (generation.current !== gen) return; // left while it was opening
      setError("Could not open the form.");
      setStatus("error");
    }
  }, []);

  const prefill = useCallback(async () => {
    if (!sessionId.current) return;
    const gen = generation.current;
    if (!cliId()) {
      setError("Configure a CLI in Config first, then pre-fill from your CV.");
      return;
    }
    setStatus("prefilling");
    setError("");
    setPrefillLog([]);
    const applyAnswers = (raw: Record<string, { value?: string; needs_confirmation?: boolean }>) => {
      const a: Record<string, string> = {};
      const m: Record<string, Meta> = {};
      for (const [id, v] of Object.entries(raw)) {
        a[id] = v?.value ?? "";
        m[id] = { needsConfirmation: !!v?.needs_confirmation };
      }
      setAnswers(a);
      setMeta(m);
    };
    try {
      const r = await fetch("/api/apply/prefill", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: sessionId.current, cliId: cliId() }) });
      if (generation.current !== gen) return; // left mid-prefill
      if (!r.body) {
        setError("Couldn't pre-fill — no response stream.");
        setStatus("ready");
        return;
      }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let got = false;
      let sawError = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (generation.current !== gen) return; // left mid-prefill
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let ev: { t?: string; m?: string; el?: number; raw?: string; answers?: Record<string, { value?: string; needs_confirmation?: boolean }>; count?: number; truncated?: boolean };
          try {
            ev = JSON.parse(line);
          } catch {
            continue;
          }
          if (ev.t === "log") {
            setPrefillLog((p) => [...p, `+${((ev.el ?? 0) / 1000).toFixed(1)}s  ${ev.m}`]);
          } else if (ev.t === "done") {
            got = true;
            applyAnswers(ev.answers ?? {});
            if ((ev.count ?? 0) === 0) setError("The planner returned 0 answers — see the diagnostics log below.");
            else if (ev.truncated) setError("The planner was cut off — some fields were recovered, others may be blank. See diagnostics.");
          } else if (ev.t === "error") {
            sawError = true;
            setError(ev.m ? `Couldn't pre-fill: ${ev.m}` : "Couldn't pre-fill from your CV.");
            setPrefillLog((p) => [...p, `✗ ${ev.m ?? "error"}${ev.raw ? ` — raw tail: ${ev.raw.slice(0, 160)}` : ""}`]);
          }
        }
      }
      if (generation.current !== gen) return; // left mid-prefill
      if (!got && !sawError) setError("Pre-fill ended without answers — see the diagnostics log below.");
      setStatus("ready");
    } catch (e) {
      if (generation.current !== gen) return; // left mid-prefill
      setError(`Couldn't pre-fill from your CV: ${e instanceof Error ? e.message : "stream error"}. See diagnostics.`);
      setStatus("ready");
    }
  }, []);

  // Auto-prefill exactly once after the fields are ready.
  useEffect(() => {
    if (status === "ready" && pendingPrefill.current) {
      pendingPrefill.current = false;
      void prefill();
    }
  }, [status, prefill]);

  const setAnswer = useCallback((idOrLabel: string, value: string) => {
    const fs = fieldsRef.current;
    const key = idOrLabel.toLowerCase();
    const f =
      fs.find((x) => x.id === idOrLabel) ||
      fs.find((x) => x.label.toLowerCase().includes(key)) ||
      fs.find((x) => key.includes(x.label.toLowerCase()) && x.label.length > 2);
    if (f) setAnswers((prev) => ({ ...prev, [f.id]: value }));
  }, []);

  const fill = useCallback(async () => {
    if (!sessionId.current) return;
    const gen = generation.current;
    setStatus("filling");
    setSteps([]);
    try {
      const r = await fetch("/api/apply/fill", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: sessionId.current, answers, fields, handoff: true, company: companyRef.current }) });
      const d = await r.json();
      // Also stops the escalation below from starting an agent drive on a
      // session the user has already walked away from.
      if (generation.current !== gen) return; // left mid-fill
      if (d.error) {
        setError(d.error);
        setStatus("error");
        return;
      }
      setSteps(d.steps ?? []);
      // merge the verify-after-fill warnings (required-empty / mismatch / validation)
      if (Array.isArray(d.issues) && d.issues.length) {
        setIssues((prev) => {
          const seen = new Set(prev.map((i: ApplyIssue) => i.message));
          return [...prev, ...(d.issues as ApplyIssue[]).filter((i) => !seen.has(i.message))];
        });
      }
      if (d.navigated) setError("Heads up: the form's page changed during fill — review it carefully before submitting (career-ops never submits for you).");
      setStatus("done");
      // ESCALATION ("si no va, full agente"): if deterministic fill clearly
      // didn't land (most fields failed / mismatched), let the agent fill it.
      const okCount = (d.steps ?? []).filter((s: FillStep) => s.ok).length;
      const total = (d.steps ?? []).length;
      const mismatch = (d.issues ?? []).some((i: ApplyIssue) => i.code === "fill-mismatch");
      if (cliId() && total > 0 && (okCount === 0 || (mismatch && okCount < total / 2))) {
        await agentFillRef.current();
      }
    } catch {
      if (generation.current !== gen) return; // left mid-fill
      setError("Fill failed.");
      setStatus("error");
    }
  }, [answers, fields]);

  // FULL-AGENT FILL — the agent fills the real form turn-by-turn from the verified
  // answers, streamed (drive panel), never submits, then hands off. Used as the
  // escalation when deterministic fill fails, or on demand.
  const agentFill = useCallback(async () => {
    if (!sessionId.current) return;
    const gen = generation.current;
    const fs = fieldsRef.current;
    const a = answersRef.current;
    const ans = fs.filter((f) => f.type !== "file" && (a[f.id] || "").trim()).map((f) => ({ label: f.label || f.id, value: a[f.id] }));
    setDriveSteps([]);
    setError("");
    setStatus("filling");
    try {
      const r = await fetch("/api/apply/drive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: sessionId.current, cliId: cliId(), goal: "full", answers: ans }) });
      if (generation.current !== gen) return; // left mid-fill
      if (!r.body) {
        setError("The agent couldn't start filling.");
        setStatus("error");
        return;
      }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (generation.current !== gen) return; // left mid-fill
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let ev: { t?: string; message?: string; filled?: boolean } & DriveStep;
          try {
            ev = JSON.parse(line);
          } catch {
            continue;
          }
          if (ev.t === "step") setDriveSteps((p) => [...p, ev as DriveStep]);
          else if (ev.t === "done") {
            setIssues((prev) => [...prev, { level: "info", code: "ai-filled", message: ev.filled ? "AI filled the form for you — review every answer on the real form, then submit it yourself." : "AI did its best but couldn't finish — check the real form before submitting." }]);
            setStatus("done");
          } else if (ev.t === "error") {
            setError(ev.message || "The agent couldn't fill the form.");
            setStatus("error");
          }
        }
      }
    } catch (e) {
      if (generation.current !== gen) return; // left mid-fill
      setError(`The agent couldn't fill the form: ${e instanceof Error ? e.message : "stream error"}.`);
      setStatus("error");
    }
  }, []);
  const agentFillRef = useRef(agentFill);
  agentFillRef.current = agentFill;

  const reset = useCallback(() => {
    // Invalidate anything still in flight before clearing state, so a response
    // that lands after this can't repopulate the page the user just left.
    generation.current += 1;
    if (sessionId.current) closeSession(sessionId.current);
    sessionId.current = null;
    companyRef.current = "";
    pendingPrefill.current = false;
    setStatus("idle");
    setUrl("");
    setTitle("");
    setCompany("");
    setN("");
    setFrom("");
    setFields([]);
    setAnswers({});
    setMeta({});
    setSteps([]);
    setShots([]);
    setPrefillLog([]);
    setIssues([]);
    setDriveSteps([]);
    setError("");
  }, []);

  const value = useMemo(
    () => ({ status, url, title, company, n, from, fields, answers, meta, steps, shots, prefillLog, issues, driveSteps, error, open, prefill, setAnswer, fill, agentFill, reset }),
    [status, url, title, company, n, from, fields, answers, meta, steps, shots, prefillLog, issues, driveSteps, error, open, prefill, setAnswer, fill, agentFill, reset],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
