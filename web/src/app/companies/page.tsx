"use client";

import { useState, useEffect } from "react";
import { Building2, Search, DollarSign, ShieldAlert, CheckCircle2, ExternalLink, Globe, Layers } from "lucide-react";

type Company = {
  name: string;
  slug: string;
  website?: string;
  stage?: string;
  totalFunding?: string;
  lastRound?: string;
  investors?: string[];
  openRolesCount: number;
  applicationCount: number;
  isBlacklisted: boolean;
};

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);

  const fetchCompanies = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/companies");
      const data = await res.json();
      setCompanies(data.companies || []);
    } catch {
      // Ignored
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCompanies();
  }, []);

  const toggleBlacklist = async (company: Company) => {
    const nextAction = company.isBlacklisted ? "unblacklist" : "blacklist";
    await fetch("/api/companies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company: company.name, action: nextAction }),
    });
    fetchCompanies();
  };

  const filtered = companies.filter((c) => {
    const matchesSearch = c.name.toLowerCase().includes(search.toLowerCase());
    if (filter === "funded") return matchesSearch && Boolean(c.totalFunding || c.stage);
    if (filter === "applied") return matchesSearch && c.applicationCount > 0;
    if (filter === "blacklisted") return matchesSearch && c.isBlacklisted;
    return matchesSearch;
  });

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6 animate-in fade-in duration-200">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2.5">
            <Building2 className="size-6 text-brand" />
            Company Research & Intelligence
          </h1>
          <p className="text-xs text-muted mt-1">
            Aggregated dossiers from your tracker, reports, and funding radar. Blacklist rules sync with <code className="text-[11px] font-mono bg-surface-hover px-1 py-0.5 rounded">data/blacklist.md</code>.
          </p>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-col sm:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-2.5 size-4 text-faint" />
          <input
            type="text"
            placeholder="Search companies..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface pl-9 pr-4 py-2 text-xs text-foreground placeholder:text-muted focus:border-brand focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-1.5 w-full sm:w-auto overflow-x-auto">
          {[
            { id: "all", label: "All Companies" },
            { id: "funded", label: "Funded / VC Backed" },
            { id: "applied", label: "Applied" },
            { id: "blacklisted", label: "Blacklisted" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilter(tab.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                filter === tab.id
                  ? "bg-brand text-white font-semibold"
                  : "bg-surface border border-border text-muted hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Companies Grid */}
      {loading ? (
        <div className="p-12 text-center text-sm text-muted">Loading company intel...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center bg-surface/20">
          <Building2 className="size-10 text-faint mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-foreground">No companies found</h3>
          <p className="text-xs text-muted mt-1 max-w-sm mx-auto">
            Scan portals or evaluate postings to automatically populate company intelligence dossiers.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((c) => (
            <div
              key={c.name}
              className={`rounded-xl border p-4 bg-surface flex flex-col justify-between transition-all hover:border-brand/40 shadow-sm ${
                c.isBlacklisted ? "border-red-500/30 bg-red-950/10" : "border-border"
              }`}
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="font-bold text-base text-foreground flex items-center gap-2">
                    {c.name}
                    {c.website && (
                      <a
                        href={c.website.startsWith("http") ? c.website : `https://${c.website}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-faint hover:text-brand"
                      >
                        <Globe className="size-3.5" />
                      </a>
                    )}
                  </div>
                  {c.isBlacklisted ? (
                    <span className="rounded bg-red-500/10 border border-red-500/30 px-1.5 py-0.5 text-[10px] font-bold text-red-400">
                      Blacklisted
                    </span>
                  ) : c.stage ? (
                    <span className="rounded bg-brand-soft border border-brand/20 px-1.5 py-0.5 text-[10px] font-semibold text-brand-text">
                      {c.stage}
                    </span>
                  ) : null}
                </div>

                {/* Funding info */}
                <div className="mt-3 space-y-1.5 text-xs">
                  {c.totalFunding && (
                    <div className="flex items-center gap-2 text-muted">
                      <DollarSign className="size-3.5 text-emerald-400" />
                      <span>Funding: <strong className="text-foreground">{c.totalFunding}</strong></span>
                    </div>
                  )}
                  {c.lastRound && (
                    <div className="flex items-center gap-2 text-muted">
                      <Layers className="size-3.5 text-brand" />
                      <span>Last Round: <strong className="text-foreground">{c.lastRound}</strong></span>
                    </div>
                  )}
                  {c.investors && c.investors.length > 0 && (
                    <div className="text-[11px] text-faint truncate">
                      Investors: {c.investors.join(", ")}
                    </div>
                  )}
                </div>

                <div className="mt-3 flex items-center gap-2 text-[11px] text-faint">
                  <span>{c.openRolesCount} open roles</span>
                  <span>•</span>
                  <span>{c.applicationCount} applications</span>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between">
                <button
                  onClick={() => toggleBlacklist(c)}
                  className={`text-[11px] font-medium transition-colors ${
                    c.isBlacklisted
                      ? "text-emerald-400 hover:underline"
                      : "text-red-400/80 hover:text-red-400 hover:underline"
                  }`}
                >
                  {c.isBlacklisted ? "Remove from blacklist" : "Blacklist company"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
