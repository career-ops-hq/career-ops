import { readApplications, readInbox, requestReportReader, doctorState } from "@/lib/career-ops";
import { pickAwaitingDecision } from "@/lib/home/awaiting.mjs";
import { cardReason } from "@/lib/machine-summary.mjs";
import type { CardReason } from "@/lib/machine-summary.mjs";
import { todaySnapshot } from "@/lib/home/today-snapshot.mjs";
import { homeLead, showFirstRunHome } from "@/lib/home/home-lead.mjs";
import { scoreNum, parseReport } from "@/lib/format";
import { reportNumberFor } from "@/lib/apply-checklist.mjs";
import { readCvDiskForRows } from "@/lib/read-cv-disk";
import { applyPostingUrl } from "@/lib/posting-url.mjs";
import { OnboardingBanner } from "@/components/onboarding-banner";
import { OnboardingProgress } from "@/components/home/onboarding-progress";
import { FirstRunHome } from "@/components/home/first-run-home";
import { TodayDashboard } from "@/components/home/today-dashboard";

export const dynamic = "force-dynamic"; // always read fresh local files at request time (never at build — CI has no user data)

export default async function Home() {
  const snapshot = { applications: readApplications(), inbox: readInbox() };
  const { phase, onboardingNeeded } = doctorState(snapshot);
  // First run (truly empty install): the CV-upload takeover IS the home — value
  // before commitment. The full dashboard returns once they have a CV or any data.
  if (showFirstRunHome(phase, snapshot.inbox.length)) return <FirstRunHome />;

  const { inbox, applications } = todaySnapshot(snapshot, scoreNum);
  const reasons: Record<string, CardReason> = {};
  const legitimacy: Record<string, string> = {};
  const postingUrls: Record<string, string> = {};
  const readReport = requestReportReader();
  const awaiting = pickAwaitingDecision(applications, scoreNum);
  for (const app of awaiting) {
    const content = readReport(app)?.content ?? "";
    const reason = cardReason(content);
    if (reason) reasons[app.n] = reason;
    const parsed = parseReport(content);
    if (parsed.legitimacy) legitimacy[app.n] = parsed.legitimacy;
    const reportUrl = parsed.fields.find((field) => field.label === "URL")?.value ?? "";
    postingUrls[app.n] = applyPostingUrl(reportUrl, app.url, app.applyLink);
  }
  const disks = await readCvDiskForRows(
    awaiting.map((app) => ({
      n: app.n,
      company: app.company,
      trackerMarked: (app.pdf ?? "").includes("✅"),
      reportNumber: reportNumberFor(app.n, app, null),
    })),
  );
  const applyFacts: Record<string, { pdfOnDisk: boolean; postingUrl: string }> = {};
  for (const app of awaiting) {
    applyFacts[app.n] = { pdfOnDisk: disks[app.n]?.exists ?? false, postingUrl: postingUrls[app.n] ?? "" };
  }
  // Established / in-between: the dual-loop retention dashboard. Show the setup
  // banner whenever ANY prereq is missing (mirrors the core doctor.mjs), so a
  // portals-missing user is nudged rather than told "all caught up".
  // Once there is a tracker or an inbox, that work leads. Setup stays on the
  // page, under the queue, until the profile panel is complete.
  const dashboard = (
    <TodayDashboard applications={applications} reasons={reasons} legitimacy={legitimacy} inbox={inbox} inBetween={phase === "in-between"} applyFacts={applyFacts} />
  );
  const lead = homeLead(snapshot.applications.length > 0 || snapshot.inbox.length > 0);
  return (
    <>
      {lead === "queue" && dashboard}
      {onboardingNeeded && <OnboardingBanner />}
      {/* The growing-profile panel stays until every prerequisite AND every
          personalization section is theirs — it renders nothing once complete. */}
      <div className="mx-auto max-w-5xl px-6 pt-6">
        <OnboardingProgress />
      </div>
      {lead === "setup" && dashboard}
    </>
  );
}
