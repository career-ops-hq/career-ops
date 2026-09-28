import { Suspense } from "react";
import { FollowupsView } from "@/components/followups/followups-view";

export const dynamic = "force-dynamic"; // cadence is computed fresh per request

export default function FollowupsPage() {
  return (
    <Suspense>
      <FollowupsView />
    </Suspense>
  );
}
