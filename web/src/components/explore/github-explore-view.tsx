"use client";

import { useState, useMemo } from "react";
import { Download, Search, ExternalLink, MapPin, Clock, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";

type GitHubInternship = {
  company: string;
  role: string;
  location: string;
  url: string;
  age: string;
  track: string;
  section: string;
};

const SECTIONS = [
  { key: "Data Science", label: "DS / AI / ML", track: "DS" },
  { key: "Software Engineering", label: "Software Engineering", track: "SWE" },
  { key: "Product Management", label: "Product Management", track: "DA" },
  { key: "Quantitative Finance", label: "Quantitative Finance", track: "DS" },
  { key: "Hardware Engineering", label: "Hardware Engineering", track: "SWE" },
];

const RECENCY_OPTIONS = [
  { label: "Any time", maxDays: Infinity },
  { label: "Past 24h", maxDays: 1 },
  { label: "Past 3d", maxDays: 3 },
  { label: "Past 7d", maxDays: 7 },
  { label: "Past 14d", maxDays: 14 },
  { label: "Past 30d", maxDays: 30 },
];

/** Parse an age string like "1d", "3d", "1w", "2mo" into approximate days. */
function ageToDays(age: string): number | null {
  if (!age) return null;
  const m = age.trim().match(/^(\d+)\s*(d|w|mo|m|h)/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  if (unit === "h") return n / 24;
  if (unit === "d") return n;
  if (unit === "w") return n * 7;
  if (unit === "mo" || unit === "m") return n * 30;
  return null;
}

const TRACK_COLORS: Record<string, string> = {
  DS: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
  DA: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  SWE: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
};

export function GitHubExploreView() {
  const [listings, setListings] = useState<GitHubInternship[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetched, setFetched] = useState(false);
  const [stats, setStats] = useState<{ imported: number; filtered: number; closed: number } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [trackFilter, setTrackFilter] = useState<string>("all");
  const [recencyMaxDays, setRecencyMaxDays] = useState<number>(Infinity);
  const [selectedSections, setSelectedSections] = useState<string[]>(["Data Science"]);

  const toggleSection = (key: string) => {
    setSelectedSections((prev) =>
      prev.includes(key) ? prev.filter((s) => s !== key) : [...prev, key],
    );
  };

  const fetchListings = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/internships/import-github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sections: selectedSections, usOnly: true }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? "Failed to fetch listings");
        return;
      }
      const data = await res.json();
      setStats({ imported: data.imported, filtered: data.filtered, closed: data.closed });
      setFetched(true);

      // Now read all internships to get the newly imported ones
      const internRes = await fetch("/api/internships");
      if (internRes.ok) {
        const all = await internRes.json();
        // Show only simplify-github sourced ones
        const ghListings = all
          .filter((i: Record<string, string>) => i.source === "simplify-github")
          .map((i: Record<string, string>) => ({
            company: i.company,
            role: i.role,
            location: i.location || "",
            url: i.url || "",
            age: (i.notes || "").replace("Posted: ", "").replace(" ago", ""),
            track: i.track || "",
            section: "",
          }));
        setListings(ghListings);
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    return listings.filter((l) => {
      if (trackFilter !== "all" && l.track !== trackFilter) return false;
      if (recencyMaxDays !== Infinity) {
        const days = ageToDays(l.age);
        if (days === null || days > recencyMaxDays) return false;
      }
      if (searchQuery) {
        const terms = searchQuery.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
        const haystack = `${l.company} ${l.role} ${l.location} ${l.track}`.toLowerCase();
        if (!terms.some((t) => haystack.includes(t))) return false;
      }
      return true;
    });
  }, [listings, trackFilter, recencyMaxDays, searchQuery]);

  const tracks = [...new Set(listings.map((l) => l.track).filter(Boolean))];

  if (!fetched) {
    return (
      <div className="space-y-6">
        <div className="rounded-xl border border-border bg-surface/40 p-6 space-y-5">
          <div>
            <h3 className="text-sm font-semibold">Import from SimplifyJobs GitHub</h3>
            <p className="mt-1 text-xs text-muted">
              Fetches internship listings from the{" "}
              <a href="https://github.com/SimplifyJobs/Summer2027-Internships" target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">
                SimplifyJobs/Summer2027-Internships
              </a>{" "}
              repo. ~1,900 roles across DS/AI/ML, SWE, PM, Quant, and Hardware. US locations only.
            </p>
          </div>

          <div>
            <p className="text-xs font-medium mb-2">Select categories to import:</p>
            <div className="flex flex-wrap gap-2">
              {SECTIONS.map((s) => (
                <button
                  key={s.key}
                  onClick={() => toggleSection(s.key)}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                    selectedSections.includes(s.key)
                      ? "border-brand bg-brand/10 text-brand"
                      : "border-border text-muted hover:text-foreground",
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <Button onClick={fetchListings} disabled={loading || selectedSections.length === 0} size="sm">
            <Download className="h-4 w-4" />
            {loading ? "Fetching..." : "Fetch & Import Listings"}
          </Button>

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Stats */}
      {stats && (
        <div className="flex flex-wrap gap-3 text-xs text-muted">
          <span><strong className="text-foreground">{listings.length}</strong> listings loaded</span>
          <span>&middot;</span>
          <span><strong className="text-foreground">{stats.imported}</strong> newly imported</span>
          <span>&middot;</span>
          <span>{stats.filtered} non-US filtered</span>
          <span>&middot;</span>
          <span>{stats.closed} closed</span>
        </div>
      )}

      {/* Search & Filter */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
          <input
            type="text"
            placeholder="Search (comma-separated, e.g. data analyst, ML)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="rounded-lg border border-border bg-transparent py-1.5 pl-8 pr-3 text-xs placeholder:text-muted/60 focus:border-brand focus:outline-none w-64"
          />
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted">
          <Filter className="h-3.5 w-3.5" />
          <span>Track:</span>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => setTrackFilter("all")}
            className={cn("rounded-md px-2 py-1 text-xs transition-colors", trackFilter === "all" ? "bg-surface-hover font-medium" : "text-muted hover:text-foreground")}
          >
            All ({listings.length})
          </button>
          {tracks.map((t) => (
            <button
              key={t}
              onClick={() => setTrackFilter(t)}
              className={cn("rounded-md px-2 py-1 text-xs font-medium transition-colors", trackFilter === t ? TRACK_COLORS[t] ?? "bg-surface-hover" : "text-muted hover:text-foreground")}
            >
              {t} ({listings.filter((l) => l.track === t).length})
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted">
          <Clock className="h-3.5 w-3.5" />
          <span>Posted:</span>
        </div>
        <div className="flex gap-1">
          {RECENCY_OPTIONS.map((opt) => (
            <button
              key={opt.label}
              onClick={() => setRecencyMaxDays(opt.maxDays)}
              className={cn(
                "rounded-md px-2 py-1 text-xs transition-colors",
                recencyMaxDays === opt.maxDays ? "bg-surface-hover font-medium" : "text-muted hover:text-foreground",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="ml-auto">
          <Button variant="outline" size="sm" onClick={() => { setFetched(false); setListings([]); setStats(null); }}>
            Re-fetch
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted">{filtered.length} result{filtered.length !== 1 ? "s" : ""}</p>

      {/* Results grid */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.map((l, idx) => (
          <Card key={`${l.company}-${l.role}-${idx}`} className="group p-4 hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="font-medium text-sm truncate">{l.company}</p>
                  {l.track && (
                    <span className={cn("shrink-0 rounded px-1 py-0.5 text-[9px] font-bold", TRACK_COLORS[l.track] ?? "bg-zinc-500/15 text-zinc-500")}>
                      {l.track}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted truncate mt-0.5">{l.role}</p>
              </div>
              {l.url && (
                <a
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 rounded-lg border border-border px-2.5 py-1 text-[10px] font-medium text-brand hover:bg-brand/10 transition-colors"
                >
                  Apply
                </a>
              )}
            </div>
            <div className="mt-2 flex items-center gap-3 text-[11px] text-muted">
              {l.location && (
                <span className="flex items-center gap-1 truncate">
                  <MapPin className="h-3 w-3 shrink-0" />
                  {l.location}
                </span>
              )}
              {l.age && (
                <span className="flex items-center gap-1 shrink-0">
                  <Clock className="h-3 w-3" />
                  {l.age}
                </span>
              )}
            </div>
          </Card>
        ))}
      </div>

      {filtered.length === 0 && (
        <Card className="py-12 text-center">
          <p className="text-sm text-muted">No listings match your search.</p>
        </Card>
      )}
    </div>
  );
}
