"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Send, X, Loader2, Settings, RotateCcw, ArrowUpRight, Maximize2, Minimize2 } from "lucide-react";
import { CoMark } from "@/components/co-mark";
import { useJobs } from "@/components/jobs/job-store";
import { usePipeline } from "@/components/pipeline/pipeline-provider";
import { useApply } from "@/components/apply/apply-provider";
import { useExplore } from "@/components/explore/explore-provider";
import { WorkerCard } from "@/components/jobs/worker-card";
import { Button } from "@/components/ui/button";
import { dispatch, type ActionCtx, type DoneInfo } from "@/app/actions/registry";
import { estimateRunCost } from "@/lib/run-cost-estimate.mjs";
import { scoreNum } from "@/lib/format";
import { pendingActOpenerStart } from "@/lib/act-envelope.mjs";
import { cleanMessages } from "@/lib/assistant-history.mjs";
import { cn } from "@/lib/cn";
import { persistCliId, pickDefaultInstalled, readSavedCliId } from "@/lib/saved-cli";
import { keepIfInstalled } from "@/lib/cli-pick.mjs";

// ── message model: messages are PART arrays so a live worker card can render
// inline next to text, both fed by the single JobsProvider store ──────────────
type Part =
  | { type: "text"; text: string }
  | { type: "note"; text: string }
  | { type: "card"; jobId: string }
  | { type: "batch"; batchId: string; jobIds: string[] }
  | { type: "confirm"; cid: string; summary: string; state: "pending" | "done" | "cancelled" };
type Msg = { role: "user" | "assistant"; parts: Part[] };
type AssistantCli = { id: string; name: string; installed: boolean };

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
const SIZE_LABEL: Record<PanelSize, string> = { compact: "Aumentar largura", wide: "Ecrã inteiro", full: "Tamanho compacto" };
// back-compat shims — the old directives still work, mapped onto the registry
const NAV_RE = /<<\s*go:\s*(\/[a-z0-9/_-]*)\s*>>/gi;
const REMEMBER_RE = /<<\s*remember:\s*([^>]+?)\s*>>/gi;

const GREETING =
  "Posso ajudar-te a configurar o career-ops, analisar as candidaturas e executar tarefas com o agente escolhido. Por onde queres começar?";

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
  const [availableClis, setAvailableClis] = useState<AssistantCli[]>([]);
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
  const router = useRouter();
  const pathname = usePathname();
  const scrollRef = useRef<HTMLDivElement>(null);

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

  // Detect installed CLIs here as well as in Config. A first-time user with
  // several installed CLIs must not land in a disabled assistant.
  useEffect(() => {
    function read() {
      setCliId(readSavedCliId());
    }
    async function detect() {
      try {
        const response = await fetch("/api/clis");
        if (!response.ok) return;
        const data = (await response.json()) as { clis?: AssistantCli[] };
        const list = (data.clis ?? []).filter((cli) => cli.installed);
        setAvailableClis(list);
        const saved = readSavedCliId();
        const next = keepIfInstalled(saved, list) ?? pickDefaultInstalled(list);
        if (next && next !== saved) persistCliId(next);
        setCliId(next);
      } catch {
        // Keep a saved choice usable when detection has a transient failure.
      }
    }
    read();
    void detect();
    window.addEventListener("storage", read);
    return () => window.removeEventListener("storage", read);
  }, []);

  function chooseCli(next: string) {
    if (!availableClis.some((cli) => cli.id === next)) return;
    persistCliId(next);
    setCliId(next);
  }

  async function chatRequest(url: string, init?: RequestInit) {
    const response = await fetch(url, init);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "O pedido da conversa falhou");
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
      const error = e instanceof Error ? e : new Error("Não foi possível guardar a conversa");
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
        setSaveError(e instanceof Error ? e.message : "A conversa não foi guardada");
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
      } catch (e) { if (!cancelled) setSaveError(e instanceof Error ? e.message : "Não foi possível carregar as conversas"); }
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
    } catch (e) { setSaveError(e instanceof Error ? e.message : "Não foi possível mudar de conversa"); }
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
    if (!window.confirm("Apagar as alterações por guardar e iniciar uma conversa nova? As conversas já guardadas permanecem no disco.")) return;
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
      setSaveError("");
    } finally { setChatPending(false); }
  }
  async function renameChat() {
    const title = window.prompt("Nome da conversa", activeChat.current.title || "");
    if (!title?.trim()) return;
    setChatPending(true);
    try { await flushChat(title.trim()); } catch { /* shown by flushChat */ }
    finally { setChatPending(false); }
  }
  async function removeChat() {
    if (!window.confirm("Eliminar esta conversa?")) return;
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
      await refreshChats();
    } catch (e) { setSaveError(e instanceof Error ? e.message : "Não foi possível eliminar a conversa"); }
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
      writeStatus: (n, status) => {
        fetch("/api/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ n, status }),
        })
          .then(() => {
            router.refresh();
            pipelineRef.current.refetch();
          })
          .catch(() => {});
      },
      setApplyField: (idOrLabel, value) => applyRef.current.setAnswer(idOrLabel, value),
      startApply: (u) => {
        router.push("/apply");
        setTimeout(() => applyRef.current.open(u), 60);
      },
      applyExplore: (patch, opts) => exploreRef.current.applyPatch(patch, opts),
      writeProfile: (patch) => {
        fetch("/api/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) })
          .then(() => router.refresh())
          .catch(() => {});
      },
      writePortals: async (roles, location) => {
        try {
          const response = await fetch("/api/portals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roles, location }) });
          if (response.ok) return;
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error || `erro ${response.status}`);
        } catch (error) {
          appendParts([{ type: "note", text: `Não foi possível guardar a pesquisa: ${error instanceof Error ? error.message : "erro de ligação"}.` }]);
          throw error;
        }
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
      confirmRuns.current.set(cid, res.run);
      appendParts([{ type: "confirm", cid, summary: res.summary, state: "pending" }]);
    }
  }

  function resolveConfirm(cid: string, accept: boolean) {
    const run = confirmRuns.current.get(cid);
    confirmRuns.current.delete(cid);
    const info = accept && run ? run() : null;
    setMessages((ms) =>
      ms.map((m) => {
        if (!m.parts.some((p) => p.type === "confirm" && p.cid === cid)) return m;
        const parts: Part[] = m.parts.map((p) =>
          p.type === "confirm" && p.cid === cid ? { ...p, state: accept ? "done" : "cancelled" } : p,
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
    handledRef.current = new Set();
    const shimsDone = new Set<string>();
    try {
      await flushChat();
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, cliId, history, pageContext: describePage(pathname) + pipelineContext() + applyContext() }),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}));
        setStreamText(`⚠️ ${err.error || "O assistente não está disponível."}`);
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });

        const { complete, hidePartialFrom } = parseEnvelopes(acc);
        const cuts: [number, number][] = complete.map((e) => [e.start, e.end]);
        if (hidePartialFrom >= 0) cuts.push([hidePartialFrom, acc.length]);
        let display = removeRanges(acc, cuts);

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
          runDispatch(e.id, args);
        }
        for (const p of shimNavs) {
          const k = `go:${p}`;
          if (!shimsDone.has(k)) {
            shimsDone.add(k);
            runDispatch("navigate", { path: p });
          }
        }
        for (const f of shimRems) {
          const k = `rem:${f}`;
          if (f && !shimsDone.has(k)) {
            shimsDone.add(k);
            runDispatch("remember", { fact: f });
          }
        }
      }
      if (!acc.trim()) setStreamText("_(sem resposta; confirma se a sessão do agente está iniciada)_");
    } catch {
      setStreamText("⚠️ Erro de ligação.");
    } finally {
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
      setOpen(true);
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
      chips.push({ label: "Explicar a pontuação", send: "Explica a pontuação desta oferta, incluindo pontos fortes e sinais de risco." });
      chips.push({ label: "Vale a pena candidatar-me?", send: "Tendo em conta o meu perfil, devo candidatar-me a esta oferta? Responde com franqueza." });
      chips.push({ label: "Preparar carta de apresentação", send: "Prepara uma carta de apresentação curta e concreta para esta função." });
      return chips;
    }
    const pending = pipeline.inbox.filter((j) => !j.done);
    if (!pipeline.applications.length && !pending.length) {
      return [
        { label: "Concluir a configuração", send: "Ajuda-me a concluir a configuração do career-ops. De que informação precisas?" },
        { label: "Melhorar o CV", send: "Analisa o meu CV e sugere as alterações com maior utilidade." },
      ];
    }
    if (pending.length) {
      const counts = new Map<string, number>();
      for (const j of pending) counts.set(j.company, (counts.get(j.company) ?? 0) + 1);
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      if (top && top[1] > 1) chips.push({ label: `Avaliar ofertas da ${top[0]} (${top[1]})`, send: `Avalia todas as ofertas pendentes da ${top[0]}.` });
      chips.push({ label: `Ordenar pendentes (${pending.length})`, send: `Tenho ${pending.length} ofertas pendentes. Quais devo avaliar primeiro e porquê?` });
    }
    const strong = pipeline.applications.filter((a) => scoreNum(a.score) >= 4.5).length;
    if (strong) chips.push({ label: "Melhores correspondências", send: "Mostra as ofertas com 4,5 ou mais às quais ainda não me candidatei e diz quais devo priorizar." });
    chips.push({ label: "Prioridades de hoje", send: "Analisa as minhas candidaturas e diz o que devo fazer hoje, por ordem de prioridade." });
    return chips.slice(0, 4);
  }, [pathname, pipeline.inbox, pipeline.applications]);

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-50 flex items-center justify-center gap-2 rounded-full border border-border bg-surface/90 py-1.5 pl-1.5 pr-4 shadow-lg backdrop-blur transition-colors hover:bg-surface-hover max-sm:size-11 max-sm:p-0"
          aria-label="Abrir assistente"
        >
          <CoMark size={26} />
          <span className="hidden text-sm font-medium sm:inline">Assistente</span>
        </button>
      )}

      {open && (
        <div className={cn("fixed z-50 flex flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl", PANEL_CLASS[size])}>
          <header className="flex items-center gap-2.5 border-b border-border px-4 py-3">
            <CoMark size={26} />
            <div className="flex-1">
              <div className="text-sm font-semibold tracking-tight">Assistente</div>
              {availableClis.length ? (
                <select
                  aria-label="Agente de IA"
                  value={cliId ?? ""}
                  onChange={(event) => chooseCli(event.target.value)}
                  disabled={busy}
                  className="max-w-44 bg-transparent text-xs text-faint outline-none"
                >
                  {availableClis.map((cli) => <option key={cli.id} value={cli.id}>{cli.name}</option>)}
                </select>
              ) : (
                <div className="text-xs text-faint">Sem agente configurado</div>
              )}
            </div>
            <Button variant="ghost" size="icon" onClick={cycleSize} className="text-muted" aria-label={SIZE_LABEL[size]} title={SIZE_LABEL[size]}>
              {size === "full" ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={() => void selectChat()} disabled={busy || chatPending || !chatReady} className="text-muted" aria-label="Nova conversa" title="Nova conversa">
              <RotateCcw className="size-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setOpen(false)} className="text-muted" aria-label="Fechar assistente">
              <X className="size-4" />
            </Button>
          </header>

          <div className="flex gap-2 border-b border-border px-4 py-2">
            <select aria-label="Histórico de conversas" className="min-w-0 flex-1 bg-surface text-sm" value={chats.some(c => c.id === activeChat.current.id) ? activeChat.current.id : ""} disabled={busy || chatPending || !chatReady} onChange={e => void selectChat(e.target.value || undefined)}>
              <option value="">Nova conversa</option>
              {chats.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
            <button className="text-xs text-muted disabled:opacity-40" disabled={busy || chatPending || !activeChat.current.revision} onClick={() => void renameChat()}>Mudar nome</button>
            <button className="text-xs text-muted disabled:opacity-40" disabled={busy || chatPending || !activeChat.current.revision} onClick={() => void removeChat()}>Eliminar</button>
          </div>
          {chatWarnings.map(warning => <div key={warning.id} role="alert" className="px-4 py-2 text-sm text-amber-600">{warning.error}. As restantes conversas continuam disponíveis.</div>)}
          {saveError && <div role="alert" className="space-y-2 px-4 py-2 text-sm text-amber-600">
            <p>{saveError}</p>
            {chatReady ? <div className="flex flex-wrap gap-3">
              <button className="underline" disabled={busy || chatPending} onClick={() => void flushChat().catch(() => {})}>Tentar guardar novamente</button>
              <button className="underline" disabled={busy || chatPending} onClick={exportChat}>Exportar conversa</button>
              <button className="underline" disabled={busy || chatPending} onClick={() => void discardAndStartChat()}>Apagar alterações e iniciar nova conversa</button>
            </div> : <button className="underline" onClick={() => window.location.reload()}>Recarregar</button>}
          </div>}
          <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {messages.map((m, i) => {
              const hasVisible = m.parts.some((p) => (p.type === "text" && p.text.trim()) || p.type !== "text");
              const isLast = i === messages.length - 1;
              return (
                <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
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
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-surface/60 px-2.5 py-1 text-xs text-muted transition-colors hover:border-brand/40 hover:bg-brand-soft hover:text-brand"
                >
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
              <Settings className="size-3.5" /> Escolhe um agente em Configuração para usar o assistente
            </Link>
          )}

          <div className="border-t border-border p-3">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder={cliId ? "Escreve uma mensagem…" : "Escolhe primeiro um agente"}
                rows={1}
                disabled={!cliId}
                style={{ maxHeight: INPUT_MAX_PX[size] }}
                className="flex-1 resize-none rounded-xl border border-border bg-surface/60 px-3 py-2 text-sm outline-none transition-colors placeholder:text-faint focus:border-brand/50 disabled:opacity-50"
              />
              <button
                onClick={() => send()}
                disabled={busy || chatPending || !chatReady || !input.trim() || !cliId}
                className="rounded-xl bg-brand p-2 text-brand-foreground transition-colors hover:bg-brand-200 disabled:opacity-40"
                aria-label="Enviar"
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              </button>
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
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown>
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
          A tarefa já terminou — abrir registo
        </Link>
      );
    return (
      <WorkerCard
        job={job}
        variant="inline"
        trailing={
          <Link href={`/jobs/${job.id}`} className="text-faint transition-colors hover:text-brand" aria-label="Abrir tarefa">
            <ArrowUpRight className="size-3.5" />
          </Link>
        }
      />
    );
  }
  if (part.type === "batch") {
    const children = part.jobIds.map((id) => jobs.find((j) => j.id === id)).filter(Boolean);
    const done = children.filter((j) => j!.status === "done").length;
    return (
      <div className="rounded-xl border border-border bg-surface/40 p-2.5">
        <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium">
          {part.jobIds.length} avaliações
          <span className="ml-auto tabular-nums text-faint">
            {done}/{part.jobIds.length} concluídas
          </span>
        </div>
        <div className="space-y-1.5">
          {children.map((j) => (
            <WorkerCard
              key={j!.id}
              job={j!}
              variant="inline"
              trailing={
                <Link href={`/jobs/${j!.id}`} className="text-faint transition-colors hover:text-brand" aria-label="Abrir tarefa">
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
    return (
      <div className="rounded-xl border border-brand/40 bg-brand-soft p-2.5">
        <div className="text-xs font-medium text-foreground">{part.summary}</div>
        {part.state === "pending" ? (
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => onConfirm(part.cid, true)}
              className="rounded-full bg-brand px-3 py-1 text-xs font-medium text-brand-foreground transition-colors hover:bg-brand-200"
            >
              Confirmar
            </button>
            <button
              onClick={() => onConfirm(part.cid, false)}
              className="rounded-full border border-border px-3 py-1 text-xs text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
            >
              Cancelar
            </button>
          </div>
        ) : (
          <div className="mt-1 text-xs text-faint">{part.state === "done" ? "✓ confirmado" : "cancelada"}</div>
        )}
      </div>
    );
  }
  return null;
}
