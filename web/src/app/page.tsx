import { pipelineSummary, doctorState } from "@/lib/career-ops";
import { OnboardingBanner } from "@/components/onboarding-banner";
import { OnboardingProgress } from "@/components/home/onboarding-progress";
import { FirstRunHome } from "@/components/home/first-run-home";
import { TodayDashboard } from "@/components/home/today-dashboard";

export const dynamic = "force-dynamic"; // always read fresh local files at request time (never at build — CI has no user data)

export default function Home() {
  const { phase, onboardingNeeded } = doctorState();
  // First run (truly empty install): the CV-upload takeover IS the home — value
  // before commitment. The full dashboard returns once they have a CV or any data.
  if (phase === "first-run") return <FirstRunHome />;

  const { inbox, applications } = pipelineSummary();
  // Established / in-between: the dual-loop retention dashboard. Show the setup
  // banner whenever ANY prereq is missing (mirrors the core doctor.mjs), so a
  // portals-missing user is nudged rather than told "all caught up".
  return (
    <>
      {onboardingNeeded && <OnboardingBanner />}
      {/* The growing-profile panel stays until every prerequisite AND every
          personalization section is theirs — it renders nothing once complete. */}
      <div className="mx-auto max-w-5xl px-6 pt-6">
        <OnboardingProgress />
      </div>
      <TodayDashboard applications={applications} inbox={inbox} inBetween={phase === "in-between"} />
    </>
  );
}
