"use client";

import { useRef } from "react";
import { ArrowRight, Search } from "lucide-react";
import { CostBadge } from "@/components/cost/cost-badge";

const EXAMPLES = [
  "Apoio ao cliente em Lisboa, horário diurno",
  "Assistente de loja, linha de Sintra, sem experiência",
  "Marketing digital remoto na União Europeia, publicado esta semana",
];

// The "magic" natural-language box: a soft contained halo at rest that intensifies
// on focus (erupts into the full-viewport hunt on submit). Effect CSS co-located
// per the Tailwind v4 stale-CSS HMR gotcha.
const STYLE = `
.co-aibox{position:relative;border-radius:.75rem;border:1px solid var(--co-border,hsl(0 0% 50% /.22));background:color-mix(in srgb, var(--bg) 55%, transparent);transition:border-color .2s,box-shadow .2s}
.co-aibox:focus-within{border-color:hsl(26 73% 51% /.5);box-shadow:0 0 0 4px hsl(26 73% 51% /.09)}
.co-aibox textarea{width:100%;resize:none;background:transparent;border:none;outline:none;font-size:16px;line-height:1.5;color:inherit}
.co-aibox textarea::placeholder{color:var(--co-faint,hsl(0 0% 58%))}
@media(prefers-reduced-motion:reduce){.co-aibox,.co-aibox::before{transition:none}}
`;

export function AiSearchBox({
  intent,
  onIntent,
  onSubmit,
  cliConfigured,
  cliName,
  onRunScan,
}: {
  intent: string;
  onIntent: (s: string) => void;
  onSubmit: () => void;
  cliConfigured: boolean;
  cliName?: string;
  onRunScan: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const grow = () => {
    const t = ref.current;
    if (t) {
      t.style.height = "auto";
      t.style.height = `${Math.min(t.scrollHeight, 160)}px`;
    }
  };

  return (
    <div>
      <style>{STYLE}</style>
      <div className="co-aibox p-4">
        <div className="mb-2 flex items-center gap-2 text-[12px] font-medium text-brand">
          <Search className="size-3.5" /> Descreve a oferta que procuras
        </div>
        <textarea
          ref={ref}
          rows={2}
          value={intent}
          onChange={(e) => {
            onIntent(e.target.value);
            grow();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (intent.trim()) onSubmit();
            }
          }}
          placeholder="Ex.: apoio ao cliente em Lisboa, horário diurno, sem vendas"
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <span className="text-[12px] text-muted">
            {cliConfigured ? (
              <>
                Pesquisa a web pública com <span className="text-foreground">{cliName || "o agente escolhido"}</span> e usa os teus tokens.
              </>
            ) : (
              "Escolhe um agente nas Definições para usar a pesquisa assistida."
            )}
          </span>
          <button
            type="button"
            disabled={!intent.trim()}
            onClick={onSubmit}
            className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground shadow-sm transition hover:brightness-110 disabled:opacity-50"
          >
            Pesquisar na web
            <CostBadge kind="spend" size="xs" />
            <ArrowRight className="size-4" />
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => onIntent(ex)}
            className="rounded-full border border-border bg-surface/40 px-3 py-1.5 text-[12px] text-muted transition hover:border-brand/40 hover:text-brand"
          >
            {ex}
          </button>
        ))}
        <button type="button" onClick={onRunScan} className="ml-auto inline-flex items-center gap-1 text-[12px] text-faint transition hover:text-foreground">
          ou usar a pesquisa direta →
        </button>
      </div>
    </div>
  );
}
