"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import {
  Award,
  DollarSign,
  TrendingUp,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Copy,
  Check,
  Calculator,
  MessageSquare,
  Sparkles,
  ArrowRight,
  Plus,
  Trash2,
  Calendar,
  Building2,
  Briefcase,
  ChevronRight,
  Clock,
  ShieldCheck,
  BarChart3,
  RefreshCw,
  ExternalLink,
  Layers,
  HelpCircle,
} from "lucide-react";

type OfferItem = {
  n: string;
  company: string;
  role: string;
  status: string;
  date: string;
  notes: string;
  link?: string;
};

type Observation = {
  id: number;
  date: string;
  company: string;
  role: string;
  comp: string;
  notes?: string;
  content?: string;
};

export default function OffersPage() {
  const [activeTab, setActiveTab] = useState<"pipeline" | "calculator" | "negotiation" | "observations">("pipeline");
  const [offers, setOffers] = useState<OfferItem[]>([]);
  const [allApps, setAllApps] = useState<any[]>([]);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [targetComp, setTargetComp] = useState("$160,000 - $200,000");
  const [currency, setCurrency] = useState("USD");
  const [minComp, setMinComp] = useState(160000);
  const [maxComp, setMaxComp] = useState(200000);
  const [loading, setLoading] = useState(true);
  const [copiedSection, setCopiedSection] = useState<string | null>(null);
  const [isDemoMode, setIsDemoMode] = useState(false);

  // Modeler state
  const [calcBase, setCalcBase] = useState<number>(175000);
  const [calcBonusPercent, setCalcBonusPercent] = useState<number>(15);
  const [calcEquityAnnual, setCalcEquityAnnual] = useState<number>(35000);
  const [calcSigning, setCalcSigning] = useState<number>(15000);
  const [calcPerks, setCalcPerks] = useState<number>(5000);
  const [calcCompany, setCalcCompany] = useState<string>("Acme Technologies");
  const [calcRole, setCalcRole] = useState<string>("Lead AI Engineer");

  // Negotiation Studio State
  const [negStrategy, setNegStrategy] = useState<"base" | "competing" | "geo" | "equity" | "level">("base");
  const [negTone, setNegTone] = useState<"collaborative" | "assertive" | "strategic">("collaborative");
  const [negRecruiterName, setNegRecruiterName] = useState("Sarah");
  const [negCompanyName, setNegCompanyName] = useState("Acme Technologies");
  const [negRoleName, setNegRoleName] = useState("Lead AI Engineer");
  const [negCurrentOffer, setNegCurrentOffer] = useState("$175,000");
  const [negTargetAsk, setNegTargetAsk] = useState("$195,000");
  const [negCompetingComp, setNegCompetingComp] = useState("$190,000");
  const [negKeyAchievement, setNegKeyAchievement] = useState("scaled data processing pipeline reducing latency by 45%");

  // Observation Form State
  const [newCompany, setNewCompany] = useState("");
  const [newRole, setNewRole] = useState("");
  const [newBase, setNewBase] = useState("");
  const [newBonus, setNewBonus] = useState("");
  const [newEquity, setNewEquity] = useState("");
  const [newSigning, setNewSigning] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [recording, setRecording] = useState(false);
  const [obsSearch, setObsSearch] = useState("");

  // Verified STAR Achievements & AI Generation
  const [verifiedAchievements, setVerifiedAchievements] = useState<any[]>([]);
  const [loadingAchievements, setLoadingAchievements] = useState(false);
  const [generatingAi, setGeneratingAi] = useState(false);
  const [aiResultMetadata, setAiResultMetadata] = useState<{
    source?: string;
    verifiedAchievementsCount?: number;
    cliAvailable?: boolean;
    cliName?: string | null;
  } | null>(null);
  const [generatedLetterOverride, setGeneratedLetterOverride] = useState<string | null>(null);

  const fetchOffers = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/offers");
      const data = await res.json();
      setOffers(data.offers || []);
      setAllApps(data.allApps || []);
      setObservations(data.observations || []);
      if (data.targetComp) setTargetComp(data.targetComp);
      if (data.currency) setCurrency(data.currency);
      if (data.minComp) setMinComp(data.minComp);
      if (data.maxComp) setMaxComp(data.maxComp);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };
  const fetchAchievements = async () => {
    setLoadingAchievements(true);
    try {
      const res = await fetch("/api/negotiate");
      const data = await res.json();
      if (data.achievements && Array.isArray(data.achievements)) {
        setVerifiedAchievements(data.achievements);
        if (data.achievements.length > 0 && !negKeyAchievement) {
          setNegKeyAchievement(data.achievements[0].text);
        }
      }
      if (data.targeting) {
        if (data.targeting.targetComp && !targetComp) setTargetComp(data.targeting.targetComp);
        if (data.targeting.currency && !currency) setCurrency(data.targeting.currency);
      }
    } catch (e) {
      console.error("Failed to load achievements", e);
    } finally {
      setLoadingAchievements(false);
    }
  };

  const handleGenerateAiLetter = async () => {
    setGeneratingAi(true);
    try {
      let activeCliId: string | null = null;
      try {
        activeCliId = JSON.parse(localStorage.getItem("career-ops:config") || "{}").cliId || null;
      } catch {}

      const res = await fetch("/api/negotiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company: negCompanyName,
          role: negRoleName,
          recruiterName: negRecruiterName,
          currentOffer: negCurrentOffer,
          targetAsk: negTargetAsk,
          competingOffer: negCompetingComp,
          achievement: negKeyAchievement,
          keyAchievement: negKeyAchievement,
          strategy: negStrategy,
          tone: negTone,
          cliId: activeCliId,
          useAi: true,
        }),
      });
      const data = await res.json();
      if (data.letter) {
        setGeneratedLetterOverride(data.letter);
        setAiResultMetadata({
          source: data.aiGenerated ? "ai-cli" : "template",
          verifiedAchievementsCount: verifiedAchievements.length,
          cliAvailable: Boolean(data.aiGenerated),
          cliName: activeCliId,
        });
      }
    } catch (e) {
      console.error("AI Generation error:", e);
    } finally {
      setGeneratingAi(false);
    }
  };

  useEffect(() => {
    fetchOffers();
    fetchAchievements();
  }, []);

  // Demo Offers for preview when user hasn't received an offer yet
  const demoOffers: OfferItem[] = useMemo(
    () => [
      {
        n: "042",
        company: "Vercel",
        role: "Senior AI Solutions Engineer",
        status: "Offer",
        date: new Date().toISOString().slice(0, 10),
        notes: "Offer received via hiring manager call. $185k Base + $40k equity/yr. Deadline Friday.",
      },
      {
        n: "038",
        company: "Stripe",
        role: "Staff Platform Engineer",
        status: "Negotiating",
        date: new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10),
        notes: "Counter-offer sent requesting $200k base. Awaiting recruiter reply.",
      },
    ],
    []
  );

  const activeOffersList = useMemo(() => {
    if (offers.length > 0) return offers;
    if (isDemoMode) return demoOffers;
    return [];
  }, [offers, isDemoMode, demoOffers]);

  // Total Comp Calculations
  const calculatedBonus = useMemo(() => Math.round(calcBase * (calcBonusPercent / 100)), [calcBase, calcBonusPercent]);
  const year1TotalComp = useMemo(
    () => calcBase + calculatedBonus + calcEquityAnnual + calcSigning + calcPerks,
    [calcBase, calculatedBonus, calcEquityAnnual, calcSigning, calcPerks]
  );
  const recurringTotalComp = useMemo(
    () => calcBase + calculatedBonus + calcEquityAnnual + calcPerks,
    [calcBase, calculatedBonus, calcEquityAnnual, calcPerks]
  );
  const monthlyTakeHomeEst = useMemo(() => Math.round((calcBase + calculatedBonus) / 12 * 0.72), [calcBase, calculatedBonus]);

  const targetMidpoint = useMemo(() => (minComp + maxComp) / 2, [minComp, maxComp]);
  const compDelta = useMemo(() => year1TotalComp - targetMidpoint, [year1TotalComp, targetMidpoint]);
  const compDeltaPercent = useMemo(
    () => (targetMidpoint > 0 ? ((compDelta / targetMidpoint) * 100).toFixed(1) : "0.0"),
    [compDelta, targetMidpoint]
  );

  const formatCurrency = (amount: number) => {
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: currency && currency.trim() ? currency.trim().toUpperCase() : "USD",
        maximumFractionDigits: 0,
      }).format(amount);
    } catch {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(amount);
    }
  };

  const handleRecordComp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCompany.trim()) return;
    setRecording(true);
    try {
      await fetch("/api/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "record",
          company: newCompany.trim(),
          role: newRole.trim(),
          baseComp: newBase.trim(),
          bonus: newBonus.trim(),
          equity: newEquity.trim(),
          signing: newSigning.trim(),
          notes: newNotes.trim(),
        }),
      });
      setNewCompany("");
      setNewRole("");
      setNewBase("");
      setNewBonus("");
      setNewEquity("");
      setNewSigning("");
      setNewNotes("");
      await fetchOffers();
    } catch (e) {
      console.error(e);
    } finally {
      setRecording(false);
    }
  };

  const [obsError, setObsError] = useState<string | null>(null);

  const handleDeleteObservation = async (obs: Observation) => {
    if (!confirm("Remove this salary observation?")) return;
    setObsError(null);
    try {
      const res = await fetch("/api/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete",
          id: obs.id,
          content: obs.content,
          expected: obs.content,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setObsError(d.error || "Failed to remove observation");
        return;
      }
      await fetchOffers();
    } catch (e) {
      setObsError(e instanceof Error ? e.message : "Failed to remove observation");
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSection(label);
    setTimeout(() => setCopiedSection(null), 2500);
  };

  const loadOfferIntoCalculator = (offer: OfferItem) => {
    setCalcCompany(offer.company);
    setCalcRole(offer.role);
    // Parse any numbers found in notes
    const match = offer.notes.match(/\$?(\d+)[kK]/);
    if (match) {
      setCalcBase(parseInt(match[1], 10) * 1000);
    }
    setActiveTab("calculator");
  };

  const loadOfferIntoNegotiation = (offer: OfferItem) => {
    setNegCompanyName(offer.company);
    setNegRoleName(offer.role);
    setNegCurrentOffer(offer.notes ? offer.notes.slice(0, 30) : "$175,000");
    setActiveTab("negotiation");
  };

  // Dynamic Negotiation Script Engine
  const generatedScript = useMemo(() => {
    if (negStrategy === "base") {
      if (negTone === "assertive") {
        return `Hi ${negRecruiterName},

Thank you for sending over the formal offer for the ${negRoleName} position at ${negCompanyName}. I am excited about the impact this team is poised to make and confident in my ability to immediately lead key initiatives, including having previously ${negKeyAchievement}.

Based on the scope of ownership for this position and current competitive benchmarks for this level, I am seeking a base salary of ${negTargetAsk} (from current offer of ${negCurrentOffer}).

With this adjustment, I am fully aligned and ready to sign the agreement immediately. Let me know if we can finalize this change.

Best regards,`;
      }
      if (negTone === "strategic") {
        return `Hi ${negRecruiterName},

Thank you for discussing the offer details for the ${negRoleName} role. The team's vision and architecture align directly with my core strengths—particularly in high-throughput systems where I ${negKeyAchievement}.

To ensure long-term alignment with the responsibilities and direct business ROI of this role, I would like to propose adjusting the base compensation to ${negTargetAsk}.

I want to make this partnership a resounding success from day one and would be thrilled to commit immediately upon this revision.

Best regards,`;
      }
      return `Hi ${negRecruiterName},

Thank you so much for the offer to join ${negCompanyName} as ${negRoleName}! I am genuinely thrilled about the team and the roadmap we discussed.

I reviewed the initial package, and given my proven track record where I ${negKeyAchievement}, I was hoping we could bring the base salary closer to ${negTargetAsk}.

Is there flexibility within your band to make this adjustment? I would love to get this locked in and join the team!

Warmly,`;
    }

    if (negStrategy === "competing") {
      return `Hi ${negRecruiterName},

Thank you again for extending the offer for the ${negRoleName} role. I want to reiterate that ${negCompanyName} is my absolute first choice because of the technical vision and engineering culture.

In the interest of full transparency, I have received a competing offer at ${negCompetingComp} Total Compensation with another organization whose process is concluding this week.

Because I strongly prefer joining ${negCompanyName}, if we are able to bridge the compensation to ${negTargetAsk}, I will decline the other opportunity and sign your offer today.

Thank you for your advocacy and partnership throughout this process!

Best regards,`;
    }

    if (negStrategy === "geo") {
      return `Hi ${negRecruiterName},

Thank you for outlining the compensation details. I appreciate the team's transparency regarding location-based bands.

Given that the business impact, architectural responsibility, and delivery scope I will own in the ${negRoleName} role are identical regardless of physical location, I would like to request that we benchmark compensation against the national top-of-band target of ${negTargetAsk}.

Given my experience where I ${negKeyAchievement}, I am confident this investment will yield immediate measurable returns for ${negCompanyName}.

Best regards,`;
    }

    if (negStrategy === "equity") {
      return `Hi ${negRecruiterName},

Thank you for the clarity on the fixed base salary ceiling for the ${negRoleName} role. I understand and respect internal leveling parameters.

To bridge the gap between the initial offer (${negCurrentOffer}) and my target of ${negTargetAsk}, would ${negCompanyName} be open to exploring an adjusted Year 1 sign-on bonus or an expanded initial equity / RSU grant?

Structuring the difference via equity strongly aligns my long-term incentives with the company's growth, and would enable me to sign without hesitation.

Best regards,`;
    }

    return `Hi ${negRecruiterName},

Thank you for the comprehensive offer. Reflecting on our technical conversations and the leadership scope required to ensure ${negCompanyName}'s upcoming deliverables succeed, the responsibilities align with a Principal / Staff scope (such as when I ${negKeyAchievement}).

I would like to explore whether we can align the formal leveling and target compensation at ${negTargetAsk} to reflect this tier of ownership.

I am eager to contribute at this high level and look forward to your thoughts.

Best regards,`;
  }, [
    negStrategy,
    negTone,
    negRecruiterName,
    negCompanyName,
    negRoleName,
    negCurrentOffer,
    negTargetAsk,
    negCompetingComp,
    negKeyAchievement,
  ]);

  const filteredObservations = useMemo(() => {
    if (!obsSearch.trim()) return observations;
    const q = obsSearch.toLowerCase();
    return observations.filter(
      (o) =>
        o.company.toLowerCase().includes(q) ||
        o.role.toLowerCase().includes(q) ||
        o.comp.toLowerCase().includes(q) ||
        (o.notes && o.notes.toLowerCase().includes(q))
    );
  }, [observations, obsSearch]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-8 animate-in fade-in duration-200 text-foreground">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center size-9 rounded-xl bg-brand/10 border border-brand/20 text-brand">
              <Award className="size-5" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
                Offers, Compensation & Negotiation
              </h1>
              <p className="text-xs text-muted mt-0.5">
                Dynamic Total Comp modeler, live gap analysis against stated target, and anchored negotiation studio.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={fetchOffers}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-surface text-xs font-medium text-foreground hover:bg-surface-hover transition shadow-sm"
          >
            <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <Link
            href="/profile"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface border border-border text-xs font-medium text-foreground hover:border-brand/40 hover:text-brand transition shadow-sm"
          >
            Target Settings <ChevronRight className="size-3.5" />
          </Link>
        </div>
      </div>

      {/* Dynamic Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Target Comp */}
        <div className="rounded-2xl border border-brand/20 bg-brand-soft/10 p-5 backdrop-blur-sm relative overflow-hidden group">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-brand tracking-wider uppercase">Stated Target Comp</span>
            <DollarSign className="size-4 text-brand" />
          </div>
          <div className="mt-2 text-2xl font-black tracking-tight text-foreground">{targetComp}</div>
          <div className="mt-2 text-[11px] text-muted flex items-center gap-1">
            <ShieldCheck className="size-3 text-emerald-500" /> Ground truth in <code className="font-mono text-[10px] text-foreground bg-surface px-1 py-0.5 rounded">profile.yml</code>
          </div>
        </div>

        {/* Active Offers */}
        <div className="rounded-2xl border border-border bg-surface p-5 backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted tracking-wider uppercase">Active Tracker Offers</span>
            <Award className="size-4 text-amber-500" />
          </div>
          <div className="mt-2 text-2xl font-black tracking-tight text-foreground">
            {activeOffersList.length}
            {isDemoMode && <span className="ml-2 text-xs font-normal text-muted">(Demo)</span>}
          </div>
          <div className="mt-2 text-[11px] text-muted">
            {activeOffersList.length === 0 ? "No offers in tracker currently" : `${activeOffersList.length} offer(s) undergoing review/negotiation`}
          </div>
        </div>

        {/* Total Logged Observations */}
        <div className="rounded-2xl border border-border bg-surface p-5 backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted tracking-wider uppercase">Market Data Points</span>
            <TrendingUp className="size-4 text-indigo-400" />
          </div>
          <div className="mt-2 text-2xl font-black tracking-tight text-foreground">
            {observations.length}
          </div>
          <div className="mt-2 text-[11px] text-muted">
            Logged in <code className="font-mono text-[10px] text-foreground bg-surface px-1 py-0.5 rounded">salary-observations.tsv</code>
          </div>
        </div>

        {/* Live Gap Status */}
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-5 backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 tracking-wider uppercase">Active Negotiation Leverage</span>
            <Sparkles className="size-4 text-emerald-500" />
          </div>
          <div className="mt-2 text-xl font-bold tracking-tight text-foreground flex items-center gap-1.5">
            ROI Anchored
          </div>
          <div className="mt-2 text-[11px] text-muted">
            STAR proof points ready for counter-offers
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center gap-1.5 p-1 bg-surface rounded-xl border border-border w-fit text-xs font-medium overflow-x-auto max-w-full">
        <button
          type="button"
          onClick={() => setActiveTab("pipeline")}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg transition-all ${
            activeTab === "pipeline"
              ? "bg-brand text-white shadow-sm font-semibold"
              : "text-muted hover:text-foreground hover:bg-surface-hover"
          }`}
        >
          <Award className="size-4" />
          Active Offers & Pipeline ({activeOffersList.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("calculator")}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg transition-all ${
            activeTab === "calculator"
              ? "bg-brand text-white shadow-sm font-semibold"
              : "text-muted hover:text-foreground hover:bg-surface-hover"
          }`}
        >
          <Calculator className="size-4" />
          Interactive Comp Modeler
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("negotiation")}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg transition-all ${
            activeTab === "negotiation"
              ? "bg-brand text-white shadow-sm font-semibold"
              : "text-muted hover:text-foreground hover:bg-surface-hover"
          }`}
        >
          <MessageSquare className="size-4" />
          AI Negotiation Studio
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("observations")}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg transition-all ${
            activeTab === "observations"
              ? "bg-brand text-white shadow-sm font-semibold"
              : "text-muted hover:text-foreground hover:bg-surface-hover"
          }`}
        >
          <BarChart3 className="size-4" />
          Observation Ledger ({observations.length})
        </button>
      </div>

      {/* ──────────────── TAB 1: ACTIVE OFFERS & PIPELINE ──────────────── */}
      {activeTab === "pipeline" && (
        <div className="space-y-6 animate-in fade-in duration-150">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                <Award className="size-4 text-brand" /> Offers in Active Tracker
              </h2>
              <p className="text-xs text-muted">
                Synchronized in real-time with <code className="text-foreground bg-surface px-1 py-0.5 rounded font-mono text-[10px]">data/applications.md</code>.
              </p>
            </div>

            {offers.length === 0 && (
              <button
                type="button"
                onClick={() => setIsDemoMode(!isDemoMode)}
                className="text-xs px-2.5 py-1 rounded-md border border-border bg-surface text-muted hover:text-foreground"
              >
                {isDemoMode ? "Disable Preview Mode" : "Preview Sample Offers"}
              </button>
            )}
          </div>

          {activeOffersList.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-surface/40 p-10 text-center space-y-4">
              <div className="flex items-center justify-center size-12 rounded-full bg-surface border border-border mx-auto text-muted">
                <Award className="size-6" />
              </div>
              <div className="max-w-md mx-auto space-y-1">
                <div className="text-sm font-semibold text-foreground">No active offers detected in tracker</div>
                <p className="text-xs text-muted">
                  When you advance an application to the <strong className="text-foreground">Offer</strong> or <strong className="text-foreground">Negotiating</strong> state, it will automatically populate here with real-time deadline warnings and compensation modeling.
                </p>
              </div>
              <div className="flex items-center justify-center gap-3 pt-2">
                <Link
                  href="/tracker"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand text-white text-xs font-semibold hover:brightness-110 shadow-sm"
                >
                  Go to Applications Tracker <ArrowRight className="size-3.5" />
                </Link>
                <button
                  type="button"
                  onClick={() => setIsDemoMode(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-border bg-surface text-foreground text-xs font-semibold hover:bg-surface-hover shadow-sm"
                >
                  <Sparkles className="size-3.5 text-brand" /> Preview Sample Offer Workflow
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {activeOffersList.map((off) => (
                <div
                  key={off.n}
                  className="rounded-2xl border border-border bg-surface p-5 space-y-4 hover:border-brand/40 transition shadow-sm flex flex-col justify-between"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xs font-semibold text-muted flex items-center gap-1.5">
                          <Building2 className="size-3.5 text-brand" />
                          #{off.n} · {off.date}
                        </div>
                        <h3 className="text-lg font-bold text-foreground mt-0.5">{off.company}</h3>
                        <div className="text-xs text-muted flex items-center gap-1 mt-0.5">
                          <Briefcase className="size-3.5" /> {off.role}
                        </div>
                      </div>
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                        {off.status}
                      </span>
                    </div>

                    {off.notes && (
                      <div className="text-xs text-muted bg-surface-hover/50 p-3 rounded-xl border border-border/60 leading-relaxed font-sans">
                        {off.notes}
                      </div>
                    )}
                  </div>

                  <div className="pt-3 border-t border-border flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => loadOfferIntoCalculator(off)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-surface text-xs font-medium text-foreground hover:border-brand/40 hover:text-brand transition"
                    >
                      <Calculator className="size-3.5" /> Model Total Comp
                    </button>
                    <button
                      type="button"
                      onClick={() => loadOfferIntoNegotiation(off)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-semibold hover:brightness-110 shadow-sm transition"
                    >
                      <MessageSquare className="size-3.5" /> Draft Script
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ──────────────── TAB 2: INTERACTIVE COMP MODELER ──────────────── */}
      {activeTab === "calculator" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-in fade-in duration-150">
          {/* Controls Column */}
          <div className="lg:col-span-6 space-y-5 rounded-2xl border border-border bg-surface p-6">
            <div>
              <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                <Calculator className="size-4 text-brand" /> Total Compensation Inputs
              </h2>
              <p className="text-xs text-muted mt-0.5">
                Adjust base, bonus, and equity breakdown to compute real-time Year 1 vs Recurring Total Comp.
              </p>
            </div>

            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-muted font-medium mb-1.5">Company Name</label>
                  <input
                    type="text"
                    value={calcCompany}
                    onChange={(e) => setCalcCompany(e.target.value)}
                    className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-foreground focus:border-brand focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-muted font-medium mb-1.5">Role Title</label>
                  <input
                    type="text"
                    value={calcRole}
                    onChange={(e) => setCalcRole(e.target.value)}
                    className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-foreground focus:border-brand focus:outline-none"
                  />
                </div>
              </div>

              {/* Base Salary Slider */}
              <div className="space-y-2 p-3.5 rounded-xl border border-border bg-surface-hover/30">
                <div className="flex justify-between items-center">
                  <label className="font-semibold text-foreground">Annual Base Salary</label>
                  <span className="font-bold text-brand text-sm">{formatCurrency(calcBase)}</span>
                </div>
                <input
                  type="range"
                  min={80000}
                  max={350000}
                  step={5000}
                  value={calcBase}
                  onChange={(e) => setCalcBase(Number(e.target.value))}
                  className="w-full accent-brand cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-faint">
                  <span>$80k</span>
                  <span>$200k</span>
                  <span>$350k</span>
                </div>
              </div>

              {/* Annual Bonus */}
              <div className="space-y-2 p-3.5 rounded-xl border border-border bg-surface-hover/30">
                <div className="flex justify-between items-center">
                  <label className="font-semibold text-foreground">Target Annual Bonus (%)</label>
                  <span className="font-bold text-foreground text-sm">
                    {calcBonusPercent}% ({formatCurrency(calculatedBonus)})
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={50}
                  step={1}
                  value={calcBonusPercent}
                  onChange={(e) => setCalcBonusPercent(Number(e.target.value))}
                  className="w-full accent-brand cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-faint">
                  <span>0%</span>
                  <span>20%</span>
                  <span>50%</span>
                </div>
              </div>

              {/* Annual Equity / RSUs */}
              <div className="space-y-2 p-3.5 rounded-xl border border-border bg-surface-hover/30">
                <div className="flex justify-between items-center">
                  <label className="font-semibold text-foreground">Equity / RSU Vesting (Annual)</label>
                  <span className="font-bold text-foreground text-sm">{formatCurrency(calcEquityAnnual)}/yr</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={150000}
                  step={2500}
                  value={calcEquityAnnual}
                  onChange={(e) => setCalcEquityAnnual(Number(e.target.value))}
                  className="w-full accent-brand cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-faint">
                  <span>$0</span>
                  <span>$50k</span>
                  <span>$150k</span>
                </div>
              </div>

              {/* Sign-on & Benefits */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="block text-muted font-medium">Sign-on Bonus (Year 1 only)</label>
                  <input
                    type="number"
                    step={1000}
                    value={calcSigning}
                    onChange={(e) => setCalcSigning(Number(e.target.value))}
                    className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-foreground focus:border-brand focus:outline-none"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-muted font-medium">Other Perks / Relocation ($)</label>
                  <input
                    type="number"
                    step={500}
                    value={calcPerks}
                    onChange={(e) => setCalcPerks(Number(e.target.value))}
                    className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-foreground focus:border-brand focus:outline-none"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Real-time Calculation Panel */}
          <div className="lg:col-span-6 space-y-5">
            {/* Year 1 vs Recurring Card */}
            <div className="rounded-2xl border border-brand/30 bg-surface p-6 shadow-sm relative overflow-hidden space-y-6">
              <div>
                <span className="text-xs font-semibold text-brand tracking-wider uppercase">Year 1 Total Compensation</span>
                <div className="mt-1 text-3xl sm:text-4xl font-black tracking-tight text-foreground">
                  {formatCurrency(year1TotalComp)}
                </div>
                <div className="mt-1 text-xs text-muted">
                  Recurring Year 2+ Compensation: <strong className="text-foreground">{formatCurrency(recurringTotalComp)}</strong>
                </div>
              </div>

              {/* Comparison vs Target Gauge */}
              <div className="p-4 rounded-xl border border-border bg-surface-hover/40 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-foreground">Gap vs Target Midpoint ({formatCurrency(targetMidpoint)})</span>
                  <span
                    className={`font-bold inline-flex items-center gap-1 ${
                      compDelta >= 0 ? "text-emerald-500" : "text-amber-500"
                    }`}
                  >
                    {compDelta >= 0 ? "+" : ""}
                    {formatCurrency(compDelta)} ({compDelta >= 0 ? "+" : ""}
                    {compDeltaPercent}%)
                  </span>
                </div>
                <div className="w-full h-2.5 rounded-full bg-border overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      compDelta >= 0 ? "bg-emerald-500" : "bg-amber-500"
                    }`}
                    style={{
                      width: `${Math.min(100, Math.max(10, (year1TotalComp / (targetMidpoint * 1.3)) * 100))}%`,
                    }}
                  />
                </div>
                <div className="text-[11px] text-muted">
                  {compDelta >= 0 ? (
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                      ✓ Exceeds your target compensation range.
                    </span>
                  ) : (
                    <span className="text-amber-600 dark:text-amber-400 font-medium">
                      ⚠️ Sits below target midpoint. Recommended counter ask: {formatCurrency(calcBase + Math.abs(compDelta))}.
                    </span>
                  )}
                </div>
              </div>

              {/* Component Breakdown Stack */}
              <div className="space-y-2.5 text-xs">
                <div className="font-semibold text-foreground">Annual Compensation Breakdown</div>
                <div className="grid grid-cols-2 gap-2 text-muted">
                  <div className="flex justify-between p-2 rounded-lg bg-surface border border-border">
                    <span>Base Salary:</span>
                    <strong className="text-foreground">{formatCurrency(calcBase)}</strong>
                  </div>
                  <div className="flex justify-between p-2 rounded-lg bg-surface border border-border">
                    <span>Target Bonus:</span>
                    <strong className="text-foreground">{formatCurrency(calculatedBonus)}</strong>
                  </div>
                  <div className="flex justify-between p-2 rounded-lg bg-surface border border-border">
                    <span>Equity / RSUs:</span>
                    <strong className="text-foreground">{formatCurrency(calcEquityAnnual)}</strong>
                  </div>
                  <div className="flex justify-between p-2 rounded-lg bg-surface border border-border">
                    <span>Sign-on Bonus:</span>
                    <strong className="text-foreground">{formatCurrency(calcSigning)}</strong>
                  </div>
                </div>

                <div className="p-2.5 rounded-lg bg-surface border border-border text-[11px] text-muted flex items-center justify-between">
                  <span>Est. Monthly Gross / Take-Home (~72%):</span>
                  <span className="font-mono text-foreground font-semibold">
                    ~{formatCurrency(monthlyTakeHomeEst)}/mo
                  </span>
                </div>
              </div>

              {/* Action */}
              <div className="pt-2 flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setNegCompanyName(calcCompany);
                    setNegRoleName(calcRole);
                    setNegCurrentOffer(formatCurrency(year1TotalComp));
                    setNegTargetAsk(formatCurrency(Math.max(year1TotalComp * 1.12, targetMidpoint)));
                    setActiveTab("negotiation");
                  }}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-brand text-white font-semibold text-xs hover:brightness-110 shadow-sm transition"
                >
                  <MessageSquare className="size-4" /> Send to AI Negotiation Studio
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ──────────────── TAB 3: AI NEGOTIATION STUDIO ──────────────── */}
      {activeTab === "negotiation" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-in fade-in duration-150">
          {/* Controls Column */}
          <div className="lg:col-span-5 space-y-4 rounded-2xl border border-border bg-surface p-6">
            <div>
              <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                <MessageSquare className="size-4 text-brand" /> Negotiation Strategy & Levers
              </h2>
              <p className="text-xs text-muted mt-0.5">
                Generate battle-tested counter-offers anchored in verified STAR achievements from your CV.
              </p>
            </div>

            <div className="space-y-3.5 text-xs">
              {/* Strategy Selector */}
              <div>
                <label className="block text-muted font-medium mb-1.5">Strategy / Anchor</label>
                <div className="grid grid-cols-1 gap-1.5">
                  {[
                    { id: "base", label: "Base Salary Counter", desc: "Benchmark & proven track record anchor" },
                    { id: "competing", label: "Competing Offer Leverage", desc: "Declining other offer for immediate close" },
                    { id: "geo", label: "Geographic Discount Defense", desc: "Value-based national parity defense" },
                    { id: "equity", label: "Sign-on & Equity Lever", desc: "Pivoting to equity when base is rigid" },
                    { id: "level", label: "Scope / Level Expansion", desc: "Pushing for Principal/Staff tier" },
                  ].map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        setNegStrategy(s.id as any);
                        setGeneratedLetterOverride(null);
                      }}
                      className={`text-left p-2.5 rounded-xl border transition-all ${
                        negStrategy === s.id
                          ? "border-brand bg-brand-soft/20 text-foreground font-semibold"
                          : "border-border bg-surface hover:bg-surface-hover text-muted"
                      }`}
                    >
                      <div className="font-semibold text-foreground">{s.label}</div>
                      <div className="text-[11px] text-muted">{s.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Tone Selector */}
              <div>
                <label className="block text-muted font-medium mb-1.5">Communication Tone</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {[
                    { id: "collaborative", label: "Enthusiastic" },
                    { id: "strategic", label: "ROI-Anchored" },
                    { id: "assertive", label: "Direct & Firm" },
                  ].map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        setNegTone(t.id as any);
                        setGeneratedLetterOverride(null);
                      }}
                      className={`p-2 rounded-lg border text-center font-medium transition-all ${
                        negTone === t.id
                          ? "border-brand bg-brand text-white"
                          : "border-border bg-surface text-muted hover:text-foreground"
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Fill-in Fields */}
              <div className="grid grid-cols-2 gap-2.5 pt-2">
                <div>
                  <label className="block text-muted mb-1 font-medium">Recruiter / HM Name</label>
                  <input
                    type="text"
                    value={negRecruiterName}
                    onChange={(e) => {
                      setNegRecruiterName(e.target.value);
                      setGeneratedLetterOverride(null);
                    }}
                    className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-foreground focus:border-brand focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-muted mb-1 font-medium">Company Name</label>
                  <input
                    type="text"
                    value={negCompanyName}
                    onChange={(e) => {
                      setNegCompanyName(e.target.value);
                      setGeneratedLetterOverride(null);
                    }}
                    className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-foreground focus:border-brand focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-muted mb-1 font-medium">Current Offer</label>
                  <input
                    type="text"
                    value={negCurrentOffer}
                    onChange={(e) => {
                      setNegCurrentOffer(e.target.value);
                      setGeneratedLetterOverride(null);
                    }}
                    className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-foreground focus:border-brand focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-muted mb-1 font-medium">Target Ask</label>
                  <input
                    type="text"
                    value={negTargetAsk}
                    onChange={(e) => {
                      setNegTargetAsk(e.target.value);
                      setGeneratedLetterOverride(null);
                    }}
                    className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-foreground focus:border-brand focus:outline-none font-bold text-brand"
                  />
                </div>
              </div>

              {negStrategy === "competing" && (
                <div>
                  <label className="block text-muted mb-1 font-medium">Competing Offer Total Comp</label>
                  <input
                    type="text"
                    value={negCompetingComp}
                    onChange={(e) => {
                      setNegCompetingComp(e.target.value);
                      setGeneratedLetterOverride(null);
                    }}
                    className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-foreground focus:border-brand focus:outline-none"
                  />
                </div>
              )}

              {/* Verified STAR Achievement Picker */}
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between">
                  <label className="block text-muted font-medium">
                    Quantified Achievement Anchor (Ground Truth)
                  </label>
                  {loadingAchievements && (
                    <span className="text-[10px] text-muted flex items-center gap-1">
                      <RefreshCw className="size-2.5 animate-spin" /> Loading CV...
                    </span>
                  )}
                </div>
                
                <input
                  type="text"
                  value={negKeyAchievement}
                  onChange={(e) => {
                    setNegKeyAchievement(e.target.value);
                    setGeneratedLetterOverride(null);
                  }}
                  placeholder="e.g. built microservices handling 2M req/day with 99.99% SLA"
                  className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-foreground focus:border-brand focus:outline-none"
                />

                {verifiedAchievements.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    <span className="text-[11px] font-semibold text-muted flex items-center gap-1">
                      <ShieldCheck className="size-3.5 text-emerald-500" />
                      1-Click Verified STAR Anchors (cv.md):
                    </span>
                    <div className="max-h-36 overflow-y-auto space-y-1 pr-1">
                      {verifiedAchievements.slice(0, 5).map((ach) => (
                        <button
                          key={ach.id}
                          type="button"
                          onClick={() => {
                            setNegKeyAchievement(ach.text);
                            setGeneratedLetterOverride(null);
                          }}
                          className={`w-full text-left p-1.5 rounded-lg border text-[11px] transition-all flex items-start gap-1.5 ${
                            negKeyAchievement === ach.text
                              ? "border-emerald-500/50 bg-emerald-500/10 text-foreground font-medium"
                              : "border-border/60 bg-surface/50 hover:bg-surface text-muted"
                          }`}
                        >
                          <CheckCircle2 className={`size-3 mt-0.5 shrink-0 ${ach.verified ? "text-emerald-500" : "text-muted"}`} />
                          <div className="line-clamp-2 leading-tight">{ach.text}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Generated Output Preview */}
          <div className="lg:col-span-7 space-y-4">
            <div className="rounded-2xl border border-border bg-surface p-6 space-y-4 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border pb-3">
                <div>
                  <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                    <Sparkles className="size-4 text-brand" /> Generated Counter-Offer Email
                  </h3>
                  <p className="text-xs text-muted">
                    {aiResultMetadata?.source === "ai-cli"
                      ? `Generated via ${aiResultMetadata.cliName || "CLI"} (Local Read-Only)`
                      : "Anchored to verified CV achievements & deterministic targeting"}
                  </p>
                </div>
                
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleGenerateAiLetter}
                    disabled={generatingAi}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand/10 border border-brand/30 text-brand text-xs font-semibold hover:bg-brand/20 transition shadow-sm"
                  >
                    <Sparkles className={`size-3.5 ${generatingAi ? "animate-spin" : ""}`} />
                    {generatingAi ? "Generating..." : "Generate with AI CLI"}
                  </button>

                  <button
                    type="button"
                    onClick={() => copyToClipboard(generatedLetterOverride || generatedScript, "main-script")}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-semibold hover:brightness-110 shadow-sm transition"
                  >
                    {copiedSection === "main-script" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                    {copiedSection === "main-script" ? "Copied!" : "Copy Full Email"}
                  </button>
                </div>
              </div>

              {/* Provenance and Safety Indicator */}
              <div className="flex items-center justify-between text-[11px] bg-surface-hover/60 px-3 py-1.5 rounded-lg border border-border text-muted">
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="size-3.5 text-emerald-500" />
                  <strong className="text-foreground">Source-of-truth:</strong> {verifiedAchievements.length} verified STAR metric(s) in scope
                </span>
                <span className="font-mono text-[10px] text-faint">
                  Tone: <strong className="text-foreground">{negTone}</strong> · Strategy: <strong className="text-foreground">{negStrategy}</strong>
                </span>
              </div>

              <div className="rounded-xl border border-border bg-surface-hover/30 p-4 font-mono text-xs leading-relaxed text-foreground whitespace-pre-wrap selection:bg-brand selection:text-white">
                {generatedLetterOverride || generatedScript}
              </div>

              {/* Tactical Talking Points */}
              <div className="rounded-xl border border-brand/20 bg-brand-soft/10 p-4 space-y-2 text-xs">
                <div className="font-bold text-brand flex items-center gap-1.5">
                  <ShieldCheck className="size-4" /> Live Negotiation Rules & Rules of Thumb:
                </div>
                <ul className="space-y-1 text-muted list-disc list-inside leading-relaxed text-[11px]">
                  <li>
                    <strong className="text-foreground">Never counter a number verbally on the phone:</strong> Always ask for the offer in writing and take 24–48 hours to evaluate.
                  </li>
                  <li>
                    <strong className="text-foreground">Anchor in high-intent enthusiasm:</strong> Reiterate that they are your top choice before presenting the counter.
                  </li>
                  <li>
                    <strong className="text-foreground">One consolidated ask:</strong> Request base, equity, and signing bonus adjustments in a single conversation, never iteratively.
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ──────────────── TAB 4: OBSERVATION LEDGER ──────────────── */}
      {activeTab === "observations" && (
        <div className="space-y-6 animate-in fade-in duration-150">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                <BarChart3 className="size-4 text-brand" /> Salary & Offer Observations Ledger
              </h2>
              <p className="text-xs text-muted">
                Append-only log of market offers, recruiter ranges, and compensation intel (<code className="text-foreground bg-surface px-1 py-0.5 rounded font-mono text-[10px]">data/salary-observations.tsv</code>).
              </p>
            </div>

            <div className="flex items-center gap-3">
              <input
                type="text"
                value={obsSearch}
                onChange={(e) => setObsSearch(e.target.value)}
                placeholder="Search observations…"
                className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-foreground focus:border-brand focus:outline-none w-48"
              />
            </div>
          </div>

          {obsError && (
            <div className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">
              <AlertTriangle className="size-4 shrink-0" />
              <span>{obsError}</span>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Record Form */}
            <div className="lg:col-span-5 rounded-2xl border border-border bg-surface p-5 space-y-4">
              <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                <Plus className="size-4 text-brand" /> Log New Market Observation
              </h3>
              <form onSubmit={handleRecordComp} className="space-y-3 text-xs">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-muted mb-1 font-medium">Company *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Anthropic"
                      value={newCompany}
                      onChange={(e) => setNewCompany(e.target.value)}
                      className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-foreground focus:border-brand focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-muted mb-1 font-medium">Role</label>
                    <input
                      type="text"
                      placeholder="e.g. AI Engineer"
                      value={newRole}
                      onChange={(e) => setNewRole(e.target.value)}
                      className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-foreground focus:border-brand focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-muted mb-1 font-medium">Base Salary</label>
                    <input
                      type="text"
                      value={newBase}
                      placeholder="$180k"
                      onChange={(e) => setNewBase(e.target.value)}
                      className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-foreground focus:border-brand focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-muted mb-1 font-medium">Bonus</label>
                    <input
                      type="text"
                      value={newBonus}
                      placeholder="15%"
                      onChange={(e) => setNewBonus(e.target.value)}
                      className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-foreground focus:border-brand focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-muted mb-1 font-medium">Equity / RSUs</label>
                    <input
                      type="text"
                      value={newEquity}
                      placeholder="$40k/yr"
                      onChange={(e) => setNewEquity(e.target.value)}
                      className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-foreground focus:border-brand focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-muted mb-1 font-medium">Sign-on Bonus (Optional)</label>
                  <input
                    type="text"
                    value={newSigning}
                    placeholder="e.g. $20k"
                    onChange={(e) => setNewSigning(e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-foreground focus:border-brand focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-muted mb-1 font-medium">Notes / Source</label>
                  <textarea
                    rows={2}
                    value={newNotes}
                    placeholder="Recruiter verbal phone call, confirmed remote band."
                    onChange={(e) => setNewNotes(e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-foreground focus:border-brand focus:outline-none resize-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={recording || !newCompany.trim()}
                  className="w-full rounded-xl bg-brand py-2 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-50 transition shadow-sm"
                >
                  {recording ? "Saving to TSV..." : "Log Observation"}
                </button>
              </form>
            </div>

            {/* List Table / Cards */}
            <div className="lg:col-span-7 space-y-3">
              {filteredObservations.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border bg-surface/40 p-8 text-center text-xs text-muted space-y-2">
                  <div className="font-semibold text-foreground">No salary observations recorded yet</div>
                  <p className="text-muted text-[11px]">
                    Use the form on the left to record salary numbers mentioned by recruiters, offers, or compensation reports.
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {filteredObservations.map((obs) => (
                    <div
                      key={obs.id}
                      className="rounded-xl border border-border bg-surface p-3.5 space-y-2 text-xs hover:border-brand/40 transition flex items-start justify-between gap-3"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <strong className="text-foreground text-sm">{obs.company}</strong>
                          <span className="text-[10px] text-muted font-mono bg-surface-hover px-1.5 py-0.5 rounded">
                            {obs.date}
                          </span>
                        </div>
                        <div className="text-muted text-[11px]">{obs.role || "General Role"}</div>
                        <div className="text-brand font-semibold text-xs mt-1">{obs.comp}</div>
                        {obs.notes && <div className="text-faint text-[11px]">{obs.notes}</div>}
                      </div>

                      <button
                        type="button"
                        onClick={() => handleDeleteObservation(obs)}
                        className="text-muted hover:text-red-500 p-1 rounded transition"
                        title="Delete observation"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
