"use client";

import { Loader2 } from "lucide-react";
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
.co-ailedger{display:inline-flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:.45rem;border-radius:999px;border:1px solid hsl(26 73% 51% /.3);background:hsl(26 73% 51% /.1);color:hsl(26 78% 43%);padding:.4rem .9rem;font-size:12.5px;font-weight:600}
html.dark .co-ailedger{color:hsl(26 86% 67%)}
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

        <Loader2 className="size-7 animate-spin text-brand" aria-label="Pesquisa em curso" />

        <div>
          <h2 className={`${instrumentSerif.className} text-3xl leading-tight text-foreground`}>
            {matchCount > 0 ? `${shown} ${shown === 1 ? "oferta encontrada" : "ofertas encontradas"}` : "A pesquisar na web pública"}
          </h2>
          <p className="mt-1 text-sm text-muted">
            {revealing ? "Revê os resultados abaixo." : matchCount > 0 ? "A receber mais resultados…" : "A consultar fontes públicas…"}
          </p>
        </div>

        <div className="co-ailedger">
          {cliName || "agente escolhido"} · pesquisa na web
          {aiCost.searches > 0 && <span className="opacity-75">· {aiCost.searches} pesquisas</span>}
          {matchCount > 0 && <span className="opacity-75">· {matchCount} encontradas</span>}
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
