"use client";

import { useState, useEffect } from "react";
import { MessageSquareReply, Send, CheckCircle2, AlertCircle, HelpCircle, ArrowRight, ShieldCheck } from "lucide-react";

type Candidate = {
  id: string;
  date: string;
  sender?: string;
  subject?: string;
  snippet: string;
  classification: "interview" | "rejection" | "questionnaire" | "offer" | "other";
  matchedCompany?: string;
  matchedAppNumber?: string;
  suggestedStatus?: string;
  confidence: number;
};

export default function RepliesPage() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [sender, setSender] = useState("");
  const [subject, setSubject] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [appliedApp, setAppliedApp] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<{ id: string; error: string } | null>(null);

  const fetchReplies = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/replies");
      const data = await res.json();
      setCandidates(data.candidates || []);
    } catch {}
    finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReplies();
  }, []);

  const handlePasteReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/replies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, sender, subject }),
      });
      const data = await res.json();
      if (data.candidate) {
        setCandidates((prev) => [data.candidate, ...prev]);
        setMessage("");
        setSender("");
        setSubject("");
      }
    } catch {}
    finally {
      setSubmitting(false);
    }
  };

  const applyStatusUpdate = async (candidate: Candidate) => {
    if (!candidate.matchedAppNumber || !candidate.suggestedStatus) return;
    setStatusError(null);
    try {
      const res = await fetch("/api/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          n: candidate.matchedAppNumber,
          status: candidate.suggestedStatus,
          note: `Auto-classified from inbound email (${candidate.classification})`,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setStatusError({
          id: candidate.id,
          error: data.error || `Failed to update status (${res.status})`,
        });
        return;
      }
      setAppliedApp(candidate.id);
      setTimeout(() => setAppliedApp(null), 3000);
    } catch (err: unknown) {
      setStatusError({
        id: candidate.id,
        error: err instanceof Error ? err.message : "Failed to update status",
      });
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6 animate-in fade-in duration-200">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2.5">
            <MessageSquareReply className="size-6 text-brand" />
            Employer Replies & Reply-Watch
          </h1>
          <p className="text-xs text-muted mt-1">
            Parse inbound emails and recruiter messages into classified outcomes. Human confirmation is always required before updating tracker state.
          </p>
        </div>
      </div>

      {/* Paste Inbound Message Box */}
      <div className="rounded-xl border border-border bg-surface p-5 space-y-4">
        <h3 className="text-sm font-bold text-foreground">Paste Inbound Message</h3>
        <form onSubmit={handlePasteReply} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted mb-1">Sender (Optional)</label>
              <input
                type="text"
                placeholder="e.g. recruiter@stripe.com"
                value={sender}
                onChange={(e) => setSender(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-foreground focus:border-brand focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1">Subject (Optional)</label>
              <input
                type="text"
                placeholder="e.g. Next steps with Stripe"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-foreground focus:border-brand focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted mb-1">Email Body / Message Text *</label>
            <textarea
              rows={4}
              required
              placeholder="Paste email content here..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface p-3 text-xs text-foreground focus:border-brand focus:outline-none"
            />
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              <Send className="size-3.5" />
              {submitting ? "Classifying..." : "Analyze & Classify"}
            </button>
          </div>
        </form>
      </div>

      {/* Candidates List */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-foreground">Classified Messages ({candidates.length})</h3>
        {loading ? (
          <div className="p-12 text-center text-sm text-muted">Loading replies...</div>
        ) : candidates.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-12 text-center bg-surface/20">
            <MessageSquareReply className="size-10 text-faint mx-auto mb-3" />
            <h4 className="text-sm font-semibold text-foreground">No replies recorded</h4>
            <p className="text-xs text-muted mt-1 max-w-sm mx-auto">
              Paste incoming interview invites, take-home questionnaires, or status updates above.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {candidates.map((c) => (
              <div
                key={c.id}
                className="rounded-xl border border-border bg-surface p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-sm"
              >
                <div className="space-y-1.5 flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                        c.classification === "interview"
                          ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-400"
                          : c.classification === "offer"
                          ? "bg-brand-soft border border-brand/30 text-brand-text"
                          : c.classification === "rejection"
                          ? "bg-red-500/10 border border-red-500/30 text-red-400"
                          : "bg-surface-hover border border-border text-foreground"
                      }`}
                    >
                      {c.classification} ({Math.round(c.confidence * 100)}% confidence)
                    </span>
                    {c.matchedCompany && (
                      <span className="text-xs font-bold text-foreground">
                        Matched: {c.matchedCompany} {c.matchedAppNumber && `(App #${c.matchedAppNumber})`}
                      </span>
                    )}
                    <span className="text-[11px] text-faint">{c.date}</span>
                  </div>
                  {c.subject && <div className="text-xs font-semibold text-foreground">{c.subject}</div>}
                  <div className="text-xs text-muted leading-relaxed line-clamp-2">{c.snippet}</div>
                </div>

                {c.matchedAppNumber && c.suggestedStatus && (
                  <div className="shrink-0 flex flex-col items-end gap-1.5">
                    <button
                      onClick={() => applyStatusUpdate(c)}
                      className="flex items-center gap-1.5 rounded-lg bg-surface-hover border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-brand-soft hover:text-brand-text transition-colors"
                    >
                      {appliedApp === c.id ? (
                        <>
                          <CheckCircle2 className="size-3.5 text-brand" />
                          Updated!
                        </>
                      ) : (
                        <>
                          <span>Sync status to <strong>{c.suggestedStatus}</strong></span>
                          <ArrowRight className="size-3" />
                        </>
                      )}
                    </button>
                    {statusError?.id === c.id && (
                      <span className="text-[11px] text-red-400">{statusError.error}</span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
