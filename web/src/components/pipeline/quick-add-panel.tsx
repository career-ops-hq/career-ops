"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Link2, Loader2, Plus, Sparkles } from "lucide-react";
import { useJobs } from "@/components/jobs/job-store";
import { CostBadge } from "@/components/cost/cost-badge";

const CONFIG_KEY = "career-ops:config";

function readCliId(): string | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? JSON.parse(raw).cliId || null : null;
  } catch {
    return null;
  }
}

// The web-UI twin of career-ops' oldest CLI precedent: "paste a job URL or JD
// text to trigger auto-pipeline" (data/pipeline.md's own header, the README's
// Auto-Pipeline feature). A pasted URL goes straight to the free add-to-pipeline
// writer (or the same evaluate worker the assistant chat already uses); pasted
// JD TEXT is saved to jds/{file}.md first (modes/pipeline.md's local: convention)
// via /api/pipeline/quick-add, then referenced the same way everywhere else.
export function QuickAddPanel() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"add" | "evaluate" | null>(null);
  const [note, setNote] = useState("");
  const router = useRouter();
  const { startJob } = useJobs();

  const trimmed = text.trim();
  const isUrl = /^https?:\/\//i.test(trimmed);

  async function quickAddLocalRef(): Promise<string | null> {
    const res = await fetch("/api/pipeline/quick-add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: trimmed }),
    });
    const d = await res.json().catch(() => ({}) as { localRef?: string; error?: string });
    return typeof d.localRef === "string" ? d.localRef : null;
  }

  function afterAdd(added: number) {
    setText("");
    setNote(added > 0 ? "Added to pipeline." : "Couldn't add it — check the URL/text.");
    router.refresh();
    window.dispatchEvent(new CustomEvent("co-job-done", { detail: { kind: "quick-add" } }));
    setTimeout(() => setNote(""), 3500);
  }

  async function handleAdd() {
    if (!trimmed || busy) return;
    setBusy("add");
    try {
      if (isUrl) {
        const res = await fetch("/api/explore/add", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            offers: [{ url: trimmed, company: "", title: "", location: "", postedAt: "", ats: "manual", source: "manual-paste" }],
          }),
        });
        const d = await res.json().catch(() => ({}) as { added?: number });
        afterAdd(d.added ?? 0);
      } else {
        const res = await fetch("/api/pipeline/quick-add", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: trimmed }),
        });
        const d = await res.json().catch(() => ({}) as { added?: number });
        afterAdd(d.added ?? 0);
      }
    } finally {
      setBusy(null);
    }
  }

  async function handleEvaluate() {
    if (!trimmed || busy) return;
    const cliId = readCliId();
    if (!cliId) {
      setNote("Connect an AI CLI in Config to evaluate.");
      return;
    }
    setBusy("evaluate");
    try {
      const input = isUrl ? trimmed : await quickAddLocalRef();
      if (!input) {
        setNote("Couldn't save the pasted JD.");
        return;
      }
      startJob({ title: "Evaluate", subtitle: isUrl ? trimmed : "pasted JD", kind: "evaluate", input, page: "/pipeline" });
      setText("");
      setNote("Evaluating — watch the worker card below.");
      router.refresh();
      setTimeout(() => setNote(""), 4000);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-5 rounded-2xl border border-border bg-surface/30 p-4">
      <div className="mb-2 flex items-center gap-2 text-[12px] font-medium text-brand">
        <Link2 className="size-3.5" /> Paste a job URL or JD to add it
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder="https://company.com/jobs/123 — or paste the full JD text"
        className="w-full resize-none rounded-xl border border-border bg-surface/60 p-3 text-sm outline-none transition-colors placeholder:text-faint focus:border-brand/50"
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12px] text-faint">
          {note || (trimmed ? (isUrl ? "Looks like a URL." : "Will be saved as a JD file.") : "")}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!trimmed || !!busy}
            onClick={handleAdd}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface/60 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-brand-soft hover:text-brand disabled:opacity-50"
          >
            {busy === "add" ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            Add to pipeline
          </button>
          <button
            type="button"
            disabled={!trimmed || !!busy}
            onClick={handleEvaluate}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground transition hover:brightness-110 disabled:opacity-50"
          >
            {busy === "evaluate" ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            Evaluate now
            <CostBadge kind="spend" size="xs" />
          </button>
        </div>
      </div>
    </div>
  );
}
