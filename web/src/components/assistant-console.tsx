"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Send, X, Loader2, Settings, RotateCcw, ArrowUpRight, Sparkles } from "lucide-react";
import { CoMark } from "@/components/co-mark";
import { useJobs } from "@/components/jobs/job-store";
import { usePipeline } from "@/components/pipeline/pipeline-provider";
import { useApply } from "@/components/apply/apply-provider";
import { useExplore } from "@/components/explore/explore-provider";
import { WorkerCard } from "@/components/jobs/worker-card";
import { Button } from "@/components/ui/button";
import { dispatch, type ActionCtx, type DoneInfo } from "@/app/actions/registry";
import { scoreNum } from "@/lib/format";
import { cn } from "@/lib/cn";

// ── message model: messages are PART arrays so a live worker card can render
// inline next to text, both fed by the single JobsProvider store ──────────────
type Part =
  | { type: "text"; text: string }
  | { type: "note"; text: string }
  | { type: "card"; jobId: string }
  | { type: "batch"; batchId: string; jobIds: string[] }
  | { type: "confirm"; cid: string; summary: string; state: "pending" | "done" | "cancelled" };
type Msg = { role: "user" | "assistant"; parts: Part[] };

const CONFIG_KEY = "career-ops:config";
const CHAT_KEY = "career-ops:chat";
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
  if (p === "/analytics") return "Analytics — funnel, score distribution, top companies.";
  if (p === "/cv") return "CV editor (cv.md).";
  if (p === "/config") return "Config — CLI / engine setup.";
  if (p === "/apply") return "Apply — the form-proxy: the user is reviewing a job application re-rendered in plain language, pre-filled from their CV. You can write/revise answers via setApplyField.";
  if (p.startsWith("/jobs/")) return "Watching a running worker / evaluation in progress.";
  return `Route ${p}.`;
}

// ── persistence migration: old {role,content:string} → parts[] ────────────────
function migrate(raw: unknown): Msg[] | null {
  if (!Array.isArray(raw)) return null;
  return raw
    .map((m): Msg | null => {
      if (!m || typeof m !== "object") return null;
      const role = (m as { role?: string }).role === "user" ? "user" : "assistant";
      if (Array.isArray((m as { parts?: unknown }).parts)) {
        // keep only serializable parts (drop transient pending confirms)
        const parts = ((m as { parts: Part[] }).parts).filter(
          (p) => p.type !== "confirm" || p.state !== "pending",
        );
        return { role, parts };
      }
      const content = (m as { content?: string }).content;
      return { role, parts: [{ type: "text", text: typeof content === "string" ? content : "" }] };
    })
    .filter((x): x is Msg => !!x);
}
function msgText(m: Msg): string {
  return m.parts.filter((p): p is Extract<Part, { type: "text" }> => p.type === "text").map((p) => p.text).join(" ").trim();
}

export function AssistantConsole() {
  const [open, setOpen] = useState(false);
  const [cliId, setCliId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
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

  // selected CLI from Config (reacts to changes in other tabs)
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
    window.addEventListener("storage", read);
    return () => window.removeEventListener("storage", read);
  }, []);

  // restore + persist conversation
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CHAT_KEY);
      const m = raw ? migrate(JSON.parse(raw)) : null;
      if (m && m.length) setMessages(m);
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    if (!messages.length) return;
    try {
      const serializable = messages
        .slice(-30)
        .map((m) => ({ role: m.role, parts: m.parts.filter((p) => p.type !== "confirm" || p.state !== "pending") }));
      localStorage.setItem(CHAT_KEY, JSON.stringify(serializable));
    } catch {
      /* ignore */
    }
  }, [messages]);

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
      writePortals: (roles, location) => {
        fetch("/api/portals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roles, location }) }).catch(() => {});
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
    if (!text || busy || !cliId) return;
    if (forced === undefined) setInput("");
    const history = messages.filter((m) => msgText(m) && msgText(m) !== GREETING).map((m) => ({ role: m.role, content: msgText(m) }));
    setMessages((m) => [...m, { role: "user", parts: [{ type: "text", text }] }, { role: "assistant", parts: [{ type: "text", text: "" }] }]);
    setBusy(true);
    handledRef.current = new Set();
    const shimsDone = new Set<string>();
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, cliId, history, pageContext: describePage(pathname) + pipelineContext() + applyContext() }),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}));
        setStreamText(`⚠️ ${err.error || "Assistant unavailable."}`);
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
      if (!acc.trim()) setStreamText("_(no output — is the CLI authenticated?)_");
    } catch {
      setStreamText("⚠️ Connection error.");
    } finally {
      setBusy(false);
      router.refresh();
      pipelineRef.current.refetch();
    }
  }

  function resetChat() {
    setMessages([{ role: "assistant", parts: [{ type: "text", text: GREETING }] }]);
    confirmRuns.current.clear();
    try {
      localStorage.removeItem(CHAT_KEY);
    } catch {
      /* ignore */
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
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-50 flex items-center justify-center gap-2 rounded-full border border-border bg-surface/90 py-1.5 pl-1.5 pr-4 shadow-lg backdrop-blur transition-colors hover:bg-surface-hover max-sm:min-h-[44px]"
          aria-label="Open assistant"
        >
          <CoMark size={26} />
          <span className="text-sm font-medium">Ask</span>
        </button>
      )}

      {open && (
        <div className="fixed bottom-5 right-5 z-50 flex h-[600px] max-h-[80vh] w-[400px] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
          <header className="flex items-center gap-2.5 border-b border-border px-4 py-3">
            <CoMark size={26} />
            <div className="flex-1">
              <div className="text-sm font-semibold tracking-tight">Assistant</div>
              <div className="text-xs text-faint">{cliId ? `via ${cliId}` : "no CLI configured"}</div>
            </div>
            <Button variant="ghost" size="icon" onClick={resetChat} className="text-muted" aria-label="New chat" title="New chat">
              <RotateCcw className="size-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setOpen(false)} className="text-muted" aria-label="Close assistant">
              <X className="size-4" />
            </Button>
          </header>

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
                  <Sparkles className="size-3 text-brand/70" />
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
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder={cliId ? "Ask anything…" : "Configure a CLI first"}
                rows={1}
                disabled={!cliId}
                className="max-h-32 flex-1 resize-none rounded-xl border border-border bg-surface/60 px-3 py-2 text-sm outline-none transition-colors placeholder:text-faint focus:border-brand/50 disabled:opacity-50"
              />
              <button
                onClick={() => send()}
                disabled={busy || !input.trim() || !cliId}
                className="rounded-xl bg-brand p-2 text-brand-foreground transition-colors hover:bg-brand-200 disabled:opacity-40"
                aria-label="Send"
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
          Worker finished earlier — open log →
        </Link>
      );
    return (
      <WorkerCard
        job={job}
        variant="inline"
        trailing={
          <Link href={`/jobs/${job.id}`} className="text-faint transition-colors hover:text-brand" aria-label="Open worker">
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
          <Sparkles className="size-3.5 text-brand" />
          {part.jobIds.length} evaluations
          <span className="ml-auto tabular-nums text-faint">
            {done}/{part.jobIds.length} done
          </span>
        </div>
        <div className="space-y-1.5">
          {children.map((j) => (
            <WorkerCard
              key={j!.id}
              job={j!}
              variant="inline"
              trailing={
                <Link href={`/jobs/${j!.id}`} className="text-faint transition-colors hover:text-brand" aria-label="Open worker">
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
              Confirm
            </button>
            <button
              onClick={() => onConfirm(part.cid, false)}
              className="rounded-full border border-border px-3 py-1 text-xs text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="mt-1 text-xs text-faint">{part.state === "done" ? "✓ started" : "cancelled"}</div>
        )}
      </div>
    );
  }
  return null;
}
