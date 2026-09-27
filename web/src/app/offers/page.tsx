"use client";

import { useState, useEffect } from "react";
import { Award, DollarSign, TrendingUp, FileText, CheckCircle2, ShieldAlert, Copy, Check } from "lucide-react";

type OfferItem = {
  n: string;
  company: string;
  role: string;
  status: string;
  date: string;
  notes: string;
};

type Observation = {
  date: string;
  company: string;
  role: string;
  comp: string;
};

export default function OffersPage() {
  const [offers, setOffers] = useState<OfferItem[]>([]);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [targetComp, setTargetComp] = useState("$160,000 - $200,000");
  const [loading, setLoading] = useState(true);
  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  // New observation modal
  const [newCompany, setNewCompany] = useState("");
  const [newRole, setNewRole] = useState("");
  const [newBase, setNewBase] = useState("");
  const [newBonus, setNewBonus] = useState("");
  const [newEquity, setNewEquity] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [recording, setRecording] = useState(false);

  const fetchOffers = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/offers");
      const data = await res.json();
      setOffers(data.offers || []);
      setObservations(data.observations || []);
      if (data.targetComp) setTargetComp(data.targetComp);
    } catch {}
    finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOffers();
  }, []);

  const handleRecordComp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCompany) return;
    setRecording(true);
    await fetch("/api/offers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "record",
        company: newCompany,
        role: newRole,
        baseComp: newBase,
        bonus: newBonus,
        equity: newEquity,
        notes: newNotes,
      }),
    });
    setRecording(false);
    setNewCompany("");
    setNewRole("");
    setNewBase("");
    setNewBonus("");
    setNewEquity("");
    setNewNotes("");
    fetchOffers();
  };

  const copyScript = (title: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSection(title);
    setTimeout(() => setCopiedSection(null), 2000);
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6 animate-in fade-in duration-200">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2.5">
            <Award className="size-6 text-brand" />
            Offers, Compensation & Negotiation
          </h1>
          <p className="text-xs text-muted mt-1">
            Offer stage management, salary gap analysis, and anchored negotiation scripts. Powered by <code className="text-[11px] font-mono bg-surface-hover px-1 py-0.5 rounded">data/salary-observations.tsv</code>.
          </p>
        </div>
      </div>

      {/* Target Comp Banner */}
      <div className="rounded-xl border border-brand/30 bg-brand-soft/20 p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <DollarSign className="size-8 text-brand" />
          <div>
            <div className="text-xs text-brand-text font-semibold uppercase tracking-wider">Your Stated Target Compensation</div>
            <div className="text-xl font-bold text-foreground">{targetComp}</div>
          </div>
        </div>
        <div className="text-xs text-muted text-right">
          Configured in <span className="font-mono text-[11px] text-foreground">config/profile.yml</span>
        </div>
      </div>

      {/* Offers & Salary Observations */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Active Offers */}
        <div className="rounded-xl border border-border bg-surface p-5 space-y-4">
          <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
            <Award className="size-4 text-brand" /> Active Tracker Offers ({offers.length})
          </h3>
          {offers.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted">
              No active offers in your tracker yet. When you receive an offer, update its tracker status to "Offer".
            </div>
          ) : (
            <div className="space-y-3">
              {offers.map((off) => (
                <div key={off.n} className="rounded-lg border border-border bg-surface-hover/30 p-3 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <strong className="text-foreground text-sm">{off.company}</strong>
                    <span className="rounded bg-brand px-2 py-0.5 text-[10px] font-bold text-brand-text">
                      {off.status}
                    </span>
                  </div>
                  <div className="text-muted">{off.role}</div>
                  {off.notes && <div className="text-faint text-[11px] mt-1">{off.notes}</div>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Record Comp Observation */}
        <div className="rounded-xl border border-border bg-surface p-5 space-y-4">
          <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
            <TrendingUp className="size-4 text-emerald-400" /> Record Salary / Offer Observation
          </h3>
          <form onSubmit={handleRecordComp} className="space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-muted mb-1">Company *</label>
                <input
                  type="text"
                  required
                  value={newCompany}
                  onChange={(e) => setNewCompany(e.target.value)}
                  className="w-full rounded border border-border bg-surface px-2.5 py-1.5 text-foreground focus:border-brand focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-muted mb-1">Role</label>
                <input
                  type="text"
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                  className="w-full rounded border border-border bg-surface px-2.5 py-1.5 text-foreground focus:border-brand focus:outline-none"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-muted mb-1">Base Salary</label>
                <input
                  type="text"
                  value={newBase}
                  placeholder="e.g. $180k"
                  onChange={(e) => setNewBase(e.target.value)}
                  className="w-full rounded border border-border bg-surface px-2.5 py-1.5 text-foreground focus:border-brand focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-muted mb-1">Bonus</label>
                <input
                  type="text"
                  value={newBonus}
                  placeholder="e.g. 15%"
                  onChange={(e) => setNewBonus(e.target.value)}
                  className="w-full rounded border border-border bg-surface px-2.5 py-1.5 text-foreground focus:border-brand focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-muted mb-1">Equity</label>
                <input
                  type="text"
                  value={newEquity}
                  placeholder="e.g. $40k/yr"
                  onChange={(e) => setNewEquity(e.target.value)}
                  className="w-full rounded border border-border bg-surface px-2.5 py-1.5 text-foreground focus:border-brand focus:outline-none"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={recording}
              className="w-full rounded-lg bg-brand py-1.5 text-xs font-semibold text-white hover:opacity-90"
            >
              {recording ? "Saving..." : "Log Observation"}
            </button>
          </form>
        </div>
      </div>

      {/* Negotiation Scripts */}
      <div className="rounded-xl border border-border bg-surface p-5 space-y-4">
        <h3 className="text-sm font-bold text-foreground">Negotiation Scripts & Anchoring Frameworks</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          {[
            {
              title: "Base Salary Counter-Offer",
              script:
                "Thank you so much for the offer. I am genuinely thrilled about the opportunity to join the team and lead these initiatives. Based on my proven track record of scaling high-throughput systems and current market data for this scope, I was hoping to see a base salary closer to [Target Base]. Is there flexibility on the base compensation?",
            },
            {
              title: "Geographic Discount Defense",
              script:
                "While I understand your standard location-based bands, the value, impact, and architectural scope I will deliver in this role are identical regardless of physical location. Given the market demand for this specialization, I'd appreciate if we could align compensation with the role's national benchmark.",
            },
            {
              title: "Competing Offers Leverage",
              script:
                "I want to be transparent that I am in the final stages with another company offering [Comp range]. However, your team's mission and technical roadmap are my absolute top choice. If we can close the gap to [Target], I would be thrilled to sign immediately.",
            },
            {
              title: "Sign-on Bonus & Equity Lever",
              script:
                "If there is strict rigidity around the base salary ceiling for this level, I would be open to exploring an adjusted sign-on bonus or additional equity grant to bring the first-year total compensation in line with expectations.",
            },
          ].map((item) => (
            <div key={item.title} className="rounded-lg border border-border bg-surface-hover/30 p-4 space-y-2 flex flex-col justify-between">
              <div>
                <div className="font-bold text-foreground">{item.title}</div>
                <div className="text-muted mt-1.5 leading-relaxed bg-surface p-2.5 rounded border border-border/50 text-[11px]">
                  "{item.script}"
                </div>
              </div>
              <div className="pt-2 flex justify-end">
                <button
                  onClick={() => copyScript(item.title, item.script)}
                  className="inline-flex items-center gap-1 text-[11px] text-brand hover:underline font-medium"
                >
                  {copiedSection === item.title ? <Check className="size-3 text-brand" /> : <Copy className="size-3" />}
                  {copiedSection === item.title ? "Copied" : "Copy Script"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
