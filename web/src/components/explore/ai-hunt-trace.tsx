"use client";

import { useEffect, useMemo, useRef } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import type { AiTraceChunk } from "@/lib/explore-ai";

// The live reasoning panel — a CONTAINED, polished card (apply-mode vocabulary)
// rather than raw text on the backdrop. The narration arrives as arbitrary stream
// deltas (split mid-word), so we COALESCE every narration chunk into one string,
// strip markdown, and re-split into clean SENTENCES — healing the fragments. Newest
// emphasized; auto-scrolls; co-located effect CSS (Tailwind v4 HMR gotcha).
const STYLE = `
.co-reason__dot{width:.5rem;height:.5rem;border-radius:50%;background:hsl(26 80% 55%);box-shadow:0 0 0 0 hsl(26 80% 55% /.5);animation:co-reason-pulse 1.5s ease-out infinite}
.co-reason__body{-webkit-mask-image:linear-gradient(180deg,transparent,#000 16%);mask-image:linear-gradient(180deg,transparent,#000 16%)}
.co-reason__line{animation:co-reason-in .35s ease both}
@keyframes co-reason-pulse{70%{box-shadow:0 0 0 .4rem hsl(26 80% 55% /0)}100%{box-shadow:0 0 0 0 hsl(26 80% 55% /0)}}
@keyframes co-reason-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
@media(prefers-reduced-motion:reduce){.co-reason__dot,.co-reason__line{animation:none}}
`;

// Render **bold** spans inline without a full markdown engine.
function renderInline(s: string) {
  return s.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith("**") && p.endsWith("**") ? (
      <strong key={i} className="font-semibold text-foreground">
        {p.slice(2, -2)}
      </strong>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

export function AiHuntTrace({ trace }: { trace: AiTraceChunk[] }) {
  const sentences = useMemo(() => {
    const full = trace
      .filter((c) => c.kind === "narration")
      .map((c) => (c as { text: string }).text)
      .join("");
    const clean = full.replace(/`/g, "").replace(/\s+/g, " ").trim();
    if (!clean) return [];
    // split into sentences (after . ! ? …), drop leading markdown bullets/quotes
    return clean
      .split(/(?<=[.!?…])\s+/)
      .map((s) => s.replace(/^[>\-*\s]+/, "").trim())
      .filter((s) => s.length > 2)
      .slice(-6);
  }, [trace]);

  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [sentences.length]);

  if (sentences.length === 0) return null;

  return (
    <div className="w-full max-w-2xl rounded-2xl border border-border/70 bg-surface/80 text-left shadow-xl shadow-black/10 backdrop-blur-md">
      <style>{STYLE}</style>
      <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2.5">
        <span className="co-reason__dot" />
        <span className="text-[12px] font-medium text-foreground">Reasoning live</span>
        <Sparkles className="ml-auto size-3.5 text-brand/70" />
      </div>
      <div ref={bodyRef} className="co-reason__body flex max-h-52 flex-col gap-2 overflow-y-auto px-4 py-3">
        {sentences.map((s, i) => (
          <p
            key={`${sentences.length}-${i}`}
            className={cn("co-reason__line text-[13.5px] leading-relaxed", i === sentences.length - 1 ? "text-foreground" : "text-muted")}
          >
            {renderInline(s)}
          </p>
        ))}
      </div>
    </div>
  );
}
