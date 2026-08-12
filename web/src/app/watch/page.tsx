import type { Metadata } from "next";
import { AutomationDashboard } from "@/components/automation/automation-dashboard";

export const metadata: Metadata = {
  title: "Bevakningar — Career-Ops",
  description: "Självgående jobbsökning och AI-matchning via OmniRoute.",
};

export const dynamic = "force-dynamic";

export default function WatchPage() {
  return <AutomationDashboard />;
}
