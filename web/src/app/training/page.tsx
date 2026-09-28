"use client";

import { useState, useEffect } from "react";
import { BookOpen, Plus, CheckCircle2, Clock, Award, ShieldCheck } from "lucide-react";

type Assessment = {
  id: string;
  date: string;
  platform: string;
  subject: string;
  score: string;
  status: "Passed" | "Completed" | "In Progress";
  notes?: string;
};

export default function TrainingPage() {
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  const [platform, setPlatform] = useState("HackerRank");
  const [subject, setSubject] = useState("");
  const [score, setScore] = useState("");
  const [status, setStatus] = useState<Assessment["status"]>("Passed");
  const [notes, setNotes] = useState("");

  const fetchAssessments = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/training");
      const data = await res.json();
      setAssessments(data.assessments || []);
    } catch {}
    finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAssessments();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!platform || !subject) return;

    await fetch("/api/training", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform, subject, score, status, notes }),
    });

    setModalOpen(false);
    setSubject("");
    setScore("");
    setNotes("");
    fetchAssessments();
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6 animate-in fade-in duration-200">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2.5">
            <BookOpen className="size-6 text-brand" />
            Training & Skill Assessments
          </h1>
          <p className="text-xs text-muted mt-1">
            Log technical assessments (HackerRank, CodeSignal, LeetCode) and certificates into <code className="text-[11px] font-mono bg-surface-hover px-1 py-0.5 rounded">data/assessments.tsv</code>.
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-2 rounded-lg bg-brand px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:opacity-90"
        >
          <Plus className="size-4" />
          Log Assessment
        </button>
      </div>

      {loading ? (
        <div className="p-12 text-center text-sm text-muted">Loading assessments...</div>
      ) : assessments.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center bg-surface/20">
          <Award className="size-10 text-faint mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-foreground">No assessments logged</h3>
          <p className="text-xs text-muted mt-1 max-w-sm mx-auto">
            Keep a ledger of your technical screening scores and benchmark certifications.
          </p>
          <button
            onClick={() => setModalOpen(true)}
            className="mt-4 rounded-lg bg-surface-hover border border-border px-3.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface"
          >
            Log your first score
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-surface overflow-hidden shadow-sm">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-border bg-surface/50 text-faint font-semibold uppercase tracking-wider text-[10px]">
              <tr>
                <th className="px-4 py-3">Platform</th>
                <th className="px-4 py-3">Subject / Domain</th>
                <th className="px-4 py-3">Score / Result</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {assessments.map((a) => (
                <tr key={a.id} className="hover:bg-surface-hover/50 transition-colors">
                  <td className="px-4 py-3 font-semibold text-foreground">{a.platform}</td>
                  <td className="px-4 py-3 text-muted">{a.subject}</td>
                  <td className="px-4 py-3 font-mono font-medium text-foreground">{a.score}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                      {a.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-faint">{a.date}</td>
                  <td className="px-4 py-3 text-faint max-w-xs truncate">{a.notes || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-2xl">
            <h3 className="text-base font-bold text-foreground">Log Technical Assessment</h3>
            <form onSubmit={handleAdd} className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">Platform *</label>
                  <select
                    value={platform}
                    onChange={(e) => setPlatform(e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-foreground focus:border-brand focus:outline-none"
                  >
                    <option value="HackerRank">HackerRank</option>
                    <option value="CodeSignal">CodeSignal</option>
                    <option value="LeetCode">LeetCode</option>
                    <option value="Triplebyte">Triplebyte</option>
                    <option value="AWS / Cloud Cert">AWS / Cloud Cert</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">Score / Percentile</label>
                  <input
                    type="text"
                    value={score}
                    placeholder="e.g. 100%, 840/850"
                    onChange={(e) => setScore(e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-foreground focus:border-brand focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted mb-1">Subject / Focus Area *</label>
                <input
                  type="text"
                  required
                  value={subject}
                  placeholder="e.g. Algorithms & Data Structures, Distributed Systems"
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-foreground focus:border-brand focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted mb-1">Notes</label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Key problem types encountered..."
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
                  Save Score
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
