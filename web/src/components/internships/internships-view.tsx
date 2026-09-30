"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, GraduationCap, ExternalLink, Trash2, FileText, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { AddInternshipModal } from "./add-internship-modal";
import { ResumeViewer } from "./resume-viewer";

type Internship = {
  id: string;
  company: string;
  role: string;
  location: string;
  status: "wishlist" | "applied" | "interviewing" | "offered" | "rejected" | "accepted";
  dateAdded: string;
  dateApplied?: string;
  deadline?: string;
  url?: string;
  notes: string;
  resumeFile?: string;
  score?: string;
};

const STATUSES = ["wishlist", "applied", "interviewing", "offered", "rejected", "accepted"] as const;

const STATUS_CONFIG: Record<
  Internship["status"],
  { label: string; tone: "muted" | "info" | "warn" | "good" | "bad"; dot: string }
> = {
  wishlist: { label: "Wishlist", tone: "muted", dot: "bg-zinc-400" },
  applied: { label: "Applied", tone: "info", dot: "bg-sky-400" },
  interviewing: { label: "Interviewing", tone: "warn", dot: "bg-amber-400" },
  offered: { label: "Offered", tone: "good", dot: "bg-emerald-400" },
  rejected: { label: "Rejected", tone: "bad", dot: "bg-red-400" },
  accepted: { label: "Accepted", tone: "good", dot: "bg-emerald-500" },
};

export function InternshipsView() {
  const [internships, setInternships] = useState<Internship[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [viewResume, setViewResume] = useState<Internship | null>(null);
  const [view, setView] = useState<"board" | "table">("board");

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/internships");
      if (res.ok) setInternships(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const updateStatus = async (id: string, status: Internship["status"]) => {
    const body: Record<string, string> = { id, status };
    if (status === "applied") body.dateApplied = new Date().toISOString().slice(0, 10);
    const res = await fetch("/api/internships", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) fetchData();
  };

  const deleteInternship = async (id: string) => {
    const res = await fetch(`/api/internships?id=${id}`, { method: "DELETE" });
    if (res.ok) fetchData();
  };

  const counts = STATUSES.reduce(
    (acc, s) => ({ ...acc, [s]: internships.filter((i) => i.status === s).length }),
    {} as Record<string, number>,
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted">
        Loading internships...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            <GraduationCap className="mr-2 inline-block h-6 w-6 text-brand" />
            Internships
          </h1>
          <p className="mt-1 text-sm text-muted">
            {internships.length} application{internships.length !== 1 ? "s" : ""} this cycle
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-border text-xs">
            <button
              className={cn("px-3 py-1.5 rounded-l-md transition-colors", view === "board" && "bg-surface-hover font-medium")}
              onClick={() => setView("board")}
            >
              Board
            </button>
            <button
              className={cn("px-3 py-1.5 rounded-r-md transition-colors", view === "table" && "bg-surface-hover font-medium")}
              onClick={() => setView("table")}
            >
              Table
            </button>
          </div>
          <Button onClick={() => setShowAdd(true)} size="sm">
            <Plus className="h-4 w-4" /> Add
          </Button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
        {STATUSES.map((s) => (
          <div key={s} className="rounded-xl border border-border bg-surface/50 p-3 text-center">
            <div className="text-lg font-semibold tabular-nums">{counts[s]}</div>
            <div className="text-xs text-muted">{STATUS_CONFIG[s].label}</div>
          </div>
        ))}
      </div>

      {internships.length === 0 ? (
        <Card className="py-16 text-center">
          <GraduationCap className="mx-auto h-10 w-10 text-muted" />
          <p className="mt-3 text-muted">No internships tracked yet.</p>
          <p className="text-sm text-muted">Click &quot;Add&quot; to start tracking your applications.</p>
        </Card>
      ) : view === "board" ? (
        <BoardView
          internships={internships}
          onStatusChange={updateStatus}
          onDelete={deleteInternship}
          onViewResume={setViewResume}
        />
      ) : (
        <TableView
          internships={internships}
          onStatusChange={updateStatus}
          onDelete={deleteInternship}
          onViewResume={setViewResume}
        />
      )}

      {showAdd && (
        <AddInternshipModal
          onClose={() => setShowAdd(false)}
          onAdded={() => { setShowAdd(false); fetchData(); }}
        />
      )}

      {viewResume && (
        <ResumeViewer
          internship={viewResume}
          onClose={() => setViewResume(null)}
          onUpdated={fetchData}
        />
      )}
    </div>
  );
}

function BoardView({
  internships,
  onStatusChange,
  onDelete,
  onViewResume,
}: {
  internships: Internship[];
  onStatusChange: (id: string, status: Internship["status"]) => void;
  onDelete: (id: string) => void;
  onViewResume: (i: Internship) => void;
}) {
  const columns: Internship["status"][] = ["wishlist", "applied", "interviewing", "offered", "accepted", "rejected"];

  return (
    <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
      {columns.map((status) => {
        const items = internships.filter((i) => i.status === status);
        const cfg = STATUS_CONFIG[status];
        return (
          <div key={status} className="space-y-2">
            <div className="flex items-center gap-2 px-1">
              <span className={cn("h-2 w-2 rounded-full", cfg.dot)} />
              <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                {cfg.label}
              </span>
              <span className="text-xs text-muted">({items.length})</span>
            </div>
            <div className="space-y-2">
              {items.map((item) => (
                <InternshipCard
                  key={item.id}
                  item={item}
                  onStatusChange={onStatusChange}
                  onDelete={onDelete}
                  onViewResume={onViewResume}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function InternshipCard({
  item,
  onStatusChange,
  onDelete,
  onViewResume,
}: {
  item: Internship;
  onStatusChange: (id: string, status: Internship["status"]) => void;
  onDelete: (id: string) => void;
  onViewResume: (i: Internship) => void;
}) {
  const [showActions, setShowActions] = useState(false);
  const cfg = STATUS_CONFIG[item.status];

  return (
    <Card className="group relative p-3 text-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0 flex-1">
          <p className="font-medium truncate">{item.company}</p>
          <p className="text-xs text-muted truncate">{item.role}</p>
        </div>
        <Badge tone={cfg.tone} className="shrink-0 text-[10px]">{cfg.label}</Badge>
      </div>

      {item.location && (
        <p className="mt-1 text-xs text-muted truncate">{item.location}</p>
      )}

      {item.deadline && (
        <p className="mt-1 text-xs text-muted">
          Deadline: {item.deadline}
        </p>
      )}

      <div className="mt-2 flex items-center gap-1">
        {item.url && (
          <a href={item.url} target="_blank" rel="noopener noreferrer"
            className="rounded p-1 text-muted hover:bg-surface-hover hover:text-foreground transition-colors">
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
        <button
          onClick={() => onViewResume(item)}
          className={cn(
            "rounded p-1 transition-colors",
            item.resumeFile
              ? "text-brand hover:bg-brand/10"
              : "text-muted hover:bg-surface-hover hover:text-foreground",
          )}
          title={item.resumeFile ? "View tailored resume" : "Attach resume"}
        >
          <FileText className="h-3.5 w-3.5" />
        </button>

        <div className="relative ml-auto">
          <button
            onClick={() => setShowActions(!showActions)}
            className="rounded p-1 text-muted hover:bg-surface-hover hover:text-foreground transition-colors"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          {showActions && (
            <div className="absolute right-0 top-full z-10 mt-1 w-36 rounded-lg border border-border bg-surface py-1 shadow-lg">
              {STATUSES.filter((s) => s !== item.status).map((s) => (
                <button
                  key={s}
                  onClick={() => { onStatusChange(item.id, s); setShowActions(false); }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-surface-hover transition-colors"
                >
                  <span className={cn("h-2 w-2 rounded-full", STATUS_CONFIG[s].dot)} />
                  {STATUS_CONFIG[s].label}
                </button>
              ))}
              <hr className="my-1 border-border" />
              <button
                onClick={() => { onDelete(item.id); setShowActions(false); }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-red-500 hover:bg-red-500/10 transition-colors"
              >
                <Trash2 className="h-3 w-3" /> Delete
              </button>
            </div>
          )}
        </div>
      </div>

      {item.notes && (
        <p className="mt-2 text-xs text-muted line-clamp-2 border-t border-border pt-2">
          {item.notes}
        </p>
      )}
    </Card>
  );
}

function TableView({
  internships,
  onStatusChange,
  onDelete,
  onViewResume,
}: {
  internships: Internship[];
  onStatusChange: (id: string, status: Internship["status"]) => void;
  onDelete: (id: string) => void;
  onViewResume: (i: Internship) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-surface/50 text-left text-xs font-medium uppercase tracking-wider text-muted">
            <th className="px-4 py-3">Company</th>
            <th className="px-4 py-3">Role</th>
            <th className="px-4 py-3">Location</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Deadline</th>
            <th className="px-4 py-3">Applied</th>
            <th className="px-4 py-3">Resume</th>
            <th className="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          {internships.map((item) => {
            const cfg = STATUS_CONFIG[item.status];
            return (
              <tr key={item.id} className="border-b border-border last:border-0 hover:bg-surface/30 transition-colors">
                <td className="px-4 py-3 font-medium">
                  {item.url ? (
                    <a href={item.url} target="_blank" rel="noopener noreferrer"
                      className="hover:text-brand transition-colors">
                      {item.company}
                    </a>
                  ) : item.company}
                </td>
                <td className="px-4 py-3">{item.role}</td>
                <td className="px-4 py-3 text-muted">{item.location || "—"}</td>
                <td className="px-4 py-3">
                  <select
                    value={item.status}
                    onChange={(e) => onStatusChange(item.id, e.target.value as Internship["status"])}
                    className="rounded border border-border bg-transparent px-2 py-1 text-xs"
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-3 text-muted">{item.deadline || "—"}</td>
                <td className="px-4 py-3 text-muted">{item.dateApplied || "—"}</td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => onViewResume(item)}
                    className={cn(
                      "rounded p-1 transition-colors",
                      item.resumeFile ? "text-brand hover:bg-brand/10" : "text-muted hover:bg-surface-hover",
                    )}
                  >
                    <FileText className="h-4 w-4" />
                  </button>
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => onDelete(item.id)}
                    className="rounded p-1 text-muted hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
