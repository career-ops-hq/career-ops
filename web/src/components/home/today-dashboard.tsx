"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, CircleHelp, Sparkles, ArrowRight, Undo2, X } from "lucide-react";
import { instrumentSerif } from "@/lib/fonts";
import { HeroGlow } from "@/components/hero-glow";
import type { Application, InboxJob } from "@/lib/career-ops";
import type { DiscoveredOffer } from "@/lib/explore";
import { DiscoveryCard } from "@/components/explore/discovery-card";
import { FollowUpCard, type FollowUp } from "@/components/home/follow-up-card";
import { DecisionCard } from "@/components/home/decision-card";
import type { CardReason } from "@/lib/machine-summary.mjs";
import { QuickEvaluate } from "@/components/quick-evaluate";
import { FollowupsDueSectionSkeleton } from "@/components/page-loading-skeletons";
import { scoreNum } from "@/lib/format";
import { undoStatus } from "@/lib/pipeline-status.mjs";
import { pickAwaitingDecision, groupAwaiting } from "@/lib/home/awaiting.mjs";
import { companyPresentation } from "@/lib/company-presentation.mjs";
import { resolveHeroState, mayClaimAllClear, showsQueue, missingSourceLabel, displayCounts } from "@/lib/home/hero-state.mjs";

// The retention "Today": a dual-loop action queue (the maintainer's
// "N new matches this week · M follow-ups due"). SUPPLY loop = fresh free-scan
// matches (zero tokens, /api/whats-new); DEMAND loop = follow-ups due
// (/api/followups). Each item one-tap actionable. Home stays a VIEW over the
// canonical files — every action dispatches a real registry action / route.
export function TodayDashboard({
  applications,
  reasons,
  legitimacy,
  inbox,
  inBetween,
}: {
  applications: Application[];
  reasons: Record<string, CardReason>;
  /** Block-G legitimacy per report number, read by the page from each report. */
  legitimacy: Record<string, string>;
  inbox: Pick<InboxJob, "url" | "done">[];
  inBetween: boolean;
}) {
  const [followups, setFollowups] = useState<FollowUp[]>([]);
  const [overdue, setOverdue] = useState(0);
  const [followupsLoading, setFollowupsLoading] = useState(true);
  const [followupsError, setFollowupsError] = useState(false);
  const [followupsEnabled, setFollowupsEnabled] = useState(true);
  const [upcoming, setUpcoming] = useState<FollowUp[]>([]);
  const [fresh, setFresh] = useState<DiscoveredOffer[]>([]);
  const [freshCount, setFreshCount] = useState(0);
  const [freshLoading, setFreshLoading] = useState(true);
  const [freshError, setFreshError] = useState(false);
  const [decisionUndo, setDecisionUndo] = useState<{ n: string; label: string; busy?: boolean; error?: string } | null>(null);
  const requestGeneration = useRef(0);
  const router = useRouter();
  const dateLabel = useMemo(() => new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }), []);

  const refetch = useCallback(() => {
    const generation = ++requestGeneration.current;
    const isLatest = () => generation === requestGeneration.current;
    setFollowupsLoading(true);
    setFollowupsError(false);
    fetch("/api/followups")
      .then((r) => {
        if (!r.ok) throw new Error("Follow-ups request failed");
        return r.json();
      })
      .then((d) => {
        if (!isLatest()) return;
        // The cadence route reports engine failures as HTTP 200 with
        // available:false; that is unavailable, not an empty action queue.
        if (d.available === false) throw new Error("Follow-ups unavailable");
        // /api/followups already filters to urgency 'urgent'/'overdue' — due
        // now, never 'waiting'/'cold' (#86). Both count toward "due"; a
        // missing metadata.overdue must read as 0 due, never as "every entry
        // is overdue" (the old `?? d.entries?.length` fallback).
        setFollowups(Array.isArray(d.entries) ? d.entries : []);
        setOverdue((d.metadata?.overdue ?? 0) + (d.metadata?.urgent ?? 0));
        setFollowupsEnabled(d.followupsEnabled !== false);
        setUpcoming(Array.isArray(d.upcoming) ? d.upcoming : []);
      })
      .catch(() => { if (isLatest()) setFollowupsError(true); })
      .finally(() => { if (isLatest()) setFollowupsLoading(false); });
    setFreshLoading(true);
    setFreshError(false);
    fetch("/api/whats-new")
      .then((r) => {
        if (!r.ok) throw new Error("Fresh matches request failed");
        return r.json();
      })
      .then((d) => {
        if (!isLatest()) return;
        const offers = Array.isArray(d.offers) ? d.offers : [];
        const count = Number(d.count);
        setFresh(offers);
        setFreshCount(Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : offers.length);
      })
      .catch(() => { if (isLatest()) setFreshError(true); })
      .finally(() => { if (isLatest()) setFreshLoading(false); });
  }, []);

  useEffect(() => {
    refetch();
    // A worker (evaluate/pdf) just wrote a real tracker row — refresh the server
    // snapshot (applications/inbox props) + the client loops so the freshly-scored
    // role appears in "Awaiting your decision" without a manual reload.
    const onDone = () => {
      router.refresh();
      refetch();
    };
    window.addEventListener("co-job-done", onDone);
    return () => {
      window.removeEventListener("co-job-done", onDone);
      requestGeneration.current += 1;
    };
  }, [refetch, router]);

  // A Skip or Applied click removes its card on refresh, so the undo lives here.
  useEffect(() => {
    if (!decisionUndo || decisionUndo.busy || decisionUndo.error) return;
    const t = setTimeout(() => setDecisionUndo((current) => (current === decisionUndo ? null : current)), 5000);
    return () => clearTimeout(t);
  }, [decisionUndo]);

  const undoDecision = async (notice: { n: string; label: string }) => {
    setDecisionUndo({ ...notice, busy: true });
    try {
      await undoStatus(notice.n);
      setDecisionUndo(null);
      router.refresh();
    } catch (cause) {
      setDecisionUndo({ ...notice, error: cause instanceof Error ? cause.message : "Could not undo. Please try again." });
    }
  };

  // Awaiting decision: scored (Evaluated) but no terminal status yet. The
  // ordering lives in lib/home/awaiting.mjs so it can be tested — see the file
  // for why "first six in the array" was a bug waiting for #3529.
  const awaiting = useMemo(() => pickAwaitingDecision(applications, scoreNum), [applications]);
  // With the legitimacy, a flagged posting is grouped as the report page
  // labels it (#5300), so "Apply next" below never points at one.
  const awaitingGroups = useMemo(() => groupAwaiting(awaiting, (a) => legitimacy[a.n]), [awaiting, legitimacy]);
  const recommended = awaitingGroups.find(([label]) => label === "Recommended")?.[1] ?? [];

  const newThisWeek = freshCount;
  const dataLoading = followupsLoading || freshLoading;
  const dataError = followupsError || freshError;
  // Derived from the flags refetch() already maintains — no second fetch loop
  // and no second source of truth. The only thing added is the distinction
  // dataError cannot make: a failure with known work still has a queue to show.
  const heroState = resolveHeroState({
    followupsLoading,
    freshLoading,
    followupsError,
    freshError,
    overdue,
    newThisWeek,
    awaitingCount: awaiting.length,
  });
  const allClear = mayClaimAllClear(heroState);
  const missingSources = missingSourceLabel({ followupsError, freshError });
  // Printed instead of the raw state: refetch() leaves the previous count in
  // place when a source fails, so `overdue` can still hold a number from before
  // the outage. See displayCounts().
  const shown = displayCounts({ followupsError, freshError, overdue, newThisWeek });
  const inboxUrls = useMemo(() => new Set(inbox.map((j) => j.url)), [inbox]);

  return (
    <div className="mx-auto max-w-5xl px-6 py-10 max-sm:pb-24">
      <section className="dot-bg relative overflow-hidden rounded-2xl border border-border bg-surface/40 px-7 py-10 md:px-10 md:py-12">
        <HeroGlow />
        {/* Readability scrim between the animated glow (z-0) and the copy (z-10). */}
        <div aria-hidden className="pointer-events-none absolute inset-0 z-[1] bg-surface/55 backdrop-blur-[2px] dark:bg-background/45" />
        <div className="relative z-10">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">
            <span className="text-faint">//</span> today · <span className="tabular-nums">{dateLabel}</span>
          </p>
          <h1 className={`${instrumentSerif.className} mt-3 text-4xl leading-[1.05] text-landing md:text-5xl`}>
            {heroState === "loading" ? (
              <>Your career queue is loading.</>
            ) : heroState === "unavailable" ? (
              <>Some updates are unavailable.</>
            ) : allClear ? (
              <>You&apos;re all caught up.</>
            ) : showsQueue(heroState) ? (
              <>
                {shown.newThisWeek > 0 && (
                  <>
                    <span className="text-brand-text tabular-nums">{shown.newThisWeek}</span> new match{shown.newThisWeek === 1 ? "" : "es"} this week
                  </>
                )}
                {shown.newThisWeek > 0 && shown.overdue > 0 && <span className="text-faint"> · </span>}
                {shown.overdue > 0 && (
                  <>
                    <span className="text-brand-text tabular-nums">{shown.overdue}</span> follow-up{shown.overdue === 1 ? "" : "s"} due
                  </>
                )}
                {/* queue-partial with work known only from the server snapshot:
                    both loops are down but the pipeline still has decisions
                    waiting, so the queue is real while neither count is. */}
                {shown.newThisWeek === 0 && shown.overdue === 0 && <>Your queue is waiting.</>}
              </>
            ) : (
              <>Your queue is waiting.</>
            )}
          </h1>
          <p className="mt-4 max-w-xl text-sm text-muted">
            {heroState === "unavailable"
              ? "We couldn't load all of today's updates. Try again."
              : heroState === "queue-partial"
                ? `${missingSources} could not be read, so this may be missing work. What loaded is below.`
                : allClear
                  ? "I'll keep scanning the market in the background and surface anything that fits."
                  : followupsEnabled
                    ? "Your action queue for today — discovery and follow-ups, in one place."
                    : "Your action queue for today, in one place."}
          </p>
          <div className="mt-6 flex flex-wrap gap-2.5">
            <Link href="/explore" className="inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-medium text-brand-foreground transition hover:bg-brand-200 max-sm:min-h-[44px]">
              Find new roles <ArrowRight className="size-4" />
            </Link>
            <Link href="/pipeline" className="inline-flex items-center gap-2 rounded-full border border-border px-5 py-2.5 text-sm font-medium text-foreground transition hover:border-brand/40 hover:text-brand-text max-sm:min-h-[44px]">
              Open pipeline
            </Link>
          </div>
          {inBetween && <QuickEvaluate />}
        </div>
      </section>

      {dataError && !dataLoading && (
        <div role="alert" className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface/40 px-5 py-4 text-sm text-muted">
          <p>{missingSources} could not be loaded.</p>
          <button type="button" onClick={refetch} className="font-medium text-brand-text hover:underline">Retry updates</button>
        </div>
      )}

      {/* A. Follow-ups due (demand loop) */}
      {followupsLoading ? (
        <FollowupsDueSectionSkeleton />
      ) : followupsError ? (
        null
      ) : followups.length > 0 ? (
        <Section icon={Bell} title="Follow-ups due" hint="Keep your applications alive — a nudge beats silence">
          <div className="grid gap-2.5">
            {followups.map((f) => (
              // Refetch (not a local decrement) so the parent's followups/upcoming
              // stay in sync with the server. Logging the LAST due item must flip this
              // section over to "Upcoming" instead of leaving it empty.
              <FollowUpCard key={`${f.num}-${f.company}`} followup={f} onLogged={refetch} />
            ))}
          </div>
        </Section>
      ) : null}

      {!followupsLoading && !followupsError && upcoming.length > 0 && (
        <Section icon={Bell} title="Upcoming" hint="Not due yet">
          <ul className="grid gap-2">
            {upcoming.map((item) => (
              <li key={`${item.num ?? item.company}-${item.nextFollowupDate ?? ""}`}>
                <Link
                  href={item.num != null ? `/pipeline/${item.num}` : "/followups"}
                  className="text-sm text-muted hover:text-brand-text"
                >
                  <span className="font-medium text-foreground">{item.company}</span>
                  {item.role ? <span> · {item.role}</span> : null}
                  {item.nextFollowupDate ? <span className="text-faint"> · {item.nextFollowupDate}</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* B. Awaiting your decision */}
      {awaiting.length > 0 && (
        <Section icon={CircleHelp} title="Awaiting your decision" hint="Best score first">
          {recommended.length > 0 && (
            <Link
              href={`/pipeline/${recommended[0].n}`}
              className="mb-3 inline-flex items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-medium text-brand-foreground transition hover:bg-brand-200 max-sm:min-h-[44px]"
            >
              Apply next · {companyPresentation(recommended[0]).label} {recommended[0].score} <ArrowRight className="size-4" />
            </Link>
          )}
          {awaitingGroups.map(([label, group]) => (
            <div key={label} className="mb-3">
              <h3 className="mb-2 text-xs font-medium text-faint">{label}</h3>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {group.map((a) => (
                  <DecisionCard
                    key={a.n}
                    app={a}
                    reason={reasons[a.n]}
                    onDecided={(status) => {
                      const company = companyPresentation(a).label;
                      setDecisionUndo({ n: a.n, label: status === "Applied" ? `Marked ${company} applied` : `Skipped ${company}` });
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
        </Section>
      )}

      {/* C. Fresh matches this week (supply loop) */}
      {!freshError && fresh.length > 0 && (
        <Section icon={Sparkles} title="Fresh matches this week" hint="Found by your free scans · 0 tokens">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {fresh.slice(0, 6).map((o) => (
              <DiscoveryCard key={o.url} offer={o} inPipeline={inboxUrls.has(o.url)} />
            ))}
          </div>
          {fresh.length > 6 && (
            <Link href="/explore?view=fresh" className="mt-3 inline-flex items-center text-sm text-muted transition hover:text-brand-text max-sm:min-h-[44px]">
              See all {freshCount} →
            </Link>
          )}
        </Section>
      )}

      {allClear && upcoming.length === 0 && (
        <div className="mt-8 rounded-2xl border border-border bg-surface/30 px-6 py-10 text-center">
          <Sparkles className="mx-auto size-6 text-brand-text" />
          <p className="mx-auto mt-3 max-w-md text-sm text-muted">
            Nothing needs you right now. Run a <Link href="/explore" className="text-brand-text hover:underline">free scan</Link> to surface this week&apos;s roles, or check your <Link href="/pipeline" className="text-brand-text hover:underline">pipeline</Link>.
          </p>
        </div>
      )}

      {decisionUndo && (
        <div className="fixed inset-x-0 bottom-32 z-40 flex justify-center px-4 sm:bottom-6">
          <div className="inline-flex max-w-full flex-wrap items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-2 text-sm shadow-lg">
            <div className="min-w-0 flex-1 break-words">
              <span className="text-muted" role="status">{decisionUndo.label}</span>
              {decisionUndo.error && <p role="alert" className="text-red-600 dark:text-red-400">{decisionUndo.error}</p>}
            </div>
            <button type="button" onClick={() => void undoDecision(decisionUndo)} disabled={decisionUndo.busy} aria-busy={Boolean(decisionUndo.busy)} className="inline-flex shrink-0 items-center gap-1 font-medium text-brand-text disabled:opacity-50 max-sm:min-h-[44px]">
              <Undo2 className="size-3.5" /> {decisionUndo.busy ? "Undoing…" : decisionUndo.error ? "Retry undo" : "Undo"}
            </button>
            {decisionUndo.error && (
              <button type="button" onClick={() => setDecisionUndo(null)} aria-label="Dismiss" className="inline-flex shrink-0 items-center text-faint hover:text-muted max-sm:min-h-[44px] max-sm:min-w-[44px] max-sm:justify-center">
                <X className="size-3.5" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ icon: Icon, title, hint, children }: { icon: React.ComponentType<{ className?: string }>; title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="size-4 text-brand-text" />
        <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted">{title}</h2>
        <span className="text-xs text-faint">· {hint}</span>
      </div>
      {children}
    </section>
  );
}
