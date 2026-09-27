"use client";

import { useState, useEffect } from "react";
import { GraduationCap, CheckCircle2, AlertCircle, TrendingUp, Sparkles, BookOpen } from "lucide-react";

type SkillStat = {
  name: string;
  category: "Languages" | "Frameworks" | "Infrastructure & Cloud" | "Databases" | "Methodologies";
  frequency: number;
  inCv: boolean;
  priority: "High" | "Medium" | "Low";
};

export default function UpskillingPage() {
  const [skills, setSkills] = useState<SkillStat[]>([]);
  const [topGaps, setTopGaps] = useState<SkillStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState("all");

  const fetchUpskill = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/upskill");
      const data = await res.json();
      setSkills(data.skills || []);
      setTopGaps(data.topGaps || []);
    } catch {}
    finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUpskill();
  }, []);

  const filtered = skills.filter((s) => {
    if (categoryFilter === "gaps") return !s.inCv && s.frequency > 0;
    if (categoryFilter === "all") return true;
    return s.category === categoryFilter;
  });

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6 animate-in fade-in duration-200">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2.5">
            <GraduationCap className="size-6 text-brand" />
            Skill Demand & Gap Analysis
          </h1>
          <p className="text-xs text-muted mt-1">
            Zero-fabrication skill frequency derived across all evaluated job descriptions vs verified claims in your <code className="text-[11px] font-mono bg-surface-hover px-1 py-0.5 rounded">cv.md</code>.
          </p>
        </div>
      </div>

      {/* Top Gaps Alert */}
      {topGaps.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-950/10 p-4 space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold text-amber-400">
            <AlertCircle className="size-4" />
            Top Skill Gaps Observed in Evaluated Roles
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {topGaps.map((gap) => (
              <span
                key={gap.name}
                className="rounded bg-amber-500/10 border border-amber-500/30 px-2.5 py-1 text-xs font-semibold text-amber-300"
              >
                {gap.name} ({gap.frequency} postings)
              </span>
            ))}
          </div>
          <p className="text-[11px] text-muted">
            If you have verified experience with these technologies, consider adding bullet proof-points to your <code className="font-mono text-foreground">cv.md</code>.
          </p>
        </div>
      )}

      {/* Categories Filter */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {[
          { id: "all", label: "All Skills" },
          { id: "gaps", label: "Missing From CV" },
          { id: "Languages", label: "Languages" },
          { id: "Frameworks", label: "Frameworks" },
          { id: "Infrastructure & Cloud", label: "Cloud & Infra" },
          { id: "Databases", label: "Databases" },
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

      {/* Skills Matrix */}
      {loading ? (
        <div className="p-12 text-center text-sm text-muted">Analyzing skill distribution...</div>
      ) : (
        <div className="rounded-xl border border-border bg-surface overflow-hidden shadow-sm">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-border bg-surface/50 text-faint font-semibold uppercase tracking-wider text-[10px]">
              <tr>
                <th className="px-4 py-3">Skill / Technology</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Demand Frequency</th>
                <th className="px-4 py-3">CV Status</th>
                <th className="px-4 py-3 text-right">Recommendation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filtered.map((skill) => (
                <tr key={skill.name} className="hover:bg-surface-hover/50 transition-colors">
                  <td className="px-4 py-3 font-semibold text-foreground">{skill.name}</td>
                  <td className="px-4 py-3 text-muted">{skill.category}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 bg-surface-hover rounded-full overflow-hidden">
                        <div
                          className="h-full bg-brand"
                          style={{ width: `${Math.min(100, skill.frequency * 20)}%` }}
                        />
                      </div>
                      <span className="text-faint">{skill.frequency} postings</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {skill.inCv ? (
                      <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                        <CheckCircle2 className="size-3" /> In CV
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
                        <AlertCircle className="size-3" /> Missing
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span
                      className={`text-[11px] font-medium ${
                        skill.priority === "High"
                          ? "text-brand font-bold"
                          : skill.priority === "Medium"
                          ? "text-amber-400"
                          : "text-muted"
                      }`}
                    >
                      {skill.inCv ? "Verified" : `${skill.priority} Priority`}
                    </span>
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
