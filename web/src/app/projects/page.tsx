"use client";

import { useState, useEffect } from "react";
import { FolderGit2, Plus, ExternalLink, Tag, TrendingUp, CheckCircle2 } from "lucide-react";

type Project = {
  id: string;
  name: string;
  description: string;
  skills: string[];
  metrics: string;
  link?: string;
};

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newSkills, setNewSkills] = useState("");
  const [newMetrics, setNewMetrics] = useState("");
  const [newLink, setNewLink] = useState("");

  const fetchProjects = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/projects");
      const data = await res.json();
      setProjects(data.projects || []);
    } catch {}
    finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName) return;

    await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newName,
        description: newDesc,
        skills: newSkills,
        metrics: newMetrics,
        link: newLink,
      }),
    });

    setModalOpen(false);
    setNewName("");
    setNewDesc("");
    setNewSkills("");
    setNewMetrics("");
    setNewLink("");
    fetchProjects();
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6 animate-in fade-in duration-200">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2.5">
            <FolderGit2 className="size-6 text-brand" />
            Portfolio & Proof Points
          </h1>
          <p className="text-xs text-muted mt-1">
            Verified projects and quantifiable impact points that feed your tailored CVs and cover letters.
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-2 rounded-lg bg-brand px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:opacity-90"
        >
          <Plus className="size-4" />
          Add Project
        </button>
      </div>

      {loading ? (
        <div className="p-12 text-center text-sm text-muted">Loading projects...</div>
      ) : projects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center bg-surface/20">
          <FolderGit2 className="size-10 text-faint mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-foreground">No portfolio projects logged</h3>
          <p className="text-xs text-muted mt-1 max-w-sm mx-auto">
            Add key repositories, system architectures, or technical achievements to anchor your applications in verified facts.
          </p>
          <button
            onClick={() => setModalOpen(true)}
            className="mt-4 rounded-lg bg-surface-hover border border-border px-3.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface"
          >
            Add your first project
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {projects.map((proj) => (
            <div key={proj.id} className="rounded-xl border border-border bg-surface p-5 space-y-3 shadow-sm flex flex-col justify-between">
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-bold text-base text-foreground">{proj.name}</h3>
                  {proj.link && (
                    <a href={proj.link} target="_blank" rel="noreferrer" className="text-brand hover:underline flex items-center gap-1 text-xs">
                      <ExternalLink className="size-3.5" />
                    </a>
                  )}
                </div>
                <p className="text-xs text-muted leading-relaxed">{proj.description}</p>
                {proj.metrics && (
                  <div className="text-xs font-medium text-emerald-400 bg-emerald-950/20 border border-emerald-500/20 p-2.5 rounded-lg flex items-center gap-2">
                    <TrendingUp className="size-3.5 shrink-0" />
                    <span>{proj.metrics}</span>
                  </div>
                )}
              </div>

              {proj.skills && proj.skills.length > 0 && (
                <div className="pt-3 border-t border-border/60 flex items-center gap-1.5 flex-wrap">
                  {proj.skills.map((s) => (
                    <span key={s} className="rounded bg-surface-hover border border-border px-2 py-0.5 text-[10px] font-medium text-faint">
                      {s}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-2xl">
            <h3 className="text-base font-bold text-foreground">Add Portfolio Project</h3>
            <form onSubmit={handleAdd} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-muted mb-1">Project Name *</label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-foreground focus:border-brand focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted mb-1">Description</label>
                <textarea
                  rows={3}
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="Architectural overview, problem solved..."
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-foreground focus:border-brand focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted mb-1">Quantifiable Metric / Outcome</label>
                <input
                  type="text"
                  value={newMetrics}
                  onChange={(e) => setNewMetrics(e.target.value)}
                  placeholder="e.g. Reduced p99 latency from 450ms to 45ms"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-foreground focus:border-brand focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted mb-1">Skills / Tech Stack (comma separated)</label>
                <input
                  type="text"
                  value={newSkills}
                  onChange={(e) => setNewSkills(e.target.value)}
                  placeholder="TypeScript, Docker, Kafka"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-foreground focus:border-brand focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted mb-1">Repository / Live Link</label>
                <input
                  type="url"
                  value={newLink}
                  onChange={(e) => setNewLink(e.target.value)}
                  placeholder="https://github.com/..."
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-foreground focus:border-brand focus:outline-none"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface-hover"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-brand px-4 py-1.5 text-xs font-semibold text-white hover:opacity-90"
                >
                  Save Project
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
