"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { ApplyBackdrop } from "@/components/apply/apply-backdrop";
import { instrumentSerif } from "@/lib/fonts";
import { ATS_LABEL, ATS_SOURCES, type AtsSource } from "@/lib/explore";
import { useExplore, type SourceState } from "./explore-provider";

const STYLE = `
.co-disc{position:relative;z-index:1;display:flex;min-height:78vh;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:1.6rem;padding:2rem}
.co-disc__counter{font-variant-numeric:tabular-nums;line-height:1;font-size:clamp(4rem,13vw,8rem)}
.co-src{display:flex;flex-wrap:wrap;justify-content:center;gap:.6rem}
.co-src__chip{display:flex;align-items:center;gap:.5rem;border-radius:.8rem;border:1px solid var(--border,hsl(0 0% 50% / .2));padding:.5rem .8rem;min-width:9.5rem;background:color-mix(in srgb, var(--bg) 70%, transparent);transition:opacity .3s,border-color .3s}
.co-src__chip[data-state="queued"]{opacity:.4;border-style:dashed}
.co-src__chip[data-state="active"]{border-color:hsl(26 73% 51% / .45)}
.co-src__orb{width:.55rem;height:.55rem;border-radius:50%;background:hsl(26 80% 55%);box-shadow:0 0 0 0 hsl(26 80% 55% / .5);animation:co-orb 1.4s ease-out infinite}
.co-src__bar{height:3px;border-radius:2px;background:hsl(26 73% 51%);transition:width .4s ease}
.co-src__track{height:3px;border-radius:2px;background:color-mix(in srgb, var(--fg) 14%, transparent);overflow:hidden;width:3.5rem}
.co-disc__skel{display:grid;grid-template-columns:repeat(auto-fill,minmax(15rem,1fr));gap:.7rem;width:100%;max-width:46rem;margin-top:.5rem}
.co-disc__skelcard{height:4.4rem;border-radius:.8rem;border:1px solid var(--border,hsl(0 0% 50% / .15));background:color-mix(in srgb, var(--bg) 60%, transparent);overflow:hidden;position:relative}
.co-disc__skelcard::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,transparent,color-mix(in srgb, var(--fg) 8%, transparent),transparent);transform:translateX(-100%);animation:co-shimmer 1.5s infinite}
.co-ledger{display:inline-flex;align-items:center;gap:.5rem;border-radius:999px;border:1px solid hsl(160 64% 46% / .3);background:hsl(160 64% 46% / .1);color:hsl(160 60% 40%);padding:.35rem .85rem;font-size:12.5px;font-weight:600}
html.dark .co-ledger{color:hsl(158 64% 62%)}
@keyframes co-orb{0%{box-shadow:0 0 0 0 hsl(26 80% 55% / .5)}70%{box-shadow:0 0 0 .5rem hsl(26 80% 55% / 0)}100%{box-shadow:0 0 0 0 hsl(26 80% 55% / 0)}}
@keyframes co-shimmer{100%{transform:translateX(100%)}}
@media (prefers-reduced-motion: reduce){.co-src__orb,.co-disc__skelcard::after{animation:none}}
`;

export function useCountUp(target: number): number {
  const [val, setVal] = useState(target);
  const raf = useRef(0);
  useEffect(() => {
    const tick = () => {
      setVal((v) => {
        const diff = target - v;
        if (Math.abs(diff) < 0.5) return target;
        raf.current = requestAnimationFrame(tick);
        return v + diff * 0.18;
      });
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target]);
  return Math.round(val);
}

function SourceChip({ ats, s }: { ats: AtsSource; s?: SourceState }) {
  const state = s?.state ?? "queued";
  const pct = s?.total ? Math.min(100, Math.round(((s.done ?? 0) / s.total) * 100)) : state === "swept" || state === "noisy" ? 100 : 0;
  return (
    <div className="co-src__chip" data-state={state === "noisy" ? "active" : state}>
      {state === "active" ? (
        <span className="co-src__orb" />
      ) : state === "swept" || state === "noisy" ? (
        <Check className="size-3.5 text-emerald-500" />
      ) : (
        <span className="size-2.5 rounded-full border border-current opacity-40" />
      )}
      <span className="text-[13px] font-medium text-foreground">{ATS_LABEL[ats]}</span>
      <div className="ml-auto flex flex-col items-end gap-1">
        {state === "noisy" && <span className="text-[10px] text-faint">~{s?.unreachable} skipped</span>}
        <div className="co-src__track">
          <div className="co-src__bar" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}

export function DiscoveringState() {
  const { sources, matchCount, companiesScanned, status, phase } = useExplore();
  const shown = useCountUp(matchCount);
  const companies = useCountUp(companiesScanned);

  return (
    <>
      <ApplyBackdrop intense={phase !== "revealing"} />
      <div className="co-disc">
        <style>{STYLE}</style>

        <div className="co-ledger">
          <span className="size-1.5 rounded-full bg-emerald-500" />
          0 tokens · $0.00 {companies > 0 && <span className="opacity-70">· {companies.toLocaleString()} companies</span>}
        </div>

        <div>
          <div className={`${instrumentSerif.className} co-disc__counter text-foreground`}>{shown}</div>
          <p className="mt-1 text-sm text-muted">
            {phase === "revealing" ? "fresh roles found — free" : matchCount > 0 ? "fresh roles and counting…" : "scanning the network…"}
          </p>
        </div>

        <div className="co-src">
          {ATS_SOURCES.map((a) => (
            <SourceChip key={a} ats={a} s={sources[a]} />
          ))}
        </div>

        <p className="flex items-center gap-2 text-[13px] text-faint">
          <Loader2 className="size-3.5 animate-spin" />
          {status || "Casting the net across the ATS network…"}
        </p>

        {phase !== "revealing" && (
          <div className="co-disc__skel" aria-hidden>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="co-disc__skelcard" />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
