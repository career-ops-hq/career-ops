"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import {
  Inbox,
  CheckCircle2,
  Clock,
  Plus,
  Trash2,
  Sparkles,
  ArrowRight,
  RefreshCw,
  Copy,
  Check,
  Search,
  ExternalLink,
  Zap,
  Terminal,
  FileCheck,
  Layers,
  ChevronRight,
  ShieldCheck,
  AlertCircle,
} from "lucide-react";

type InboxItem = {
  id: number;
  done: boolean;
  timestamp: string;
  request: string;
  result?: string;
  raw: string;
};

const PRESET_PROMPTS = [
  { label: "Evaluate JD", prefix: "evaluate " },
  { label: "Tailor CV", prefix: "apply " },
  { label: "Scan ATS Portals", prefix: "scan" },
  { label: "Follow-up Draft", prefix: "draft follow-up for " },
  { label: "Interview Prep", prefix: "prep STAR stories for " },
];

export default function InboxPage() {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "pending" | "done">("all");
  const [search, setSearch] = useState("");
  const [newRequest, setNewRequest] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [copiedId, setCopiedId] = useState<number | string | null>(null);
  const [resolvingId, setResolvingId] = useState<number | null>(null);
  const [resultNote, setResultNote] = useState("");

  const fetchInbox = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/inbox");
      const data = await res.json();
      setItems(data.items || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInbox();
  }, []);

  const pendingItems = useMemo(() => items.filter((i) => !i.done), [items]);
  const resolvedItems = useMemo(() => items.filter((i) => i.done), [items]);

  const filteredItems = useMemo(() => {
    let list = items;
    if (filter === "pending") list = pendingItems;
    if (filter === "done") list = resolvedItems;

    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter(
      (i) =>
        i.request.toLowerCase().includes(q) ||
        (i.result && i.result.toLowerCase().includes(q)) ||
        i.timestamp.toLowerCase().includes(q)
    );
  }, [items, filter, pendingItems, resolvedItems, search]);

  const handleAddTask = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newRequest.trim() || submitting) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add", request: newRequest.trim() }),
      });
      const data = await res.json();
      if (data.ok) {
        setItems(data.items || []);
        setNewRequest("");
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleDone = async (item: InboxItem) => {
    try {
      const res = await fetch("/api/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "toggle", id: item.id, done: !item.done }),
      });
      const data = await res.json();
      if (data.ok) setItems(data.items || []);
    } catch (e) {
      console.error(e);
    }
  };

  const handleConfirmResolve = async (id: number) => {
    try {
      const res = await fetch("/api/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resolve", id, done: true, result: resultNote.trim() }),
      });
      const data = await res.json();
      if (data.ok) {
        setItems(data.items || []);
        setResolvingId(null);
        setResultNote("");
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteItem = async (id: number) => {
    try {
      const res = await fetch("/api/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", id }),
      });
      const data = await res.json();
      if (data.ok) setItems(data.items || []);
    } catch (e) {
      console.error(e);
    }
  };

  const handleClearResolved = async () => {
    if (!confirm("Clear all resolved items from your Agent Inbox?")) return;
    try {
      const res = await fetch("/api/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear-resolved" }),
      });
      const data = await res.json();
      if (data.ok) setItems(data.items || []);
    } catch (e) {
      console.error(e);
    }
  };

  const copyText = (text: string, id: number | string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-8 animate-in fade-in duration-200 text-foreground">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center size-9 rounded-xl bg-brand/10 border border-brand/20 text-brand">
              <Inbox className="size-5" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
                Agent Inbox
              </h1>
              <p className="text-xs text-muted mt-0.5">
                Durable request queue drained by your AI Coding CLI at session startup (<code className="text-[11px] font-mono text-foreground bg-surface px-1 py-0.5 rounded">data/agent-inbox.md</code>).
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={fetchInbox}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-surface text-xs font-medium text-foreground hover:bg-surface-hover transition shadow-sm"
          >
            <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          {resolvedItems.length > 0 && (
            <button
              type="button"
              onClick={handleClearResolved}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-surface text-xs font-medium text-muted hover:text-red-500 transition shadow-sm"
            >
              <Trash2 className="size-3.5" />
              Clear Resolved ({resolvedItems.length})
            </button>
          )}
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-5 backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 tracking-wider uppercase">
              Pending Queue
            </span>
            <Clock className="size-4 text-amber-500" />
          </div>
          <div className="mt-2 text-2xl font-black tracking-tight text-foreground">{pendingItems.length}</div>
          <div className="mt-2 text-[11px] text-muted">Awaiting execution in your next AI session</div>
        </div>

        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-5 backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 tracking-wider uppercase">
              Resolved Tasks
            </span>
            <CheckCircle2 className="size-4 text-emerald-500" />
          </div>
          <div className="mt-2 text-2xl font-black tracking-tight text-foreground">{resolvedItems.length}</div>
          <div className="mt-2 text-[11px] text-muted">Completed and annotated with results</div>
        </div>

        <div className="rounded-2xl border border-brand/20 bg-brand-soft/10 p-5 backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-brand tracking-wider uppercase">Total In Queue</span>
            <Layers className="size-4 text-brand" />
          </div>
          <div className="mt-2 text-2xl font-black tracking-tight text-foreground">{items.length}</div>
          <div className="mt-2 text-[11px] text-muted">
            CLI drain: <code className="font-mono text-[10px] text-foreground bg-surface px-1 py-0.5 rounded">node agent-inbox.mjs list</code>
          </div>
        </div>
      </div>

      {/* Task Input Box */}
      <div className="rounded-2xl border border-border bg-surface p-5 space-y-3 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
            <Plus className="size-4 text-brand" /> Queue a new task for your AI Agent
          </span>
          <span className="text-[11px] text-muted">Press Enter to queue</span>
        </div>

        <form onSubmit={handleAddTask} className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={newRequest}
            onChange={(e) => setNewRequest(e.target.value)}
            placeholder="e.g. evaluate https://greenhouse.io/acme/jobs/1234 or draft follow-up for #4"
            className="flex-1 rounded-xl border border-border bg-surface-hover/30 px-3.5 py-2 text-xs text-foreground placeholder:text-muted focus:border-brand focus:outline-none"
          />
          <button
            type="submit"
            disabled={!newRequest.trim() || submitting}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-brand text-white text-xs font-semibold hover:brightness-110 disabled:opacity-50 transition shadow-sm whitespace-nowrap"
          >
            <Plus className="size-3.5" />
            {submitting ? "Queueing..." : "Queue Task"}
          </button>
        </form>

        {/* Quick Presets */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="text-[11px] text-faint mr-1">Presets:</span>
          {PRESET_PROMPTS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => setNewRequest(p.prefix)}
              className="text-[11px] px-2 py-0.5 rounded-md border border-border bg-surface-hover/40 text-muted hover:text-foreground hover:border-brand/40 transition"
            >
              + {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Protocol Banner */}
      <div className="rounded-2xl border border-brand/20 bg-brand-soft/10 p-4 flex items-start gap-3 text-xs leading-relaxed text-muted">
        <ShieldCheck className="size-4 text-brand shrink-0 mt-0.5" />
        <div>
          <strong className="text-foreground font-semibold">How Agent Inbox works:</strong> Whenever you launch your AI CLI (Claude Code, Antigravity CLI, Codex, OpenCode), it automatically reads <code className="font-mono text-[10px] text-foreground bg-surface px-1 py-0.5 rounded">data/agent-inbox.md</code> and runs each pending unchecked item sequentially. Nothing auto-submits without your confirmation.
        </div>
      </div>

      {/* Task List Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 p-1 bg-surface rounded-xl border border-border w-fit text-xs font-medium">
          <button
            type="button"
            onClick={() => setFilter("all")}
            className={`px-3 py-1.5 rounded-lg transition-all ${
              filter === "all" ? "bg-brand text-white shadow-sm font-semibold" : "text-muted hover:text-foreground"
            }`}
          >
            All ({items.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter("pending")}
            className={`px-3 py-1.5 rounded-lg transition-all ${
              filter === "pending" ? "bg-brand text-white shadow-sm font-semibold" : "text-muted hover:text-foreground"
            }`}
          >
            Pending ({pendingItems.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter("done")}
            className={`px-3 py-1.5 rounded-lg transition-all ${
              filter === "done" ? "bg-brand text-white shadow-sm font-semibold" : "text-muted hover:text-foreground"
            }`}
          >
            Completed ({resolvedItems.length})
          </button>
        </div>

        <div className="relative">
          <Search className="size-3.5 absolute left-3 top-2.5 text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search queued tasks..."
            className="pl-8 pr-3 py-1.5 rounded-lg border border-border bg-surface text-xs text-foreground focus:border-brand focus:outline-none w-full sm:w-60"
          />
        </div>
      </div>

      {/* Task Items */}
      {filteredItems.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface/40 p-10 text-center space-y-3">
          <div className="flex items-center justify-center size-12 rounded-full bg-surface border border-border mx-auto text-muted">
            <Inbox className="size-6" />
          </div>
          <div className="text-sm font-semibold text-foreground">
            {filter === "pending"
              ? "All caught up! No pending tasks in queue."
              : filter === "done"
              ? "No resolved tasks yet."
              : "Agent Inbox is currently empty."}
          </div>
          <p className="text-xs text-muted max-w-sm mx-auto">
            Use the input above to queue URLs to evaluate, interview prep prompts, or follow-up drafting tasks.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredItems.map((item) => (
            <div
              key={item.id}
              className={`rounded-2xl border p-4 sm:p-5 transition-all space-y-3 ${
                item.done
                  ? "border-border/60 bg-surface/50 opacity-80"
                  : "border-border bg-surface hover:border-brand/40 shadow-sm"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 flex-1">
                  <button
                    type="button"
                    onClick={() => handleToggleDone(item)}
                    aria-label={`Mark "${item.request}" as ${item.done ? "pending" : "resolved"}`}
                    className={`mt-0.5 flex items-center justify-center size-5 rounded-md border transition-all ${
                      item.done
                        ? "bg-emerald-500 border-emerald-600 text-white"
                        : "border-border bg-surface hover:border-brand"
                    }`}
                  >
                    {item.done && <Check className="size-3.5" />}
                  </button>

                  <div className="space-y-1.5 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {item.timestamp && (
                        <span className="text-[10px] font-mono text-muted bg-surface-hover px-1.5 py-0.5 rounded">
                          {item.timestamp}
                        </span>
                      )}
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          item.done
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                            : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                        }`}
                      >
                        {item.done ? "Resolved" : "Pending"}
                      </span>
                    </div>

                    <div
                      className={`text-xs sm:text-sm font-medium leading-relaxed ${
                        item.done ? "line-through text-muted" : "text-foreground"
                      }`}
                    >
                      {item.request}
                    </div>

                    {item.result && (
                      <div className="text-xs bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 p-2.5 rounded-xl flex items-start gap-2">
                        <CheckCircle2 className="size-3.5 shrink-0 mt-0.5 text-emerald-500" />
                        <div>
                          <strong className="font-semibold">Result: </strong>
                          <span>{item.result}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  {!item.done && (
                    <button
                      type="button"
                      onClick={() => {
                        if (resolvingId !== item.id) {
                          setResultNote("");
                          setResolvingId(item.id);
                        } else {
                          setResolvingId(null);
                        }
                      }}
                      className="text-xs px-2.5 py-1 rounded-lg border border-border bg-surface text-muted hover:text-foreground transition"
                      title="Annotate Result"
                    >
                      {resolvingId === item.id ? "Cancel" : "Add Result"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => copyText(item.request, item.id)}
                    className="p-1.5 rounded-lg text-muted hover:text-foreground hover:bg-surface-hover transition"
                    title="Copy request prompt"
                  >
                    {copiedId === item.id ? <Check className="size-3.5 text-brand" /> : <Copy className="size-3.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteItem(item.id)}
                    className="p-1.5 rounded-lg text-muted hover:text-red-500 hover:bg-surface-hover transition"
                    title="Delete item"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>

              {/* Inline Result Annotation Drawer */}
              {resolvingId === item.id && (
                <div className="pt-2 border-t border-border flex flex-col sm:flex-row gap-2 animate-in fade-in duration-100">
                  <input
                    type="text"
                    value={resultNote}
                    onChange={(e) => setResultNote(e.target.value)}
                    placeholder="e.g. Scored 4.2/5 · Report 042 created · Tailored CV generated"
                    className="flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-foreground focus:border-brand focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => handleConfirmResolve(item.id)}
                    className="px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-semibold hover:brightness-110 shadow-sm"
                  >
                    Mark Resolved
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
