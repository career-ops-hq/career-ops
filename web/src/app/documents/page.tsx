"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Files, FileText, Download, Eye, Plus, Sparkles, Search, CheckCircle2 } from "lucide-react";

type DocumentItem = {
  id: string;
  name: string;
  category: "cv" | "tailored-cv" | "cover-letter" | "interview-prep" | "report";
  path: string;
  sizeBytes: number;
  updatedAt: string;
};

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [search, setSearch] = useState("");

  const fetchDocs = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/documents");
      const data = await res.json();
      setDocuments(data.documents || []);
    } catch {}
    finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDocs();
  }, []);

  const filtered = documents.filter((d) => {
    const matchesCategory = categoryFilter === "all" || d.category === categoryFilter;
    const matchesSearch = d.name.toLowerCase().includes(search.toLowerCase()) || d.path.toLowerCase().includes(search.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6 animate-in fade-in duration-200">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2.5">
            <Files className="size-6 text-brand" />
            Documents Hub
          </h1>
          <p className="text-xs text-muted mt-1">
            Central repository of your Master CV (<code className="text-[11px] font-mono bg-surface-hover px-1 py-0.5 rounded">cv.md</code>), tailored resumes, cover letters, and reports.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/cv"
            className="flex items-center gap-2 rounded-lg bg-brand px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:opacity-90"
          >
            <FileText className="size-4" />
            Edit Master CV
          </Link>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-col sm:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-2.5 size-4 text-faint" />
          <input
            type="text"
            placeholder="Search documents by name or path..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface pl-9 pr-4 py-2 text-xs text-foreground placeholder:text-muted focus:border-brand focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-1.5 w-full sm:w-auto overflow-x-auto">
          {[
            { id: "all", label: "All Docs" },
            { id: "cv", label: "Master CV" },
            { id: "tailored-cv", label: "Tailored CVs" },
            { id: "cover-letter", label: "Cover Letters" },
            { id: "report", label: "Reports" },
            { id: "interview-prep", label: "Interview Prep" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setCategoryFilter(tab.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                categoryFilter === tab.id
                  ? "bg-brand text-white font-semibold"
                  : "bg-surface border border-border text-muted hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Documents List */}
      {loading ? (
        <div className="p-12 text-center text-sm text-muted">Loading documents...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center bg-surface/20">
          <Files className="size-10 text-faint mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-foreground">No documents found</h3>
          <p className="text-xs text-muted mt-1 max-w-sm mx-auto">
            Generate tailored CVs, cover letters, or evaluation reports to manage them here.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-surface overflow-hidden shadow-sm">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-border bg-surface/50 text-faint font-semibold uppercase tracking-wider text-[10px]">
              <tr>
                <th className="px-4 py-3">Document Name</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Path</th>
                <th className="px-4 py-3">Size</th>
                <th className="px-4 py-3">Last Modified</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filtered.map((doc) => (
                <tr key={doc.id} className="hover:bg-surface-hover/50 transition-colors">
                  <td className="px-4 py-3 font-semibold text-foreground flex items-center gap-2">
                    <FileText className="size-4 text-brand shrink-0" />
                    <span>{doc.name}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-surface-hover border border-border px-2 py-0.5 text-[10px] font-medium text-foreground capitalize">
                      {doc.category.replace("-", " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-faint font-mono text-[11px]">{doc.path}</td>
                  <td className="px-4 py-3 text-muted">{formatSize(doc.sizeBytes)}</td>
                  <td className="px-4 py-3 text-faint">
                    {new Date(doc.updatedAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
