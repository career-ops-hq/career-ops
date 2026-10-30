"use client";

import { lazy, Suspense, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { Send, X, Loader2, Settings, RotateCcw, ArrowUpRight, Sparkles, Maximize2, Minimize2 } from "lucide-react";
import { CoMark } from "@/components/co-mark";
import { useJobs } from "@/components/jobs/job-store";
import { usePipeline } from "@/components/pipeline/pipeline-provider";
import { useApply } from "@/components/apply/apply-provider";
import { useExplore } from "@/components/explore/explore-provider";
import { workerBatchSummary, workerDetailsLabel } from "@/lib/worker-feedback.mjs";
import { WorkerCard } from "@/components/jobs/worker-card";
import { Button } from "@/components/ui/button";
import { dispatch, type ActionCtx, type DoneInfo } from "@/app/actions/registry";
import { estimateRunCost } from "@/lib/run-cost-estimate.mjs";
import { scoreNum } from "@/lib/format";
import { pendingActOpenerStart } from "@/lib/act-envelope.mjs";
import { cleanMessages } from "@/lib/assistant-history.mjs";
import { StatusConfirmationCard, type StatusConfirmationPart } from "@/components/assistant-status-confirmation";
import { StatusWriteError, writeAssistantStatus } from "@/lib/assistant-status-write.mjs";
import { postAssistantWrite } from "@/lib/assistant-file-write.mjs";
import { cn } from "@/lib/cn";
import { CONFIG_KEY, subscribeConfig } from "@/lib/config-events.mjs";

// ── message model: messages are PART arrays so a live worker card can render
// inline next to text, both fed by the single JobsProvider store ──────────────
type Part =
  | { type: "text"; text: string }
  | { type: "note"; text: string }
  | { type: "card"; jobId: string }
  | { type: "batch"; batchId: string; jobIds: string[] }
  | { type: "confirm"; cid: string; summary: string; state: "pending" | "saving" | "done" | "cancelled" | "failed"; message?: string; statusChange?: undefined }
  | StatusConfirmationPart;
type Msg = { role: "user" | "assistant"; parts: Part[] };
type RequestFeedback = { id: number; phase: "working" | "ready" | "error"; announce: boolean };

const loadMarkdown = () => import("@/components/assistant-markdown");
const AssistantMarkdown = lazy(loadMarkdown);

const CHAT_KEY = "career-ops:chat";
const SIZE_KEY = "career-ops:assistant-size";

// Panel size. The 400×600 default is fine for a question; an onboarding
// conversation or a long evaluation debrief is not a 400px-wide affair. Three
// fixed steps rather than free drag: predictable on touch and small screens,
// one click to cycle, remembered per browser.
type PanelSize = "compact" | "wide" | "full";
const SIZE_ORDER: PanelSize[] = ["compact", "wide", "full"];
const PANEL_CLASS: Record<PanelSize, string> = {
  compact: "bottom-5 right-5 h-[600px] max-h-[80vh] w-[400px] max-w-[calc(100vw-2.5rem)]",
  wide: "bottom-5 right-5 h-[85vh] w-[720px] max-w-[calc(100vw-2.5rem)]",
  full: "inset-4 h-auto w-auto",
};
// The composer grows with its content (a pasted CV, a long answer) up to a cap
// that scales with the panel, instead of staying a one-line box that scrolls.
const INPUT_MAX_PX: Record<PanelSize, number> = { compact: 128, wide: 240, full: 360 };
const SIZE_LABEL: Record<PanelSize, string> = { compact: "Wider", wide: "Full screen", full: "Compact" };
// back-compat shims — the old directives still work, mapped onto the registry
const NAV_RE = /<<\s*go:\s*(\/[a-z0-9/_-]*)\s*>>/gi;
const REMEMBER_RE = /<<\s*remember:\s*([^>]+?)\s*>>/gi;

const GREETING =
  "Hi — I'm your career-ops assistant. I can walk you through onboarding, answer questions about your pipeline, or take you where you need to go. What would you like to do?";

// ── envelope parsing: act ONLY on complete <<act:ID {json}>> envelopes ────────
function codeRanges(s: string): [number, number][] {
  const ranges: [number, number][] = [];
  const re = /```[\s\S]*?```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) ranges.push([m.index, m.index + m[0].length]);
  return ranges;
}
function inRanges(i: number, ranges: [number, number][]): boolean {
  return ranges.some(([a, b]) => i >= a && i < b);
}
function normalizeJson(s: string): string {
  return s
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,\s*}$/, "}")
    .trim();
}
type Env = { start: number; end: number; id: string; argsJson: string };
function parseEnvelopes(acc: string): { complete: Env[]; hidePartialFrom: number } {
  const ranges = codeRanges(acc);
  const complete: Env[] = [];
  let hidePartialFrom = -1;
  const open = /<<act:([a-zA-Z]+)[ \t]+/g;
  let m: RegExpExecArray | null;
  while ((m = open.exec(acc))) {
    const start = m.index;
    if (inRanges(start, ranges)) continue;
    const argsStart = m.index + m[0].length;
    const close = acc.indexOf(">>", argsStart);
    if (close === -1) {
      if (hidePartialFrom === -1 || start < hidePartialFrom) hidePartialFrom = start;
      continue;
    }
    complete.push({ start, end: close + 2, id: m[1], argsJson: acc.slice(argsStart, close).trim() });
  }
  // The regex above only sees an opener once its id letters AND trailing space
  // have streamed in. Also hide a shorter trailing partial (`<<`, `<<act:sav`)
  // so it doesn't flicker into the bubble before the space arrives (#2290-class).
  const pending = pendingActOpenerStart(acc);
  if (pending >= 0 && (hidePartialFrom === -1 || pending < hidePartialFrom)) hidePartialFrom = pending;
  return { complete, hidePartialFrom };
}
function removeRanges(s: string, cuts: [number, number][]): string {
  if (!cuts.length) return s;
  const merged = [...cuts].sort((a, b) => a[0] - b[0]);
  let out = "";
  let pos = 0;
  for (const [a, b] of merged) {
    if (a > pos) out += s.slice(pos, a);
    pos = Math.max(pos, b);
  }
  out += s.slice(pos);
  return out;
}

// Page awareness: describe the route so "this offer" / "apply" resolves to what
// the user is looking at.
function describePage(p: string): string {
  if (p === "/") return "Today / home — overview of the user's pipeline.";
  if (p === "/pipeline") return "Pipeline — the applications table + the inbox of pending job URLs.";
  const m = p.match(/^\/pipeline\/([^/]+)$/);
  if (m)
    return `The user is viewing the EVALUATION REPORT for application #${m[1]}. If they say "this offer", "apply", "evaluate it", "draft a cover letter", they mean application #${m[1]} — read reports/${m[1]}-*.md or the matching data/applications.md row and act on THAT one.`;
  if (p === "/analytics") return "Analytics — pipeline Sankey, funnel, score distribution, top companies.";
  if (p === "/cv") return "CV editor (cv.md).";
  if (p === "/config") return "Config — CLI / engine setup.";
  if (p === "/apply") return "Apply — the form-proxy: the user is reviewing a job application re-rendered in plain language, pre-filled from their CV. You can write/revise answers via setApplyField.";
  if (p.startsWith("/jobs/")) return "Watching a running worker / evaluation in progress.";
  return `Route ${p}.`;
}

// ── persistence migration: old {role,content:string} → parts[] ────────────────
function msgText(m: Msg): string {
  return m.parts.filter((p): p is Extract<Part, { type: "text" }> => p.type === "text").map((p) => p.text).join(" ").trim();
}

export function AssistantConsole() {
  const [open, setOpen] = useState(false);
  const [cliId, setCliId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [chats, setChats] = useState<{ id: string; title: string; revision: number }[]>([]);
  const [chatReady, setChatReady] = useState(false);
  const [chatPending, setChatPending] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [chatWarnings, setChatWarnings] = useState<{ id: string; error: string }[]>([]);
  const activeChat = useRef<{ id: string; revision: number; title?: string }>({ id: "", revision: 0 });
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const savedSnapshot = useRef("");
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [requestFeedback, setRequestFeedback] = useState<RequestFeedback | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const requestSequence = useRef(0);
  const lastAnnounced = useRef("");
  const openRef = useRef(open);
  openRef.current = open;
  const latestReplyRef = useRef<HTMLDivElement>(null);
  const feedbackId = useId();
  const latestReplyIndex = messages.findLastIndex((m) => m.role === "assistant");
  const latestReply = messages[latestReplyIndex];
  const pendingConfirmations = messages.reduce((count, m) => count + (m.role === "assistant" ? m.parts.filter((p) => p.type === "confirm" && p.state === "pending").length : 0), 0);
  const confirmationText = pendingConfirmations ? ` ${pendingConfirmations} ${pendingConfirmations === 1 ? "action needs" : "actions need"} confirmation.` : "";
  const feedbackText = requestFeedback?.phase === "working" ? `Processing your request.${confirmationText}`
    : requestFeedback?.phase === "error" ? "Request failed. Review the error."
    : requestFeedback?.phase === "ready" ? `Reply ready.${confirmationText}` : "";

  // Only request transitions notify. Tokens, card decisions and history mounts
  // do not. Mark closed-panel events consumed so reopening never replays them.
  useEffect(() => {
    if (!requestFeedback) return;
    const event = `${requestFeedback.id}:${requestFeedback.phase}`;
    if (lastAnnounced.current === event) return;
    lastAnnounced.current = event;
    setAnnouncement(openRef.current && requestFeedback.announce ? feedbackText : "");
  }, [requestFeedback, feedbackText]);
  useEffect(() => { if (!open) setAnnouncement(""); }, [open]);
  const router = useRouter();
  const pathname = usePathname();
  const scrollRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const focusOnOpen = useRef(false);
  const focusOnClose = useRef(false);
  const panelTitleId = useId();
  const inputId = useId();
  const inputHelpId = `${inputId}-help`;

  function openAssistant(trigger?: HTMLElement) {
    // Reopening an already visible assistant must not interrupt the user.
    if (!panelRef.current) {
      const source = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
      returnFocusRef.current = source === document.body ? null : source;
      focusOnOpen.current = true;
    }
    setOpen(true);
  }
  function closeAssistant() {
    focusOnClose.current = !!panelRef.current?.contains(document.activeElement);
    openRef.current = false;
    setAnnouncement("");
    setOpen(false);
  }

  const { jobs, startJob } = useJobs();
  const pipeline = usePipeline();
  const apply = useApply();

  // refs so the streaming closure always sees the latest jobs/pipeline/apply/cli
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;
  const pipelineRef = useRef(pipeline);
  pipelineRef.current = pipeline;
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const explore = useExplore();
  const exploreRef = useRef(explore);
  exploreRef.current = explore;
  const handledRef = useRef<Set<string>>(new Set());
  const confirmRuns = useRef<Map<string, () => DoneInfo>>(new Map());
  const statusRuns = useRef(new Map<string, { run?: () => Promise<DoneInfo>; pending: boolean; settled: boolean }>());

  // panel size: restored on mount (client-only, so SSR markup never mismatches),
  // persisted on change
  const [size, setSize] = useState<PanelSize>("compact");
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SIZE_KEY) as PanelSize | null;
      if (raw && SIZE_ORDER.includes(raw)) setSize(raw);
    } catch {
      /* ignore */
    }
  }, []);
  function cycleSize() {
    const next = SIZE_ORDER[(SIZE_ORDER.indexOf(size) + 1) % SIZE_ORDER.length];
    setSize(next);
    try {
      localStorage.setItem(SIZE_KEY, next);
    } catch {
      /* ignore */
    }
  }

  // composer auto-grow: height follows content up to the per-size cap; clearing
  // the input (after send) shrinks it back to one line. Done in an effect, AFTER
  // React has applied the style prop — an imperative height set inside onChange
  // is wiped by the very next render.
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    if (input) el.style.height = `${Math.min(el.scrollHeight, INPUT_MAX_PX[size])}px`;
  }, [input, size, open]);

  useLayoutEffect(() => {
    if (open && focusOnOpen.current) {
      focusOnOpen.current = false;
      // A removed Ask button leaves focus on body. Preserve any newer focus.
      if (document.activeElement !== document.body && document.activeElement !== returnFocusRef.current) return;
      const target = inputRef.current && !inputRef.current.disabled
        ? inputRef.current
        : panelRef.current?.querySelector<HTMLElement>('a[href="/config"]');
      target?.focus();
    } else if (!open && focusOnClose.current) {
      focusOnClose.current = false;
      if (document.activeElement !== document.body) return;
      const trigger = returnFocusRef.current;
      const usable = trigger?.isConnected && trigger.getClientRects().length > 0 && !trigger.matches(":disabled, [inert], [inert] *");
      (usable ? trigger : openerRef.current)?.focus();
    }
  }, [open]);

  // Selected CLI from Config, including saves in this tab.
  useEffect(() => {
    function read() {
      try {
        const raw = localStorage.getItem(CONFIG_KEY);
        setCliId(raw ? JSON.parse(raw).cliId || null : null);
      } catch {
        setCliId(null);
      }
    }
    read();
    return subscribeConfig(window, read);
  }, []);

  async function chatRequest(url: string, init?: RequestInit) {
    const response = await fetch(url, init);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Conversation request failed");
    return data;
  }
  async function refreshChats() {
    const data = await chatRequest("/api/assistant/chats");
    setChats(data.chats);
    setChatWarnings(data.errors);
  }
  function flushChat(title?: string): Promise<void> {
    const current = activeChat.current;
    let snapshot: Msg[];
    try { snapshot = cleanMessages(messagesRef.current) as Msg[]; }
    catch (e) {
      const error = e instanceof Error ? e : new Error("Conversation could not be saved");
      setSaveError(error.message);
      return Promise.reject(error);
    }
    if (!snapshot.some(m => m.role === "user")) return Promise.resolve();
    const encoded = JSON.stringify(snapshot);
    const operation = saveQueue.current.catch(() => {}).then(async () => {
      if (encoded === savedSnapshot.current && title === undefined) return;
      try {
        const chat = await chatRequest("/api/assistant/chats", {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...current, ...(title ? { title } : {}), messages: snapshot }),
        });
        current.revision = chat.revision;
        current.title = chat.title;
        savedSnapshot.current = encoded;
        setSaveError("");
        await refreshChats();
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : "Conversation was not saved");
        throw e;
      }
    });
    saveQueue.current = operation;
    return operation;
  }
  const flushRef = useRef(flushChat);
  flushRef.current = flushChat;

  useEffect(() => {
    let cancelled = false;
    async function restore() {
      try {
        const data = await chatRequest("/api/assistant/chats");
        let restored;
        const legacy = localStorage.getItem(CHAT_KEY);
        if (legacy) {
          const migrated = cleanMessages(JSON.parse(legacy));
          if (migrated.some(m => m.role === "user")) {
            // A stable migration id makes retrying a lost response safe.
            const key = `${CHAT_KEY}:migration-id`;
            const id = localStorage.getItem(key) || crypto.randomUUID();
            localStorage.setItem(key, id);
            if (data.chats.some((c: { id: string }) => c.id === id)) {
              restored = await chatRequest(`/api/assistant/chats?id=${id}`);
            } else {
              restored = await chatRequest("/api/assistant/chats", {
                method: "PUT", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id, revision: 0, messages: migrated }),
              });
            }
          }
          localStorage.removeItem(CHAT_KEY); // only after a successful disk write
        }
        if (!restored && data.chats.length) restored = await chatRequest(`/api/assistant/chats?id=${data.chats[0].id}`);
        if (cancelled) return;
        activeChat.current = restored ? { id: restored.id, revision: restored.revision, title: restored.title } : { id: crypto.randomUUID(), revision: 0 };
        const next = restored ? cleanMessages(restored.messages) as Msg[] : [];
        savedSnapshot.current = JSON.stringify(next);
        messagesRef.current = next;
        setMessages(next);
        await refreshChats();
        setChatReady(true);
      } catch (e) { if (!cancelled) setSaveError(e instanceof Error ? e.message : "Could not load conversations"); }
    }
    void restore();
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!chatReady || chatPending || busy) return;
    const timer = setTimeout(() => { void flushRef.current().catch(() => {}); }, 400);
    return () => clearTimeout(timer);
  }, [messages, chatReady, chatPending, busy]);
  useEffect(() => {
    if (!chatReady || chatPending || busy) return;
    void flushRef.current().catch(() => {});
  }, [busy, chatReady, chatPending]);
  useEffect(() => {
    if (!chatReady || chatPending) return;
    const save = () => { if (document.visibilityState === "hidden") void flushRef.current().catch(() => {}); };
    document.addEventListener("visibilitychange", save);
    return () => document.removeEventListener("visibilitychange", save);
  }, [chatReady, chatPending]);

  async function selectChat(id?: string) {
    if (busy || chatPending || !chatReady) return;
    setChatPending(true);
    try {
      await flushChat();
      const chat = id ? await chatRequest(`/api/assistant/chats?id=${id}`) : null;
      activeChat.current = chat ? { id: chat.id, revision: chat.revision, title: chat.title } : { id: crypto.randomUUID(), revision: 0 };
      const next = chat ? cleanMessages(chat.messages) as Msg[] : [];
      savedSnapshot.current = JSON.stringify(next);
      messagesRef.current = next;
      setMessages(next);
      setInput("");
      confirmRuns.current.clear();
      statusRuns.current.clear();
      setRequestFeedback(null);
      setAnnouncement("");
    } catch (e) { setSaveError(e instanceof Error ? e.message : "Could not switch conversations"); }
    finally { setChatPending(false); }
  }
  function exportChat() {
    // Export the live draft even if it exceeds the storage limits.
    const blob = new Blob([JSON.stringify({ ...activeChat.current, messages: messagesRef.current, draft: input }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `conversation-${activeChat.current.id}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function discardAndStartChat() {
    if (busy || chatPending || !chatReady) return;
    if (!window.confirm("Discard unsaved changes and start a new conversation? Saved conversations stay on disk. Export this conversation first if you want to keep the unsaved text.")) return;
    setChatPending(true);
    try {
      // Let writes already in flight finish before changing the active id.
      await saveQueue.current.catch(() => {});
      activeChat.current = { id: crypto.randomUUID(), revision: 0 };
      savedSnapshot.current = "";
      messagesRef.current = [];
      setMessages([]);
      setInput("");
      confirmRuns.current.clear();
      statusRuns.current.clear();
      setRequestFeedback(null);
      setAnnouncement("");
      setSaveError("");
    } finally { setChatPending(false); }
  }
  async function renameChat() {
    const title = window.prompt("Conversation name", activeChat.current.title || "");
    if (!title?.trim()) return;
    setChatPending(true);
    try { await flushChat(title.trim()); } catch { /* shown by flushChat */ }
    finally { setChatPending(false); }
  }
  async function removeChat() {
    if (!window.confirm("Delete this conversation?")) return;
    setChatPending(true);
    try {
      await flushChat();
      const { id, revision } = activeChat.current;
      await chatRequest(`/api/assistant/chats?id=${id}&revision=${revision}`, { method: "DELETE" });
      activeChat.current = { id: crypto.randomUUID(), revision: 0 };
      savedSnapshot.current = "";
      messagesRef.current = [];
      setMessages([]);
      confirmRuns.current.clear();
      statusRuns.current.clear();
      setRequestFeedback(null);
      setAnnouncement("");
      await refreshChats();
    } catch (e) { setSaveError(e instanceof Error ? e.message : "Could not delete conversation"); }
    finally { setChatPending(false); }
  }

  useEffect(() => {
    if (open && messages.length === 0) setMessages([{ role: "assistant", parts: [{ type: "text", text: GREETING }] }]);
  }, [open, messages.length]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // ── message mutators (operate on the last assistant message) ──
  function patchLastAssistant(ms: Msg[], fn: (m: Msg) => Msg): Msg[] {
    const copy = [...ms];
    for (let i = copy.length - 1; i >= 0; i--) {
      if (copy[i].role === "assistant") {
        copy[i] = fn(copy[i]);
        break;
      }
    }
    return copy;
  }
  const setStreamText = (text: string) =>
    setMessages((ms) =>
      patchLastAssistant(ms, (m) => {
        const parts = [...m.parts];
        const idx = parts.findIndex((p) => p.type === "text");
        if (idx === -1) parts.unshift({ type: "text", text });
        else parts[idx] = { type: "text", text };
        return { ...m, parts };
      }),
    );
  const appendParts = (newParts: Part[]) =>
    setMessages((ms) => patchLastAssistant(ms, (m) => ({ ...m, parts: [...m.parts, ...newParts] })));

  function appendCards(info: DoneInfo) {
    const ids = info.jobIds ?? [];
    if (!ids.length) {
      if (info.note) appendParts([{ type: "note", text: info.note }]);
      return;
    }
    if (info.batchId && ids.length > 1) appendParts([{ type: "batch", batchId: info.batchId, jobIds: ids }]);
    else appendParts(ids.map((jobId) => ({ type: "card" as const, jobId })));
  }

  function buildCtx(): ActionCtx {
    return {
      push: (p) => router.push(p),
      replace: (p) => router.replace(p),
      startJob,
      inbox: pipelineRef.current.inbox,
      applications: pipelineRef.current.applications,
      jobForUrl: (url) => {
        const m = jobsRef.current.filter((j) => j.input === url).sort((a, b) => b.startedAt - a.startedAt);
        return m[0];
      },
      estimateCost: (kind, count) => estimateRunCost(jobsRef.current, kind, count),
      rememberFact: (fact) => {
        fetch("/api/memory", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fact }),
        }).catch(() => {});
      },
      writeStatus: async (n, status) => {
        await writeAssistantStatus(n, status);
        router.refresh();
        pipelineRef.current.refetch();
      },
      setApplyField: (idOrLabel, value) => applyRef.current.setAnswer(idOrLabel, value),
      startApply: (u) => {
        router.push("/apply");
        setTimeout(() => applyRef.current.open(u), 60);
      },
      applyExplore: (patch, opts) => exploreRef.current.applyPatch(patch, opts),
      // A refused or failed write must not pass for a saved one: the route
      // answers 4xx/5xx with the reason, and resolveConfirm puts it on the card.
      writeProfile: (patch) =>
        postAssistantWrite("/api/profile", patch).then((failure) => {
          if (!failure) router.refresh();
          return failure ? `Your profile was NOT saved: ${failure}.` : null;
        }),
      writePortals: (roles, location) =>
        postAssistantWrite("/api/portals", { roles, location }).then((failure) =>
          failure ? `Your scan targets were NOT saved: ${failure}.` : null,
        ),
      writePersonalization: (patch) => {
        fetch("/api/personalization", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) })
          .then(async (r) => {
            // A refused or failed write must not pass for a saved one: the route
            // answers 409/500 with the reason, and the file is left as it was.
            if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { error?: string } | null)?.error || `HTTP ${r.status}`);
            router.refresh();
            // The onboarding panel listens for this to refetch section state.
            window.dispatchEvent(new CustomEvent("co-onboarding-changed"));
          })
          .catch((e) => appendParts([{ type: "note", text: `Your personalization was NOT saved: ${e instanceof Error ? e.message : "the request failed"}` }]));
      },
    };
  }

  function runDispatch(id: string, args: Record<string, unknown>) {
    const res = dispatch(id, args, buildCtx());
    if (res.status === "done") appendCards(res);
    else if (res.status === "ignored") {
      if (res.note) appendParts([{ type: "note", text: res.note }]);
    } else if (res.status === "confirm") {
      const cid = `c-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
      if (res.statusChange) {
        statusRuns.current.set(cid, { run: res.run, pending: false, settled: false });
        appendParts([{ type: "confirm", cid, summary: res.summary, statusChange: res.statusChange, state: "pending" }]);
      } else {
        confirmRuns.current.set(cid, res.run);
        appendParts([{ type: "confirm", cid, summary: res.summary, state: "pending" }]);
      }
    }
    return res.status !== "ignored" || Boolean(res.note?.trim());
  }

  async function resolveStatusConfirm(cid: string, accept: boolean) {
    const entry = statusRuns.current.get(cid);
    if (!entry || entry.pending || entry.settled || !entry.run) return;
    const update = (patch: Partial<StatusConfirmationPart>) => setMessages((ms) => ms.map((m) => ({ ...m,
      parts: m.parts.map((p) => p.type === "confirm" && p.statusChange && p.cid === cid ? { ...p, ...patch } : p),
    })));
    if (!accept) {
      entry.settled = true;
      entry.run = undefined;
      update({ state: "cancelled" });
      return;
    }
    entry.pending = true;
    update({ state: "saving", message: undefined, retryable: false });
    try {
      await entry.run();
      entry.settled = true;
      entry.run = undefined;
      update({ state: "done" });
    } catch (error) {
      const known = error instanceof StatusWriteError;
      const retryable = known && error.retryable;
      entry.settled = !retryable;
      if (!retryable) entry.run = undefined;
      update({ state: known && !error.unconfirmed ? "failed" : "unconfirmed", retryable,
        message: known ? error.message : "The status change could not be confirmed. Check the current tracker status before trying again." });
    } finally {
      entry.pending = false;
    }
  }

  function resolveConfirm(cid: string, accept: boolean) {
    if (statusRuns.current.has(cid)) { void resolveStatusConfirm(cid, accept); return; }
    const run = confirmRuns.current.get(cid);
    confirmRuns.current.delete(cid);
    const info = accept && run ? run() : null;
    // A write card stays "saving" until its write settles, so a chat saved in
    // between records it as unconfirmed, never done. Matched by cid, so a write
    // that settles after the user switched chats updates only the card that
    // started it, never the chat now on screen.
    void info?.failure
      ?.catch(() => "The write could not be confirmed.")
      .then((message) => {
        setMessages((ms) => ms.map((m) => ({ ...m,
          parts: m.parts.map((p) => p.type === "confirm" && !p.statusChange && p.cid === cid
            ? (message ? { ...p, state: "failed" as const, message } : { ...p, state: "done" as const }) : p),
        })));
      });
    setMessages((ms) =>
      ms.map((m) => {
        if (!m.parts.some((p) => p.type === "confirm" && p.cid === cid)) return m;
        const parts: Part[] = m.parts.map((p) =>
          p.type === "confirm" && p.cid === cid ? { ...p, state: !accept ? "cancelled" : info?.failure ? "saving" : "done" } : p,
        );
        if (info?.jobIds?.length) {
          if (info.batchId && info.jobIds.length > 1) parts.push({ type: "batch", batchId: info.batchId, jobIds: info.jobIds });
          else parts.push(...info.jobIds.map((jobId) => ({ type: "card" as const, jobId })));
        }
        return { ...m, parts };
      }),
    );
  }

  // compact pipeline snapshot for the model (counts + per-company pending — lets
  // it offer/act on "all the Anthropic ones" without re-reading files)
  function pipelineContext(): string {
    const pending = pipelineRef.current.inbox.filter((j) => !j.done);
    if (!pending.length) return "";
    const counts = new Map<string, number>();
    for (const j of pending) counts.set(j.company, (counts.get(j.company) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
    return `\n\nINBOX SNAPSHOT: ${pending.length} pending postings. By company: ${top
      .map(([c, n]) => `${c} (${n})`)
      .join(", ")}. To evaluate every pending posting for one company, emit evaluateCompany with just the company name.`;
  }

  // When the user is on /apply, expose the proxy form's fields + current answers
  // so the assistant can write/revise any answer (setApplyField) on request.
  function applyContext(): string {
    const ap = applyRef.current;
    if (!pathname.startsWith("/apply") || !ap.fields.length) return "";
    const lines = ap.fields
      .map((f) => `- ${f.label || f.id}${ap.meta[f.id]?.needsConfirmation ? " (user confirms)" : ""}: ${ap.answers[f.id] ? `"${ap.answers[f.id].slice(0, 240)}"` : "(empty)"}`)
      .join("\n");
    return `\n\nAPPLY FORM — the user is filling "${ap.title}". Current answers:\n${lines}\nTo write or revise an answer, emit setApplyField {"field":"<label or id>","value":"<new text>"}. If a change reveals a durable preference or corrected fact, ALSO remember it.`;
  }

  async function send(forced?: string) {
    const text = (forced ?? input).trim();
    if (!text || busy || !cliId || !chatReady || chatPending) return;
    if (forced === undefined) setInput("");
    const history = messages.filter((m) => msgText(m) && msgText(m) !== GREETING).map((m) => ({ role: m.role, content: msgText(m) }));
    const next: Msg[] = [...messages, { role: "user", parts: [{ type: "text", text }] }, { role: "assistant", parts: [{ type: "text", text: "" }] }];
    messagesRef.current = next;
    setMessages(next);
    setBusy(true);
    const requestId = ++requestSequence.current;
    setRequestFeedback({ id: requestId, phase: "working", announce: true });
    let failed = false;
    let reachedAssistant = false;
    handledRef.current = new Set();
    const shimsDone = new Set<string>();
    try {
      await flushChat();
      reachedAssistant = true;
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, cliId, history, pageContext: describePage(pathname) + pipelineContext() + applyContext() }),
      });
      if (!res.ok || !res.body) {
        failed = true;
        const err = await res.json().catch(() => ({}));
        setStreamText(`⚠️ ${err.error || "Assistant unavailable."}`);
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = "";
      let display = "";
      let hasActionOutput = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });

        const { complete, hidePartialFrom } = parseEnvelopes(acc);
        const cuts: [number, number][] = complete.map((e) => [e.start, e.end]);
        if (hidePartialFrom >= 0) cuts.push([hidePartialFrom, acc.length]);
        display = removeRanges(acc, cuts);

        // back-compat shims (strip + queue) on the cleaned text
        const shimNavs: string[] = [];
        const shimRems: string[] = [];
        display = display.replace(NAV_RE, (_, p) => {
          shimNavs.push(p);
          return "";
        });
        display = display.replace(REMEMBER_RE, (_, f) => {
          shimRems.push(String(f).trim());
          return "";
        });
        setStreamText(display.trimStart());

        for (const e of complete) {
          const key = `${e.start}|${e.id}|${e.argsJson}`;
          if (handledRef.current.has(key)) continue;
          handledRef.current.add(key);
          let args: Record<string, unknown>;
          try {
            args = JSON.parse(normalizeJson(e.argsJson));
          } catch {
            continue;
          }
          hasActionOutput = runDispatch(e.id, args) || hasActionOutput;
        }
        for (const p of shimNavs) {
          const k = `go:${p}`;
          if (!shimsDone.has(k)) {
            shimsDone.add(k);
            hasActionOutput = runDispatch("navigate", { path: p }) || hasActionOutput;
          }
        }
        for (const f of shimRems) {
          const k = `rem:${f}`;
          if (f && !shimsDone.has(k)) {
            shimsDone.add(k);
            hasActionOutput = runDispatch("remember", { fact: f }) || hasActionOutput;
          }
        }
      }
      // Hidden/truncated envelopes are wire data, not a usable reply. A valid
      // action-only response still counts, without approving its confirmation.
      if (!display.trim() && !hasActionOutput) {
        failed = true;
        setStreamText("_(no output — is the CLI authenticated?)_");
      }
    } catch (error) {
      failed = true;
      setStreamText(reachedAssistant ? "⚠️ Connection error." : `⚠️ Request not sent: ${error instanceof Error ? error.message : "conversation could not be saved"}`);
    } finally {
      // flushChat already exposes save failures via its existing alert.
      setRequestFeedback({ id: requestId, phase: failed ? "error" : "ready", announce: reachedAssistant });
      setBusy(false);
      router.refresh();
      pipelineRef.current.refetch();
    }
  }

  // Other surfaces (e.g. the onboarding banner) can open the assistant and kick
  // off a turn via a window event.
  const sendRef = useRef<(m?: string) => void>(() => {});
  sendRef.current = send;
  useEffect(() => {
    function onOpen(e: Event) {
      openAssistant();
      const msg = (e as CustomEvent).detail?.message as string | undefined;
      if (msg) setTimeout(() => sendRef.current(msg), 80);
    }
    window.addEventListener("co-assistant", onOpen);
    return () => window.removeEventListener("co-assistant", onOpen);
  }, []);

  // ── proactive suggestion chips (onboarding + offer-driven next steps) ──
  const suggestions = useMemo(() => {
    const chips: { label: string; send: string }[] = [];
    const rep = pathname.match(/^\/pipeline\/(.+)$/);
    if (rep) {
      chips.push({ label: "Why this score?", send: "Walk me through why this offer scored the way it did — strengths and red flags." });
      chips.push({ label: "Should I apply?", send: "Given my profile, should I apply to this one? Be honest." });
      chips.push({ label: "Draft a cover letter", send: "Draft a short, sharp cover letter for this role." });
      return chips;
    }
    const pending = pipeline.inbox.filter((j) => !j.done);
    if (!pipeline.applications.length && !pending.length) {
      return [
        { label: "Help me get set up", send: "Help me get started with career-ops — what do you need from me?" },
        { label: "Improve my CV", send: "Look at my CV and suggest the highest-impact improvements." },
      ];
    }
    if (pending.length) {
      const counts = new Map<string, number>();
      for (const j of pending) counts.set(j.company, (counts.get(j.company) ?? 0) + 1);
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      if (top && top[1] > 1) chips.push({ label: `Evaluate all ${top[0]} (${top[1]})`, send: `Evaluate all the pending ${top[0]} postings in my inbox.` });
      chips.push({ label: `Triage inbox (${pending.length})`, send: `I have ${pending.length} postings in my inbox — which should I evaluate first, and why?` });
    }
    const strong = pipeline.applications.filter((a) => scoreNum(a.score) >= 4.5).length;
    if (strong) chips.push({ label: "Strong matches to act on", send: "Show me my strongest matches (4.5+) I haven't applied to yet, and tell me which to prioritise." });
    chips.push({ label: "What should I do today?", send: "Look at my pipeline and tell me the 3 highest-leverage things I should do today." });
    return chips.slice(0, 4);
  }, [pathname, pipeline.inbox, pipeline.applications]);

  return (
    <>
      <div role="status" aria-label="Assistant request status" aria-live="polite" aria-atomic="true" className="sr-only">{announcement}</div>
      {!open && (
        <button
          ref={openerRef}
          onClick={(e) => openAssistant(e.currentTarget)}
          onPointerEnter={loadMarkdown}
          onFocus={loadMarkdown}
          className="fixed bottom-5 right-5 z-50 flex items-center justify-center gap-2 rounded-full border border-border bg-surface/90 py-1.5 pl-1.5 pr-4 shadow-lg backdrop-blur transition-colors hover:bg-surface-hover max-sm:min-h-[44px]"
        >
          <CoMark size={26} />
          <span className="text-sm font-medium">Ask<span className="sr-only"> the assistant</span></span>
        </button>
      )}

      {open && (
        <div
          ref={panelRef}
          role="region"
          aria-labelledby={panelTitleId}
          onKeyDown={(e) => {
            // Let composition and native select popups handle Escape first.
            if (e.key !== "Escape" || e.defaultPrevented || e.nativeEvent.isComposing || e.keyCode === 229 || (e.target instanceof HTMLElement && e.target.closest("select"))) return;
            e.preventDefault();
            e.stopPropagation();
            closeAssistant();
          }}
          className={cn("fixed z-50 flex flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl", PANEL_CLASS[size])}
        >
          <header className="flex items-center gap-2.5 border-b border-border px-4 py-3">
            <CoMark size={26} />
            <div className="flex-1">
              <div id={panelTitleId} className="text-sm font-semibold tracking-tight">Assistant</div>
              <div className="text-xs text-faint">{cliId ? `via ${cliId}` : "no CLI configured"}</div>
            </div>
            <Button variant="ghost" size="icon" onClick={cycleSize} className="text-muted" aria-label={SIZE_LABEL[size]} title={SIZE_LABEL[size]}>
              {size === "full" ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={() => void selectChat()} disabled={busy || chatPending || !chatReady} className="text-muted" aria-label="New chat" title="New chat">
              <RotateCcw className="size-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={closeAssistant} className="text-muted" aria-label="Close assistant">
              <X className="size-4" />
            </Button>
          </header>

          <div className="flex gap-2 border-b border-border px-4 py-2">
            <select aria-label="Conversation history" className="min-w-0 flex-1 bg-surface text-sm" value={chats.some(c => c.id === activeChat.current.id) ? activeChat.current.id : ""} disabled={busy || chatPending || !chatReady} onChange={e => void selectChat(e.target.value || undefined)}>
              <option value="">New chat</option>
              {chats.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
            <button className="text-xs text-muted disabled:opacity-40" disabled={busy || chatPending || !activeChat.current.revision} onClick={() => void renameChat()}>Rename</button>
            <button className="text-xs text-muted disabled:opacity-40" disabled={busy || chatPending || !activeChat.current.revision} onClick={() => void removeChat()}>Delete</button>
          </div>
          {chatWarnings.map(warning => <div key={warning.id} role="alert" className="px-4 py-2 text-sm text-amber-600">{warning.error}. Other conversations are still available.</div>)}
          {saveError && <div role="alert" className="space-y-2 px-4 py-2 text-sm text-amber-600">
            <p>{saveError}</p>
            {chatReady ? <div className="flex flex-wrap gap-3">
              <button className="underline" disabled={busy || chatPending} onClick={() => void flushChat().catch(() => {})}>Retry save</button>
              <button className="underline" disabled={busy || chatPending} onClick={exportChat}>Export conversation</button>
              <button className="underline" disabled={busy || chatPending} onClick={() => void discardAndStartChat()}>Discard unsaved changes and start new chat</button>
            </div> : <button className="underline" onClick={() => window.location.reload()}>Reload</button>}
          </div>}
          <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {messages.map((m, i) => {
              const hasVisible = m.parts.some((p) => (p.type === "text" && p.text.trim()) || p.type !== "text");
              const isLast = i === messages.length - 1;
              return (
                <div
                  key={i}
                  ref={i === latestReplyIndex ? latestReplyRef : undefined}
                  role={m.role === "assistant" ? "group" : undefined}
                  aria-label={m.role === "assistant" ? (i === latestReplyIndex ? "Latest assistant reply" : "Assistant reply") : undefined}
                  tabIndex={m.role === "assistant" ? -1 : undefined}
                  className={cn("flex rounded focus-visible:outline-2 focus-visible:outline-brand", m.role === "user" ? "justify-end" : "justify-start")}
                >
                  <div
                    className={cn(
                      "max-w-[88%] rounded-2xl px-3.5 py-2 text-sm",
                      m.role === "user" ? "bg-brand text-brand-foreground" : "w-full bg-surface-hover text-foreground",
                    )}
                  >
                    {m.role === "user" ? (
                      msgText(m)
                    ) : !hasVisible && busy && isLast ? (
                      <Loader2 className="size-4 animate-spin text-muted" />
                    ) : (
                      <div className="space-y-2">
                        {m.parts.map((p, j) => (
                          <PartView key={j} part={p} jobs={jobs} onConfirm={resolveConfirm} onOpen={() => {}} />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* proactive suggestion chips — onboarding + offer-driven next steps */}
          {cliId && !busy && suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-3 pb-1 pt-0.5">
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  onClick={() => send(s.send)}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-surface/60 px-2.5 py-1 text-xs text-muted transition-colors hover:border-brand/40 hover:bg-brand-soft hover:text-brand-text"
                >
                  <Sparkles className="size-3 text-brand-text/70" />
                  {s.label}
                </button>
              ))}
            </div>
          )}

          {!cliId && (
            <Link
              href="/config"
              onClick={() => setOpen(false)}
              className="mx-4 mb-2 flex items-center gap-2 rounded-lg border border-border bg-surface/50 px-3 py-2 text-xs text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
            >
              <Settings className="size-3.5" /> Pick a CLI in Config to enable the assistant →
            </Link>
          )}

          <div className="border-t border-border p-3">
            <label htmlFor={inputId} className="sr-only">Message to assistant</label>
            <p id={inputHelpId} className="sr-only">Enter sends your message. Shift+Enter adds a new line.</p>
            <div className="flex items-end gap-2">
              <textarea
                id={inputId}
                aria-describedby={inputHelpId}
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder={cliId ? "Ask anything…" : "Configure a CLI first"}
                rows={1}
                disabled={!cliId}
                style={{ maxHeight: INPUT_MAX_PX[size] }}
                className="flex-1 resize-none rounded-xl border border-border bg-surface/60 px-3 py-2 text-sm outline-none transition-colors placeholder:text-faint focus:border-brand/50 disabled:opacity-50"
              />
              <button
                onClick={(e) => {
                  if (document.activeElement === e.currentTarget) inputRef.current?.focus();
                  void send();
                }}
                disabled={busy || chatPending || !chatReady || !input.trim() || !cliId}
                className="rounded-xl bg-brand p-2 text-brand-foreground transition-colors hover:bg-brand-200 disabled:opacity-40"
                aria-label="Send"
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              </button>
            </div>
            <div className="mt-2 space-y-1 text-xs">
              {feedbackText && <p id={feedbackId} className="text-muted">{feedbackText}</p>}
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {!busy && latestReply?.parts.some((p) => p.type !== "text" || p.text.trim()) && (
                  <button type="button" aria-describedby={feedbackText ? feedbackId : undefined} onClick={() => {
                    latestReplyRef.current?.focus({ preventScroll: true });
                    latestReplyRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
                  }} className="text-brand-text underline">
                    {requestFeedback?.phase === "error" ? "Review error" : "Read latest reply"}
                  </button>
                )}
                {pendingConfirmations > 0 && (
                  <button type="button" onClick={() => scrollRef.current?.querySelector<HTMLElement>('[data-assistant-confirmation="pending"]')?.focus()} className="text-brand-text underline">
                    Review pending actions
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── part renderers ──
function PartView({
  part,
  jobs,
  onConfirm,
}: {
  part: Part;
  jobs: ReturnType<typeof useJobs>["jobs"];
  onConfirm: (cid: string, accept: boolean) => void;
  onOpen: () => void;
}) {
  if (part.type === "text") {
    if (!part.text.trim()) return null;
    return (
      <div className="report-prose text-sm [&_*]:my-1 [&>:first-child]:mt-0 [&>:last-child]:mb-0">
        <Suspense fallback={part.text}>
          <AssistantMarkdown text={part.text} />
        </Suspense>
      </div>
    );
  }
  if (part.type === "note") {
    return <div className="text-xs italic text-faint">{part.text}</div>;
  }
  if (part.type === "card") {
    const job = jobs.find((j) => j.id === part.jobId);
    if (!job)
      return (
        <Link href={`/jobs/${part.jobId}`} className="block rounded-xl border border-border bg-surface/40 p-2.5 text-xs text-faint hover:text-foreground">
          Worker finished earlier — open log →
        </Link>
      );
    return (
      <WorkerCard
        job={job}
        variant="inline"
        trailing={
          <Link href={`/jobs/${job.id}`} className="text-faint transition-colors hover:text-brand-text" aria-label={workerDetailsLabel(job)}>
            <ArrowUpRight className="size-3.5" />
          </Link>
        }
      />
    );
  }
  if (part.type === "batch") {
    const children = part.jobIds.map((id) => jobs.find((j) => j.id === id)).filter((j) => j != null);
    return (
      <div className="rounded-xl border border-border bg-surface/40 p-2.5">
        <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium">
          <Sparkles className="size-3.5 text-brand-text" />
          {part.jobIds.length} evaluations
          <span className="ml-auto tabular-nums text-faint">
            {workerBatchSummary(children, part.jobIds.length)}
          </span>
        </div>
        <div className="space-y-1.5">
          {children.map((j) => (
            <WorkerCard
              key={j.id}
              job={j}
              variant="inline"
              trailing={
                <Link href={`/jobs/${j.id}`} className="text-faint transition-colors hover:text-brand-text" aria-label={workerDetailsLabel(j)}>
                  <ArrowUpRight className="size-3.5" />
                </Link>
              }
            />
          ))}
        </div>
      </div>
    );
  }
  if (part.type === "confirm") {
    return part.statusChange ? <StatusConfirmationCard key={part.cid} part={part} onConfirm={onConfirm} />
      : <ConfirmationCard key={part.cid} part={part} onConfirm={onConfirm} />;
  }
  return null;
}

function ConfirmationCard({ part, onConfirm }: {
  part: Extract<Part, { type: "confirm" }>;
  onConfirm: (cid: string, accept: boolean) => void;
}) {
  const id = useId();
  const summaryId = `${id}-summary`;
  const resultId = `${id}-result`;
  const resultRef = useRef<HTMLDivElement>(null);
  const decisionRef = useRef<HTMLButtonElement | null>(null);

  // Only continue focus from the decision control being removed. Arrival,
  // history restoration and unrelated focus must never pull the user here.
  useLayoutEffect(() => {
    const decision = decisionRef.current;
    if (part.state === "pending" || !decision) return;
    decisionRef.current = null;
    if (document.activeElement === decision || document.activeElement === document.body) {
      resultRef.current?.focus();
    }
  }, [part.state]);

  function decide(button: HTMLButtonElement, accept: boolean) {
    decisionRef.current = document.activeElement === button ? button : null;
    onConfirm(part.cid, accept);
  }

  return (
    <div role="group" aria-labelledby={summaryId} data-assistant-confirmation={part.state} tabIndex={-1} className="rounded-xl border border-brand/40 bg-brand-soft p-2.5 focus-visible:outline-2 focus-visible:outline-brand">
      <div id={summaryId} className="text-xs font-medium text-foreground">{part.summary}</div>
      {part.state === "pending" ? (
        <div className="mt-2 flex gap-2">
          <button
            aria-label={`Confirm: ${part.summary}`}
            onClick={(e) => decide(e.currentTarget, true)}
            className="rounded-full bg-brand px-3 py-1 text-xs font-medium text-brand-foreground transition-colors hover:bg-brand-200"
          >
            Confirm
          </button>
          <button
            aria-label={`Cancel: ${part.summary}`}
            onClick={(e) => decide(e.currentTarget, false)}
            className="rounded-full border border-border px-3 py-1 text-xs text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div ref={resultRef} tabIndex={-1} aria-labelledby={`${summaryId} ${resultId}`} className="mt-1 rounded text-xs text-faint focus-visible:outline-2 focus-visible:outline-brand">
          <span id={resultId} role={part.state === "failed" ? "alert" : undefined} className={part.state === "failed" ? "text-red-600 dark:text-red-400" : undefined}>
            {part.state === "done" ? "✓ started" : part.state === "saving" ? "saving…" : part.state === "failed" ? part.message : "cancelled"}
          </span>
        </div>
      )}
    </div>
  );
}
