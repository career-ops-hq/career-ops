"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, GraduationCap, ExternalLink, Trash2, FileText, ChevronDown, AlertTriangle, Clock, Bell, RefreshCw, Filter, Target, Search, BarChart3, Send, Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { AddInternshipModal } from "./add-internship-modal";
import { ResumeViewer } from "./resume-viewer";
import { TailorPanel } from "./tailor-panel";
import { CalendarView } from "./calendar-view";
import { AnalyticsView } from "./analytics-view";

type Internship = {
  id: string;
  company: string;
  role: string;
  location: string;
  status: "wishlist" | "applied" | "interviewing" | "offered" | "rejected" | "accepted" | "closed" | "not_posted" | "unknown";
  dateAdded: string;
  dateApplied?: string;
  deadline?: string;
  url?: string;
  notes: string;
  resumeFile?: string;
  score?: string;
  track?: string;
  term?: string;
  opened?: string;
  dateConfidence?: string;
  gradEligibility?: string;
  workAuth?: string;
  requirements?: string;
  priority?: string;
  source?: string;
  lastVerified?: string;
  statusLog?: { date: string; from: string; to: string; note?: string }[];
};

const STATUSES = ["wishlist", "applied", "interviewing", "offered", "accepted", "rejected", "closed", "not_posted", "unknown"] as const;

const STATUS_CONFIG: Record<
  Internship["status"],
  { label: string; tone: "muted" | "info" | "warn" | "good" | "bad"; dot: string }
> = {
  wishlist: { label: "Open", tone: "muted", dot: "bg-zinc-400" },
  applied: { label: "Applied", tone: "info", dot: "bg-sky-400" },
  interviewing: { label: "Interviewing", tone: "warn", dot: "bg-amber-400" },
  offered: { label: "Offered", tone: "good", dot: "bg-emerald-400" },
  accepted: { label: "Accepted", tone: "good", dot: "bg-emerald-500" },
  rejected: { label: "Rejected", tone: "bad", dot: "bg-red-400" },
  closed: { label: "Closed", tone: "bad", dot: "bg-red-300" },
  not_posted: { label: "Not Posted", tone: "muted", dot: "bg-zinc-300" },
  unknown: { label: "Unknown", tone: "muted", dot: "bg-zinc-500" },
};

const TRACK_COLORS: Record<string, string> = {
  DS: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
  DA: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  BIE: "bg-teal-500/15 text-teal-700 dark:text-teal-400",
  SWE: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
};

// Stem-aware search: "data analytics" matches "data analyst", "science" matches "scientist", etc.
const STEM_MAP: Record<string, string[]> = {
  analyt: ["analyst", "analytics", "analytical", "analysis", "analyze"],
  scien: ["science", "scientist", "scientific"],
  engineer: ["engineer", "engineering"],
  develop: ["developer", "development", "developing"],
  design: ["designer", "design", "designing"],
  manag: ["manager", "management", "managing"],
  research: ["researcher", "research", "researching"],
  program: ["programmer", "programming", "program"],
  consult: ["consultant", "consulting"],
  intel: ["intelligence", "intelligent"],
  learn: ["learning", "learner"],
  model: ["modeler", "modeling", "model", "models"],
  visual: ["visualization", "visualize", "visual"],
  stat: ["statistics", "statistical", "statistician"],
  machine: ["machine"],
  business: ["business"],
  data: ["data"],
  software: ["software"],
  product: ["product"],
  quant: ["quantitative", "quant"],
};

function fuzzyMatch(term: string, haystack: string): boolean {
  // Direct substring match first
  if (haystack.includes(term)) return true;
  // Check each word in the search term against stem families
  const words = term.split(/\s+/);
  return words.every((word) => {
    if (haystack.includes(word)) return true;
    // Find which stem family this word belongs to, then check if any sibling matches
    for (const [, family] of Object.entries(STEM_MAP)) {
      if (family.some((f) => f.startsWith(word) || word.startsWith(f))) {
        if (family.some((sibling) => haystack.includes(sibling))) return true;
      }
    }
    return false;
  });
}

export function InternshipsView() {
  const [internships, setInternships] = useState<Internship[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [viewResume, setViewResume] = useState<Internship | null>(null);
  const [tailorId, setTailorId] = useState<string | null>(null);
  const [view, setView] = useState<"board" | "table" | "calendar" | "updates" | "analytics">("board");
  const [trackFilter, setTrackFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [searchQuery, setSearchQuery] = useState("");

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/internships");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length === 0) {
          // Auto-seed from Claude tracker on first load
          const seedRes = await fetch("/api/internships/seed", { method: "POST" });
          if (seedRes.ok) {
            const refetch = await fetch("/api/internships");
            if (refetch.ok) setInternships(await refetch.json());
          }
        } else {
          setInternships(data);
        }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Filter internships by search, track, and status
  const filtered = internships.filter((i) => {
    if (searchQuery) {
      const terms = searchQuery.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
      if (terms.length > 0) {
        const haystack = `${i.company} ${i.role} ${i.location} ${i.notes} ${i.track ?? ""} ${i.term ?? ""} ${i.source ?? ""} ${i.requirements ?? ""}`.toLowerCase();
        if (!terms.some((t) => fuzzyMatch(t, haystack))) return false;
      }
    }
    if (trackFilter !== "all" && i.track !== trackFilter) return false;
    if (statusFilter === "active") return !["closed", "rejected"].includes(i.status);
    if (statusFilter === "actionable") return ["wishlist"].includes(i.status);
    if (statusFilter !== "all" && i.status !== statusFilter) return false;
    return true;
  });

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

  // Track counts
  const tracks = [...new Set(internships.map((i) => i.track).filter(Boolean))] as string[];

  // Diversity tracking: flag companies with multiple active applications
  const activeStatuses = new Set<string>(["wishlist", "applied", "interviewing", "offered", "unknown", "not_posted"]);
  const companyCounts = new Map<string, number>();
  for (const i of internships) {
    if (!activeStatuses.has(i.status)) continue;
    const key = i.company.trim().toLowerCase();
    companyCounts.set(key, (companyCounts.get(key) ?? 0) + 1);
  }
  const duplicateCompanies = [...companyCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([name, count]) => ({ name, count }));
  const uniqueCompanies = companyCounts.size;
  const totalActive = [...companyCounts.values()].reduce((a, b) => a + b, 0);

  // Updates: deadlines approaching, stale verifications, actionable items
  const today = new Date().toISOString().slice(0, 10);
  const sevenDaysOut = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const upcomingDeadlines = internships
    .filter((i) => i.deadline && i.deadline >= today && i.deadline <= sevenDaysOut && !["closed", "rejected"].includes(i.status))
    .sort((a, b) => (a.deadline ?? "").localeCompare(b.deadline ?? ""));
  const staleVerifications = internships
    .filter((i) => {
      if (["closed", "rejected"].includes(i.status)) return false;
      if (!i.lastVerified) return true;
      const daysSince = (Date.now() - new Date(i.lastVerified).getTime()) / 86400000;
      return daysSince > 14;
    })
    .sort((a, b) => (a.lastVerified ?? "").localeCompare(b.lastVerified ?? ""));
  const actionableItems = internships.filter((i) => i.status === "wishlist");
  const pastDeadlines = internships
    .filter((i) => i.deadline && i.deadline < today && !["closed", "rejected", "applied"].includes(i.status));

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
            {internships.length} position{internships.length !== 1 ? "s" : ""} tracked &middot; {filtered.length} shown
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-border text-xs">
            {(["board", "table", "calendar", "analytics", "updates"] as const).map((v, idx, arr) => (
              <button
                key={v}
                className={cn(
                  "px-3 py-1.5 transition-colors",
                  idx === 0 && "rounded-l-md",
                  idx === arr.length - 1 && "rounded-r-md",
                  view === v && "bg-surface-hover font-medium",
                )}
                onClick={() => setView(v)}
              >
                {v === "updates" ? (
                  <span className="flex items-center gap-1">
                    Updates
                    {(upcomingDeadlines.length > 0 || pastDeadlines.length > 0) && (
                      <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                    )}
                  </span>
                ) : v === "analytics" ? (
                  <span className="flex items-center gap-1">
                    <BarChart3 className="h-3.5 w-3.5" />
                    Analytics
                  </span>
                ) : v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
          <SimplifyMenu onImported={fetchData} />
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

      {/* Search & Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
          <input
            type="text"
            placeholder="Search (comma-separated, e.g. data analyst, DS)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="rounded-lg border border-border bg-transparent py-1.5 pl-8 pr-3 text-xs placeholder:text-muted/60 focus:border-brand focus:outline-none w-56"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-foreground text-xs"
              aria-label="Clear search"
            >
              &times;
            </button>
          )}
        </div>
        <span className="text-border">|</span>
        <div className="flex items-center gap-1.5 text-xs text-muted">
          <Filter className="h-3.5 w-3.5" />
          <span>Track:</span>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => setTrackFilter("all")}
            className={cn("rounded-md px-2 py-1 text-xs transition-colors", trackFilter === "all" ? "bg-surface-hover font-medium" : "text-muted hover:text-foreground")}
          >
            All
          </button>
          {tracks.map((t) => (
            <button
              key={t}
              onClick={() => setTrackFilter(t)}
              className={cn("rounded-md px-2 py-1 text-xs font-medium transition-colors", trackFilter === t ? TRACK_COLORS[t] ?? "bg-surface-hover" : "text-muted hover:text-foreground")}
            >
              {t}
            </button>
          ))}
        </div>
        <span className="text-border">|</span>
        <div className="flex items-center gap-1.5 text-xs text-muted">
          <span>Status:</span>
        </div>
        <div className="flex gap-1">
          {[["active", "Active"], ["actionable", "Actionable"], ["all", "All"]].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setStatusFilter(key)}
              className={cn("rounded-md px-2 py-1 text-xs transition-colors", statusFilter === key ? "bg-surface-hover font-medium" : "text-muted hover:text-foreground")}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Diversity indicator */}
      {totalActive > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface/50 px-4 py-3">
          <div className="text-sm">
            <span className="font-semibold">{uniqueCompanies}</span>
            <span className="text-muted"> unique {uniqueCompanies === 1 ? "company" : "companies"} across </span>
            <span className="font-semibold">{totalActive}</span>
            <span className="text-muted"> active applications</span>
          </div>
          {totalActive > 0 && uniqueCompanies > 0 && (
            <Badge tone={uniqueCompanies / totalActive >= 0.8 ? "good" : uniqueCompanies / totalActive >= 0.5 ? "warn" : "bad"}>
              {Math.round((uniqueCompanies / totalActive) * 100)}% diverse
            </Badge>
          )}
        </div>
      )}

      {/* Duplicate company warning */}
      {duplicateCompanies.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Multiple applications at the same company
          </div>
          <p className="mt-1 text-xs text-muted">
            Spreading applications across different companies increases your chances.
            {" "}Duplicates: {duplicateCompanies.map((d) => `${d.name} (${d.count})`).join(", ")}.
          </p>
        </div>
      )}

      {filtered.length === 0 ? (
        <Card className="py-16 text-center">
          <GraduationCap className="mx-auto h-10 w-10 text-muted" />
          <p className="mt-3 text-muted">{internships.length === 0 ? "No internships tracked yet." : "No matches for current filters."}</p>
          {internships.length === 0 && <p className="text-sm text-muted">Click &quot;Add&quot; to start tracking your applications.</p>}
        </Card>
      ) : view === "updates" ? (
        <UpdatesView
          internships={internships}
          upcomingDeadlines={upcomingDeadlines}
          staleVerifications={staleVerifications}
          actionableItems={actionableItems}
          pastDeadlines={pastDeadlines}
          onStatusChange={updateStatus}
        />
      ) : view === "analytics" ? (
        <AnalyticsView internships={internships} />
      ) : view === "calendar" ? (
        <CalendarView
          internships={filtered}
          onTailor={setTailorId}
        />
      ) : view === "board" ? (
        <BoardView
          internships={filtered}
          onStatusChange={updateStatus}
          onDelete={deleteInternship}
          onViewResume={setViewResume}
          onTailor={setTailorId}
          duplicateCompanies={new Set(duplicateCompanies.map((d) => d.name))}
        />
      ) : (
        <TableView
          internships={filtered}
          onStatusChange={updateStatus}
          onDelete={deleteInternship}
          onViewResume={setViewResume}
          onTailor={setTailorId}
          duplicateCompanies={new Set(duplicateCompanies.map((d) => d.name))}
        />
      )}

      {showAdd && (
        <AddInternshipModal
          onClose={() => setShowAdd(false)}
          onAdded={() => { setShowAdd(false); fetchData(); }}
          existingCompanies={internships.filter((i) => activeStatuses.has(i.status)).map((i) => i.company)}
        />
      )}

      {viewResume && (
        <ResumeViewer
          internship={viewResume}
          onClose={() => setViewResume(null)}
          onUpdated={fetchData}
        />
      )}

      {tailorId && (
        <TailorPanel
          internshipId={tailorId}
          onClose={() => setTailorId(null)}
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
  onTailor,
  duplicateCompanies,
}: {
  internships: Internship[];
  onStatusChange: (id: string, status: Internship["status"]) => void;
  onDelete: (id: string) => void;
  onViewResume: (i: Internship) => void;
  onTailor: (id: string) => void;
  duplicateCompanies: Set<string>;
}) {
  const columns: Internship["status"][] = ["wishlist", "not_posted", "applied", "interviewing", "offered", "accepted", "rejected", "closed", "unknown"];

  return (
    <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9">
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
                  onTailor={onTailor}
                  isDuplicate={duplicateCompanies.has(item.company.trim().toLowerCase())}
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
  onTailor,
  isDuplicate,
}: {
  item: Internship;
  onStatusChange: (id: string, status: Internship["status"]) => void;
  onDelete: (id: string) => void;
  onViewResume: (i: Internship) => void;
  onTailor: (id: string) => void;
  isDuplicate?: boolean;
}) {
  const [showActions, setShowActions] = useState(false);
  const cfg = STATUS_CONFIG[item.status];

  return (
    <Card className={cn("group relative p-3 text-sm hover:shadow-md transition-shadow", isDuplicate && "ring-1 ring-amber-500/30")}>
      {isDuplicate && (
        <div className="mb-2 flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
          <AlertTriangle className="h-3 w-3" />
          Duplicate company — consider diversifying
        </div>
      )}
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0 flex-1 cursor-pointer" onClick={() => onTailor(item.id)}>
          <p className="font-medium truncate hover:text-brand transition-colors">{item.company}</p>
          <p className="text-xs text-muted truncate">{item.role}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {item.track && (
            <span className={cn("inline-block rounded px-1 py-0.5 text-[9px] font-bold", TRACK_COLORS[item.track] ?? "bg-zinc-500/15 text-zinc-500")}>
              {item.track}
            </span>
          )}
          <Badge tone={cfg.tone} className="text-[10px]">{cfg.label}</Badge>
        </div>
      </div>

      {item.location && (
        <p className="mt-1 text-xs text-muted truncate">{item.location}</p>
      )}

      {item.deadline && (
        <p className={cn("mt-1 text-xs", item.deadline < new Date().toISOString().slice(0, 10) ? "text-red-500" : "text-muted")}>
          Deadline: {item.deadline}
        </p>
      )}

      {item.lastVerified && (
        <p className="mt-0.5 text-[10px] text-muted">
          Verified: {item.lastVerified}
        </p>
      )}

      <div className="mt-2 flex items-center gap-1">
        {item.url && item.status === "wishlist" && (
          <button
            onClick={() => { window.open(item.url, "_blank", "noopener,noreferrer"); onStatusChange(item.id, "applied"); }}
            className="flex items-center gap-1 rounded bg-brand/10 px-1.5 py-0.5 text-[10px] font-medium text-brand hover:bg-brand/20 transition-colors"
            title="Open application page and mark as applied"
          >
            <Send className="h-3 w-3" />
            Apply
          </button>
        )}
        {item.url && item.status !== "wishlist" && (
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
        <button
          onClick={() => onTailor(item.id)}
          className="rounded p-1 text-muted hover:bg-brand/10 hover:text-brand transition-colors"
          title="Tailor for this role"
        >
          <Target className="h-3.5 w-3.5" />
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
  onTailor,
  duplicateCompanies,
}: {
  internships: Internship[];
  onStatusChange: (id: string, status: Internship["status"]) => void;
  onDelete: (id: string) => void;
  onViewResume: (i: Internship) => void;
  onTailor: (id: string) => void;
  duplicateCompanies: Set<string>;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-surface/50 text-left text-xs font-medium uppercase tracking-wider text-muted">
            <th className="px-4 py-3">Company</th>
            <th className="px-4 py-3">Role</th>
            <th className="px-4 py-3">Track</th>
            <th className="px-4 py-3">Location</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Deadline</th>
            <th className="px-4 py-3">Applied</th>
            <th className="px-4 py-3">Resume</th>
            <th className="px-4 py-3">Tailor</th>
            <th className="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          {internships.map((item) => {
            const cfg = STATUS_CONFIG[item.status];
            return (
              <tr key={item.id} className="border-b border-border last:border-0 hover:bg-surface/30 transition-colors">
                <td className="px-4 py-3 font-medium">
                  <div className="flex items-center gap-1.5">
                    {duplicateCompanies.has(item.company.trim().toLowerCase()) && (
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                    )}
                    {item.url ? (
                      <a href={item.url} target="_blank" rel="noopener noreferrer"
                        className="hover:text-brand transition-colors">
                        {item.company}
                      </a>
                    ) : item.company}
                  </div>
                </td>
                <td className="px-4 py-3">{item.role}</td>
                <td className="px-4 py-3">
                  {item.track ? (
                    <span className={cn("inline-block rounded px-1.5 py-0.5 text-[10px] font-bold", TRACK_COLORS[item.track] ?? "bg-zinc-500/15 text-zinc-500")}>
                      {item.track}
                    </span>
                  ) : "—"}
                </td>
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
                    onClick={() => onTailor(item.id)}
                    className="rounded p-1 text-muted hover:text-brand hover:bg-brand/10 transition-colors"
                    title="Tailor for this role"
                  >
                    <Target className="h-4 w-4" />
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

function UpdatesView({
  internships,
  upcomingDeadlines,
  staleVerifications,
  actionableItems,
  pastDeadlines,
  onStatusChange,
}: {
  internships: Internship[];
  upcomingDeadlines: Internship[];
  staleVerifications: Internship[];
  actionableItems: Internship[];
  pastDeadlines: Internship[];
  onStatusChange: (id: string, status: Internship["status"]) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);

  const recentChanges = internships
    .flatMap((i) =>
      (i.statusLog ?? []).map((log) => ({ ...log, company: i.company, role: i.role, id: i.id })),
    )
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 10);

  const hasAlerts = pastDeadlines.length > 0 || upcomingDeadlines.length > 0;

  return (
    <div className="space-y-6">
      {pastDeadlines.length > 0 && (
        <Card className="border-red-500/30 bg-red-500/5 p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-red-600 dark:text-red-400">
            <AlertTriangle className="h-4 w-4" />
            Missed Deadlines ({pastDeadlines.length})
          </div>
          <p className="mt-1 text-xs text-muted">These deadlines have passed but the applications are still open.</p>
          <div className="mt-3 space-y-2">
            {pastDeadlines.map((item) => (
              <div key={item.id} className="flex items-center justify-between rounded-lg border border-red-500/20 bg-background px-4 py-2.5">
                <div>
                  <span className="text-sm font-medium">{item.company}</span>
                  <span className="mx-2 text-muted">&middot;</span>
                  <span className="text-sm text-muted">{item.role}</span>
                  <span className="ml-3 text-xs text-red-500">Due {item.deadline}</span>
                </div>
                <div className="flex gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => onStatusChange(item.id, "applied")}>
                    Mark Applied
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onStatusChange(item.id, "closed")}>
                    Close
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {upcomingDeadlines.length > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5 p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-400">
            <Clock className="h-4 w-4" />
            Upcoming Deadlines ({upcomingDeadlines.length})
          </div>
          <p className="mt-1 text-xs text-muted">These deadlines are within the next 7 days.</p>
          <div className="mt-3 space-y-2">
            {upcomingDeadlines.map((item) => {
              const daysLeft = Math.ceil(
                (new Date(item.deadline!).getTime() - new Date(today).getTime()) / 86400000,
              );
              return (
                <div key={item.id} className="flex items-center justify-between rounded-lg border border-amber-500/20 bg-background px-4 py-2.5">
                  <div>
                    <span className="text-sm font-medium">{item.company}</span>
                    <span className="mx-2 text-muted">&middot;</span>
                    <span className="text-sm text-muted">{item.role}</span>
                    <span className="ml-3 text-xs text-amber-600 dark:text-amber-400">
                      {daysLeft === 0 ? "Due today" : `${daysLeft} day${daysLeft !== 1 ? "s" : ""} left`}
                    </span>
                  </div>
                  {item.status === "wishlist" && (
                    <Button size="sm" variant="outline" onClick={() => onStatusChange(item.id, "applied")}>
                      Mark Applied
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {actionableItems.length > 0 && (
        <Card className="p-5">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Bell className="h-4 w-4 text-brand" />
            Ready to Apply ({actionableItems.length})
          </div>
          <p className="mt-1 text-xs text-muted">Open positions you haven&apos;t applied to yet.</p>
          <div className="mt-3 space-y-2">
            {actionableItems.map((item) => (
              <div key={item.id} className="flex items-center justify-between rounded-lg border border-border px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium">{item.company}</span>
                  <span className="mx-2 text-muted">&middot;</span>
                  <span className="text-sm text-muted">{item.role}</span>
                  {item.track && (
                    <span className={cn("ml-2 inline-block rounded px-1 py-0.5 text-[9px] font-bold", TRACK_COLORS[item.track] ?? "bg-zinc-500/15 text-zinc-500")}>
                      {item.track}
                    </span>
                  )}
                  {item.notes && (
                    <p className="mt-0.5 text-xs text-muted truncate max-w-md">{item.notes}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {item.url && (
                    <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-muted hover:text-brand transition-colors">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                  <Button size="sm" variant="outline" onClick={() => onStatusChange(item.id, "applied")}>
                    Applied
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {staleVerifications.length > 0 && (
        <Card className="p-5">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <RefreshCw className="h-4 w-4 text-muted" />
            Needs Verification ({staleVerifications.length})
          </div>
          <p className="mt-1 text-xs text-muted">These postings haven&apos;t been verified in over 14 days, or have no verification date.</p>
          <div className="mt-3 space-y-1.5">
            {staleVerifications.slice(0, 15).map((item) => (
              <div key={item.id} className="flex items-center justify-between rounded-lg border border-border px-4 py-2">
                <div>
                  <span className="text-sm font-medium">{item.company}</span>
                  <span className="mx-2 text-muted">&middot;</span>
                  <span className="text-sm text-muted">{item.role}</span>
                </div>
                <span className="text-xs text-muted">
                  {item.lastVerified ? `Last verified: ${item.lastVerified}` : "Never verified"}
                </span>
              </div>
            ))}
            {staleVerifications.length > 15 && (
              <p className="text-xs text-muted pt-1">+{staleVerifications.length - 15} more</p>
            )}
          </div>
        </Card>
      )}

      {recentChanges.length > 0 && (
        <Card className="p-5">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Clock className="h-4 w-4 text-muted" />
            Recent Activity
          </div>
          <div className="mt-3 space-y-2">
            {recentChanges.map((log, idx) => (
              <div key={idx} className="flex items-center gap-3 text-sm">
                <span className="text-xs text-muted w-20 shrink-0">{log.date}</span>
                <span className="font-medium">{log.company}</span>
                <span className="text-muted">&middot;</span>
                <span className="text-xs">
                  <Badge tone={STATUS_CONFIG[log.from as Internship["status"]]?.tone ?? "muted"} className="text-[10px]">
                    {STATUS_CONFIG[log.from as Internship["status"]]?.label ?? log.from}
                  </Badge>
                  <span className="mx-1">&rarr;</span>
                  <Badge tone={STATUS_CONFIG[log.to as Internship["status"]]?.tone ?? "muted"} className="text-[10px]">
                    {STATUS_CONFIG[log.to as Internship["status"]]?.label ?? log.to}
                  </Badge>
                </span>
                {log.note && <span className="text-xs text-muted">{log.note}</span>}
              </div>
            ))}
          </div>
        </Card>
      )}

      {!hasAlerts && actionableItems.length === 0 && recentChanges.length === 0 && (
        <Card className="py-12 text-center">
          <Bell className="mx-auto h-8 w-8 text-muted" />
          <p className="mt-3 text-sm text-muted">No updates right now. Check back when deadlines approach!</p>
        </Card>
      )}
    </div>
  );
}

function SimplifyMenu({ onImported }: { onImported: () => void }) {
  const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const exportProfile = async () => {
    setOpen(false);
    const res = await fetch("/api/resume-profile/simplify-export");
    if (!res.ok) {
      setResult(res.status === 404 ? "Upload a resume first" : "Export failed");
      setTimeout(() => setResult(null), 3000);
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "simplify-profile.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const importSimplify = () => {
    setOpen(false);
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setImporting(true);
      try {
        const csv = await file.text();
        const res = await fetch("/api/internships/import-simplify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ csv }),
        });
        if (res.ok) {
          const data = await res.json();
          setResult(`Imported ${data.imported}, skipped ${data.skipped} duplicates`);
          onImported();
        } else {
          const err = await res.json().catch(() => null);
          setResult(err?.error ?? "Import failed");
        }
      } finally {
        setImporting(false);
        setTimeout(() => setResult(null), 4000);
      }
    };
    input.click();
  };

  const importGitHub = async (sections?: string[]) => {
    setOpen(false);
    setImporting(true);
    try {
      const res = await fetch("/api/internships/import-github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sections, usOnly: true }),
      });
      if (res.ok) {
        const data = await res.json();
        setResult(`Imported ${data.imported} roles (${data.filtered} non-US filtered, ${data.skipped} dupes, ${data.closed} closed)`);
        onImported();
      } else {
        const err = await res.json().catch(() => null);
        setResult(err?.error ?? "GitHub import failed");
      }
    } finally {
      setImporting(false);
      setTimeout(() => setResult(null), 5000);
    }
  };

  return (
    <div className="relative">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(!open)}
        disabled={importing}
      >
        {importing ? "Importing..." : "Simplify"}
      </Button>
      {open && (
        <div className="absolute right-0 top-full z-10 mt-1 w-64 rounded-lg border border-border bg-surface py-1 shadow-lg">
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">SimplifyJobs GitHub</div>
          <button
            onClick={() => importGitHub(["Data Science"])}
            className="flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-surface-hover transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            DS / AI / ML roles (US only)
          </button>
          <button
            onClick={() => importGitHub(["Software Engineering"])}
            className="flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-surface-hover transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            Software Engineering (US only)
          </button>
          <button
            onClick={() => importGitHub()}
            className="flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-surface-hover transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            All categories (US only)
          </button>
          <hr className="my-1 border-border" />
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">Simplify App</div>
          <button
            onClick={importSimplify}
            className="flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-surface-hover transition-colors"
          >
            <Upload className="h-3.5 w-3.5" />
            Import from Simplify CSV
          </button>
          <button
            onClick={exportProfile}
            className="flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-surface-hover transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            Export profile for Simplify
          </button>
        </div>
      )}
      {result && (
        <div className="absolute right-0 top-full z-10 mt-1 rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg whitespace-nowrap">
          {result}
        </div>
      )}
    </div>
  );
}
