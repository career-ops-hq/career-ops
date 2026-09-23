"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Loader2 } from "lucide-react";
import type { Application } from "@/lib/career-ops";
import { demoteStatus, promoteStatus } from "@/lib/tracker-funnel";
import { Button } from "@/components/ui/button";

// Multi-select bulk promote/demote for tracker tabs (mirrors inbox triage bar).
export function TrackerBulkBar({
  rows,
  selected,
  onClear,
}: {
  rows: Application[];
  selected: Set<string>;
  onClear: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"" | "promote" | "demote">("");
  const [error, setError] = useState("");

  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.n)), [rows, selected]);

  const promotePreview = useMemo(() => {
    const targets = new Set(selectedRows.map((r) => promoteStatus(r.status)).filter(Boolean));
    return targets.size === 1 ? [...targets][0] : targets.size > 1 ? "mixed" : null;
  }, [selectedRows]);

  const demotePreview = useMemo(() => {
    const targets = new Set(selectedRows.map((r) => demoteStatus(r.status)).filter(Boolean));
    return targets.size === 1 ? [...targets][0] : targets.size > 1 ? "mixed" : null;
  }, [selectedRows]);

  const canPromote = selectedRows.some((r) => promoteStatus(r.status) != null);
  const canDemote = selectedRows.some((r) => demoteStatus(r.status) != null);

  async function run(action: "promote" | "demote") {
    setBusy(action);
    setError("");
    try {
      const res = await fetch("/api/status/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ids: [...selected] }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; failed?: number };
      if (!res.ok) throw new Error(data.error || "bulk update failed");
      if (data.failed && data.failed > 0) setError(`${data.failed} row(s) could not be updated`);
      onClear();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "bulk update failed");
    } finally {
      setBusy("");
    }
  }

  if (selected.size === 0) return null;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-brand/30 bg-brand-soft px-3 py-2 text-sm">
      <span className="font-medium text-brand tabular-nums">{selected.size} selected</span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={!!busy || !canPromote}
        onClick={() => run("promote")}
        title={promotePreview === "mixed" ? "Each row advances one stage" : promotePreview ? `→ ${promotePreview}` : "Cannot promote"}
      >
        {busy === "promote" ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowUp className="size-3.5" />}
        Promote{promotePreview && promotePreview !== "mixed" ? ` → ${promotePreview}` : ""}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={!!busy || !canDemote}
        onClick={() => run("demote")}
        title={demotePreview === "mixed" ? "Each row steps back one stage" : demotePreview ? `→ ${demotePreview}` : "Cannot demote"}
      >
        {busy === "demote" ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowDown className="size-3.5" />}
        Demote{demotePreview && demotePreview !== "mixed" ? ` → ${demotePreview}` : ""}
      </Button>
      <button type="button" onClick={onClear} disabled={!!busy} className="text-xs text-muted hover:text-foreground max-sm:min-h-[44px]">
        Clear
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}
