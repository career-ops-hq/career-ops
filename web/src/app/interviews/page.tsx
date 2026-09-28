"use client";

import { useState, useEffect } from "react";
import {
  CalendarCheck2,
  BookOpen,
  MessageSquare,
  ClipboardList,
  AlertTriangle,
  Play,
  Send,
  Star,
  CheckCircle2,
  Clock,
} from "lucide-react";

type InterviewApp = {
  n: string;
  company: string;
  role: string;
  status: string;
  date: string;
  report: string;
  notes: string;
};

export default function InterviewCenterPage() {
  const [activeTab, setActiveTab] = useState<"rounds" | "plan" | "practice" | "debrief" | "redflags">("rounds");
  const [interviews, setInterviews] = useState<InterviewApp[]>([]);
  const [storyBank, setStoryBank] = useState("");
  const [loading, setLoading] = useState(true);

  // Practice state
  const [practiceQuestion, setPracticeQuestion] = useState(
    "Tell me about a time you had to resolve a critical production outage under tight time constraints."
  );
  const [practiceAnswer, setPracticeAnswer] = useState("");
  const [practiceFeedback, setPracticeFeedback] = useState<any>(null);
  const [submittingPractice, setSubmittingPractice] = useState(false);

  // Debrief state
  const [debriefCompany, setDebriefCompany] = useState("");
  const [debriefRole, setDebriefRole] = useState("");
  const [debriefRound, setDebriefRound] = useState("Technical Screen");
  const [debriefQuestion, setDebriefQuestion] = useState("");
  const [debriefAnswer, setDebriefAnswer] = useState("");
  const [debriefConfidence, setDebriefConfidence] = useState(4);
  const [debriefNotes, setDebriefNotes] = useState("");
  const [debriefSaved, setDebriefSaved] = useState(false);
  const [debriefSubmitting, setDebriefSubmitting] = useState(false);
  const [debriefError, setDebriefError] = useState<string | null>(null);

  // Prep Plan state
  const [planDays, setPlanDays] = useState(5);
  const [planHoursPerDay, setPlanHoursPerDay] = useState(2);
  const [planCompany, setPlanCompany] = useState("");

  const fetchInterviews = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/interviews");
      const data = await res.json();
      setInterviews(data.interviews || []);
      setStoryBank(data.storyBank || "");
      if (data.interviews?.[0]?.company) {
        setDebriefCompany(data.interviews[0].company);
        setDebriefRole(data.interviews[0].role);
        setPlanCompany(data.interviews[0].company);
      }
    } catch {}
    finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInterviews();
  }, []);

  const handlePracticeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!practiceAnswer) return;
    setSubmittingPractice(true);
    try {
      const res = await fetch("/api/interviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "practice-feedback",
          question: practiceQuestion,
          answer: practiceAnswer,
        }),
      });
      const data = await res.json();
      setPracticeFeedback(data.feedback);
    } catch {}
    finally {
      setSubmittingPractice(false);
    }
  };

  const handleDebriefSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!debriefCompany) return;
    setDebriefSubmitting(true);
    setDebriefError(null);
    try {
      const res = await fetch("/api/interviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "debrief",
          company: debriefCompany,
          role: debriefRole,
          round: debriefRound,
          question: debriefQuestion,
          answer: debriefAnswer,
          confidence: debriefConfidence,
          notes: debriefNotes,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setDebriefError(data.error || "Failed to log debrief");
        return;
      }
      setDebriefSaved(true);
      setTimeout(() => setDebriefSaved(false), 3000);
    } catch (err: unknown) {
      setDebriefError(err instanceof Error ? err.message : "Failed to log debrief");
    } finally {
      setDebriefSubmitting(false);
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6 animate-in fade-in duration-200">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2.5">
            <CalendarCheck2 className="size-6 text-brand" />
            Interview Center
          </h1>
          <p className="text-xs text-muted mt-1">
            Structured prep plans, STAR+R simulator, debrief logging, and friction signals. Ground truth synced from <code className="text-[11px] font-mono bg-surface-hover px-1 py-0.5 rounded">interview-prep/</code>.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-border overflow-x-auto pb-px">
        {[
          { id: "rounds", label: "Active Rounds", icon: CalendarCheck2 },
          { id: "plan", label: "Prep Planner", icon: BookOpen },
          { id: "practice", label: "Practice Simulator", icon: MessageSquare },
          { id: "debrief", label: "Debrief Logger", icon: ClipboardList },
          { id: "redflags", label: "Red Flags & Latency", icon: AlertTriangle },
        ].map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap ${
                active
                  ? "border-brand text-brand-text font-bold"
                  : "border-transparent text-muted hover:text-foreground hover:border-border"
              }`}
            >
              <Icon className="size-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* TAB 1: ROUNDS */}
      {activeTab === "rounds" && (
        <div className="space-y-4">
          {loading ? (
            <div className="p-12 text-center text-sm text-muted">Loading active interview rounds...</div>
          ) : interviews.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-12 text-center bg-surface/20">
              <CalendarCheck2 className="size-10 text-faint mx-auto mb-3" />
              <h3 className="text-sm font-semibold text-foreground">No active interviews scheduled</h3>
              <p className="text-xs text-muted mt-1 max-w-sm mx-auto">
                Applications updated to Screen or Interview status in your tracker will automatically appear here.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {interviews.map((item) => (
                <div key={item.n} className="rounded-xl border border-border bg-surface p-4 shadow-sm space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-base font-bold text-foreground">{item.company}</div>
                      <div className="text-xs text-muted font-medium">{item.role}</div>
                    </div>
                    <span className="rounded-full bg-brand-soft border border-brand/30 px-2.5 py-0.5 text-[11px] font-bold text-brand-text capitalize">
                      {item.status}
                    </span>
                  </div>
                  {item.notes && (
                    <div className="text-xs text-faint bg-surface-hover/50 p-2.5 rounded-lg border border-border/40">
                      {item.notes}
                    </div>
                  )}
                  <div className="flex items-center justify-between pt-2 border-t border-border/60 text-xs">
                    <span className="text-faint">App #{item.n}</span>
                    <button
                      onClick={() => {
                        setDebriefCompany(item.company);
                        setDebriefRole(item.role);
                        setActiveTab("debrief");
                      }}
                      className="text-brand hover:underline font-medium"
                    >
                      Log Debrief →
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: PREP PLANNER */}
      {activeTab === "plan" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 rounded-xl border border-border bg-surface p-5 space-y-4">
            <h3 className="text-sm font-bold text-foreground">Study Plan Generator</h3>
            <div>
              <label className="block text-xs font-medium text-muted mb-1">Target Company</label>
              <input
                type="text"
                value={planCompany}
                onChange={(e) => setPlanCompany(e.target.value)}
                placeholder="e.g. Stripe, OpenAI"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-foreground focus:border-brand focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1">Days Until Interview: {planDays} days</label>
              <input
                type="range"
                min="1"
                max="14"
                value={planDays}
                onChange={(e) => setPlanDays(parseInt(e.target.value, 10))}
                className="w-full accent-brand"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1">Study Hours / Day: {planHoursPerDay} hrs</label>
              <input
                type="range"
                min="1"
                max="6"
                value={planHoursPerDay}
                onChange={(e) => setPlanHoursPerDay(parseInt(e.target.value, 10))}
                className="w-full accent-brand"
              />
            </div>
          </div>

          <div className="lg:col-span-2 rounded-xl border border-border bg-surface p-5 space-y-4">
            <h3 className="text-sm font-bold text-foreground">
              {planDays}-Day Time-Blocked Prep Schedule {planCompany && `for ${planCompany}`}
            </h3>
            <div className="space-y-3 text-xs">
              {Array.from({ length: planDays }).map((_, i) => (
                <div key={i} className="rounded-lg border border-border bg-surface-hover/30 p-3 flex items-start gap-3">
                  <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand-text font-bold text-xs">
                    D{i + 1}
                  </div>
                  <div className="flex-1 space-y-1">
                    <div className="font-semibold text-foreground">
                      {i === 0
                        ? "Deep Dive: System Architecture & Core Requirements"
                        : i === 1
                        ? "STAR+R Stories Alignment (Scale, Conflict, Delivery)"
                        : i === 2
                        ? "Live Coding & API Design Practice"
                        : i === planDays - 1
                        ? "Final Mock Run, Questions for Interviewers, Rest"
                        : "Technical Deep-dive & Edge Case Exploration"}
                    </div>
                    <div className="text-faint">
                      Allocated time: {planHoursPerDay} hours ({planHoursPerDay * 60} minutes)
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: PRACTICE SIMULATOR */}
      {activeTab === "practice" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-surface p-5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-brand">Practice Prompt</span>
              <button
                onClick={() => {
                  const sampleQuestions = [
                    "Describe a complex technical decision you made where you had to balance short-term delivery against long-term maintainability.",
                    "Tell me about a time you disagreed with a product manager on engineering scope and how you resolved it.",
                    "Walk me through how you designed a mission-critical distributed service to achieve 99.99% availability.",
                  ];
                  setPracticeQuestion(sampleQuestions[Math.floor(Math.random() * sampleQuestions.length)]);
                  setPracticeFeedback(null);
                }}
                className="text-xs text-brand hover:underline font-medium"
              >
                Next Question ↻
              </button>
            </div>
            <div className="text-base font-semibold text-foreground bg-surface-hover/50 p-4 rounded-lg border border-border">
              "{practiceQuestion}"
            </div>

            <form onSubmit={handlePracticeSubmit} className="space-y-3">
              <label className="block text-xs font-medium text-muted">
                Your Answer (Use the STAR+R methodology: Situation, Task, Action, Result + Reflection):
              </label>
              <textarea
                rows={5}
                required
                value={practiceAnswer}
                onChange={(e) => setPracticeAnswer(e.target.value)}
                placeholder="Situation: At my previous company... Task: I was responsible for... Action: I architected... Result: This reduced latency by 45%..."
                className="w-full rounded-lg border border-border bg-surface p-3 text-xs text-foreground focus:border-brand focus:outline-none"
              />
              <button
                type="submit"
                disabled={submittingPractice}
                className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                <Send className="size-3.5" />
                {submittingPractice ? "Analyzing response..." : "Analyze Answer"}
              </button>
            </form>
          </div>

          {practiceFeedback && (
            <div className="rounded-xl border border-brand/30 bg-brand-soft/20 p-5 space-y-3 animate-in fade-in">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-foreground flex items-center gap-2">
                  <Star className="size-4 text-brand" /> Analysis & Feedback
                </h4>
                <span className="rounded bg-brand px-2 py-0.5 text-[11px] font-bold text-brand-text">
                  Rating: {practiceFeedback.score}
                </span>
              </div>
              <div className="space-y-2 text-xs text-foreground">
                <div className="font-semibold text-brand-text">Recommendations for improvement:</div>
                <ul className="list-disc pl-4 space-y-1 text-muted">
                  {practiceFeedback.improvements?.map((imp: string, i: number) => (
                    <li key={i}>{imp}</li>
                  ))}
                </ul>
                <div className="mt-3 pt-3 border-t border-border/40 text-faint">
                  <strong>Interviewer follow-up question:</strong> "{practiceFeedback.followUpQuestion}"
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: DEBRIEF LOGGER */}
      {activeTab === "debrief" && (
        <div className="rounded-xl border border-border bg-surface p-6 max-w-2xl mx-auto space-y-4">
          <h3 className="text-base font-bold text-foreground">Post-Interview Debrief</h3>
          <p className="text-xs text-muted">
            Record asked technical/behavioral questions while fresh. Saved to <code className="font-mono bg-surface-hover px-1 py-0.5 rounded text-[11px]">interview-prep/{'{company}'}-debrief.md</code>.
          </p>

          <form onSubmit={handleDebriefSubmit} className="space-y-3 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-muted mb-1">Company *</label>
                <input
                  type="text"
                  required
                  value={debriefCompany}
                  onChange={(e) => setDebriefCompany(e.target.value)}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-foreground focus:border-brand focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted mb-1">Round / Stage</label>
                <input
                  type="text"
                  value={debriefRound}
                  onChange={(e) => setDebriefRound(e.target.value)}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-foreground focus:border-brand focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-muted mb-1">Questions Asked by Interviewer</label>
              <textarea
                rows={3}
                value={debriefQuestion}
                onChange={(e) => setDebriefQuestion(e.target.value)}
                placeholder="List technical questions, architecture prompts, or behavioral questions..."
                className="w-full rounded-lg border border-border bg-surface p-3 text-xs text-foreground focus:border-brand focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-muted mb-1">My Response & Areas of Confidence</label>
              <textarea
                rows={3}
                value={debriefAnswer}
                onChange={(e) => setDebriefAnswer(e.target.value)}
                placeholder="Summarize what went well and what you could sharpen..."
                className="w-full rounded-lg border border-border bg-surface p-3 text-xs text-foreground focus:border-brand focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-muted mb-1">Confidence Score: {debriefConfidence} / 5</label>
              <input
                type="range"
                min="1"
                max="5"
                value={debriefConfidence}
                onChange={(e) => setDebriefConfidence(parseInt(e.target.value, 10))}
                className="w-full accent-brand"
              />
            </div>

            {debriefError && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-400">
                {debriefError}
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-emerald-400 font-medium">{debriefSaved && "✓ Debrief logged successfully!"}</span>
              <button
                type="submit"
                disabled={debriefSubmitting}
                className="rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {debriefSubmitting ? "Saving..." : "Save Debrief"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* TAB 5: RED FLAGS */}
      {activeTab === "redflags" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-surface p-5 space-y-3">
            <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
              <AlertTriangle className="size-4 text-amber-400" />
              Recruiting Friction & Latency Signal Watch
            </h3>
            <p className="text-xs text-muted">
              Signals derived from post-interview latency and process quality markers.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <div className="rounded-lg border border-border bg-surface/50 p-3 text-xs space-y-1">
                <div className="font-semibold text-foreground">Post-Interview Ghosting Watch</div>
                <div className="text-faint">
                  Flags companies where silence exceeds 30 days after an active round.
                </div>
              </div>
              <div className="rounded-lg border border-border bg-surface/50 p-3 text-xs space-y-1">
                <div className="font-semibold text-foreground">Process Quality & Friction</div>
                <div className="text-faint">
                  Monitors multi-round take-homes, unexplained rescheduling, or scope creep.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
