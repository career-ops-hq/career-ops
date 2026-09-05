"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Clock, Edit3, Globe, Loader2, MoreVertical, Pause, Play, Trash2, Zap } from "lucide-react";
import type { ScheduledJob } from "@/lib/scheduled-jobs";
import { cn } from "@/lib/cn";
import { instrumentSerif } from "@/lib/fonts";

export function JobCard({
  job,
  onToggleStatus,
  onEdit,
  onDelete,
  onRunFinished,
}: {
  job: ScheduledJob;
  onToggleStatus: (id: string, currentStatus: string) => void;
  onEdit: (job: ScheduledJob) => void;
  onDelete: (id: string) => void;
  onRunFinished: () => void;
}) {
  const [running, setRunning] = useState(false);
  const [runMessage, setRunMessage] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    if (menuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEscape);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [menuOpen]);

  const handleRunNow = async () => {
    setRunning(true);
    setRunMessage(null);

    try {
      const res = await fetch(`/api/scheduled-jobs/${job.id}/run`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Run failed");

      setRunMessage(` Completed! Found ${data.rolesFound || 0} matching roles.`);
      onRunFinished();
    } catch (err) {
      setRunMessage(` Error: ${err instanceof Error ? err.message : "Run failed"}`);
    } finally {
      setRunning(false);
    }
  };

  const isFull = job.engine === "full";
  const isActive = job.status === "active";
  const positiveList = job.filters?.positive || [];
  const letter = (job.name || "S").trim().charAt(0).toUpperCase();

  return (
    <div className="co-rise group flex min-w-0 flex-col justify-between h-full gap-2.5 rounded-xl border border-border bg-surface/40 p-3.5 text-left transition-all hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-sm">
      <div className="space-y-2.5">
        {/* Top Header: Logo + Title + 3-Dots Menu */}
        <div className="flex items-start gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-soft text-sm font-semibold text-brand">
            {letter}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className={`${instrumentSerif.className} truncate text-[17px] leading-tight text-foreground transition-colors group-hover:text-brand`}>
              {job.name}
            </h3>
            <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-muted">
              <Clock className="size-3.5 text-faint" />
              Every {job.every} {job.unit} · {job.timezone}
            </p>
          </div>

          {/* 3-Dots Dropdown Menu */}
          <div className="relative shrink-0" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label={`Options for ${job.name}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="rounded p-1 text-faint transition-colors hover:bg-surface-hover hover:text-foreground"
              title="Options"
            >
              <MoreVertical className="size-4" />
            </button>

            {menuOpen && (
              <div role="menu" className="absolute right-0 top-full z-20 mt-1 w-36 overflow-hidden rounded-xl border border-border bg-surface shadow-xl backdrop-blur-md animate-in fade-in zoom-in-95">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onEdit(job);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-brand-soft hover:text-brand"
                >
                  <Edit3 className="size-3.5" /> Edit Scan
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onDelete(job.id);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-rose-500 transition-colors hover:bg-rose-500/10"
                >
                  <Trash2 className="size-3.5" /> Delete Scan
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Engine & Status Badges */}
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-medium",
              isFull ? "border-brand/30 bg-brand-soft/60 text-brand" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            )}
          >
            {isFull ? <Globe className="size-3" /> : <Zap className="size-3" />}
            {isFull ? "Full ATS Sweep" : "Zero-Token Portals"}
          </span>

          <span
            className={cn(
              "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-medium",
              isActive
                ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
                : "border-border bg-surface-hover text-muted"
            )}
          >
            <span className={cn("size-1.5 rounded-full", isActive ? "bg-emerald-500" : "bg-zinc-400")} />
            {job.status}
          </span>
        </div>

        {/* Keywords clamped to max 2 lines */}
        {positiveList.length > 0 && (
          <div className="max-h-12 overflow-hidden flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="text-faint shrink-0">matched:</span>
            {positiveList.map((kw, i) => (
              <span key={i} className="rounded border border-border px-1.5 py-0.5 font-medium text-muted truncate max-w-[140px]">
                {kw}
              </span>
            ))}
          </div>
        )}

        {/* Last Run & Status Message */}
        <div className="text-[12px]">
          {job.lastError ? (
            <p className="flex items-start gap-1.5 text-rose-500">
              <AlertCircle className="mt-0.5 size-3 shrink-0" />
              <span className="truncate">Last error: {job.lastError}</span>
            </p>
          ) : job.lastRunAt ? (
            <p className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-3.5 shrink-0" />
              Last run {new Date(job.lastRunAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} ·{" "}
              {job.rolesFoundCount || 0} roles found
            </p>
          ) : (
            <p className="text-faint">No runs recorded yet</p>
          )}
          {runMessage && <p className="mt-1 font-medium text-brand">{runMessage}</p>}
        </div>
      </div>

      {/* Action Buttons Row pinned to bottom */}
      <div className="mt-auto pt-2 flex items-center gap-2 border-t border-border/40">
        <button
          type="button"
          onClick={handleRunNow}
          disabled={running}
          className="inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-brand/30 px-2.5 py-2 text-xs font-medium text-brand transition-colors hover:bg-brand-soft disabled:opacity-50 max-sm:min-h-[44px]"
        >
          {running ? <Loader2 className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />}
          {running ? "Scanning…" : "Run now"}
        </button>

        <button
          type="button"
          onClick={() => onToggleStatus(job.id, job.status)}
          className={cn(
            "inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-2 text-xs font-medium transition-colors max-sm:min-h-[44px]",
            isActive ? "bg-surface-hover text-foreground hover:bg-brand-soft hover:text-brand" : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          )}
        >
          {isActive ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
          {isActive ? "Pause" : "Resume"}
        </button>
      </div>
    </div>
  );
}
