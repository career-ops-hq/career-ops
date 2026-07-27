"use client";

import { Sparkles } from "lucide-react";
import { ApplyBackdrop } from "@/components/apply/apply-backdrop";
import { instrumentSerif } from "@/lib/fonts";
import { useCountUp } from "./discovering-state";
import { AiHuntTrace } from "./ai-hunt-trace";
import { DiscoveryCard } from "./discovery-card";
import { useExplore } from "./explore-provider";

// The AI hunt surface — apply-mode polish: an animated orb, a serif headline that
// folds in the live count (no lonely giant "0"), a brand-orange effort ledger
// (NEVER a fake $0), the CONTAINED reasoning panel, and cards materializing below.
const STYLE = `
.co-aihunt{position:relative;z-index:1;display:flex;min-height:72vh;flex-direction:column;align-items:center;gap:1.2rem;padding:2.5rem 1rem 2rem;text-align:center}
.co-aiorb{position:relative;display:grid;place-items:center;width:4rem;height:4rem}
.co-aiorb__glow{position:absolute;inset:0;border-radius:50%;background:hsl(26 80% 55% /.28);filter:blur(18px);animation:co-aiorb-pulse 2.4s ease-in-out infinite}
.co-aiorb__ring{position:absolute;inset:0;border-radius:50%;border:2px solid hsl(26 73% 51% /.25);border-top-color:hsl(26 73% 51%);animation:co-aiorb-spin 1.1s linear infinite}
.co-ailedger{display:inline-flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:.45rem;border-radius:999px;border:1px solid hsl(26 73% 51% /.3);background:hsl(26 73% 51% /.1);color:hsl(26 78% 43%);padding:.4rem .9rem;font-size:12.5px;font-weight:600}
html.dark .co-ailedger{color:hsl(26 86% 67%)}
@keyframes co-aiorb-spin{to{transform:rotate(360deg)}}
@keyframes co-aiorb-pulse{0%,100%{opacity:.6;transform:scale(.92)}50%{opacity:1;transform:scale(1.08)}}
@media(prefers-reduced-motion:reduce){.co-aiorb__ring,.co-aiorb__glow{animation:none}}
`;

export function AiHuntView({ cliName }: { cliName?: string }) {
  const { phase, matchCount, aiTrace, aiCost, offers } = useExplore();
  const shown = useCountUp(matchCount);
  const revealing = phase === "revealing";

  return (
    <>
      <ApplyBackdrop intense={!revealing} />
      <div className="co-aihunt">
        <style>{STYLE}</style>

        <span className="co-aiorb">
          <span className="co-aiorb__glow" />
          <span className="co-aiorb__ring" />
          <Sparkles className="size-6 text-brand" />
        </span>

        <div>
          <h2 className={`${instrumentSerif.className} text-3xl leading-tight text-foreground`}>
            {matchCount > 0 ? `${shown} candidate${shown === 1 ? "" : "s"}` : "Hunting the open web"}
          </h2>
          <p className="mt-1 text-sm text-muted">
            {revealing ? "found — review them below" : matchCount > 0 ? "found so far · streaming in" : "casting across the public web…"}
          </p>
        </div>

        <div className="co-ailedger">
          <Sparkles className="size-3.5" />
          {cliName || "your CLI"} · searching the open web
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
