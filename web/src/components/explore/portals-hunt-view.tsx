"use client";

import { Building2 } from "lucide-react";
import { ApplyBackdrop } from "@/components/apply/apply-backdrop";
import { instrumentSerif } from "@/lib/fonts";
import { useCountUp } from "./discovering-state";
import { HUNT_VIEW_STYLE } from "./ai-hunt-view";
import { AiHuntTrace } from "./ai-hunt-trace";
import { DiscoveryCard } from "./discovery-card";
import { useExplore } from "./explore-provider";

// Same visual language as AiHuntView (shared CSS), different copy/icon: this hunt
// runs the user's OWN configured portals.yml sources, not a freeform open-web query.
export function PortalsHuntView({ cliName }: { cliName?: string }) {
  const { phase, matchCount, aiTrace, aiCost, offers } = useExplore();
  const shown = useCountUp(matchCount);
  const revealing = phase === "revealing";

  return (
    <>
      <ApplyBackdrop intense={!revealing} />
      <div className="co-aihunt">
        <style>{HUNT_VIEW_STYLE}</style>

        <span className="co-aiorb">
          <span className="co-aiorb__glow" />
          <span className="co-aiorb__ring" />
          <Building2 className="size-6 text-brand" />
        </span>

        <div>
          <h2 className={`${instrumentSerif.className} text-3xl leading-tight text-foreground`}>
            {matchCount > 0 ? `${shown} candidate${shown === 1 ? "" : "s"}` : "Searching your portals"}
          </h2>
          <p className="mt-1 text-sm text-muted">
            {revealing ? "found — review them below" : matchCount > 0 ? "found so far · streaming in" : "running your configured job boards & agencies…"}
          </p>
        </div>

        <div className="co-ailedger">
          <Building2 className="size-3.5" />
          {cliName || "your CLI"} · your portals.yml sources
          {aiCost.searches > 0 && <span className="opacity-75">· {aiCost.searches} searches</span>}
          {matchCount > 0 && <span className="opacity-75">· {matchCount} found</span>}
        </div>

        <AiHuntTrace trace={aiTrace} />

        {offers.length > 0 && (
          <div className="mt-2 grid w-full max-w-4xl gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {offers.map((o) => (
              <DiscoveryCard key={o.url} offer={o} inPipeline={false} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
