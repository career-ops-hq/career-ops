import { ChevronDown, ExternalLink } from "lucide-react";

// Transparency = our differentiator ("why it's a 4.0 for YOU"). The wording is
// the CANONICAL public text from career-ops.org/methodology + /docs — rendered
// verbatim, NOT a web reinterpretation of the rubric (whose weights live in the
// core, modes/_shared.md). Native <details> → no client JS.

const DIMENSIONS: [string, string][] = [
  ["Compatibilidade", "correspondência entre o teu CV e os requisitos da função"],
  ["Objetivo profissional", "contributo da função para o objetivo que definiste"],
  ["Remuneração", "comparação com valores de mercado; quando faltam dados, o relatório assinala essa ausência"],
  ["Sinais culturais", "equipa, valores e formas de trabalho descritos na oferta"],
  ["Sinais de risco", "indícios de fraude, oferta fantasma ou incompatibilidade"],
  ["Avaliação geral", "síntese das dimensões anteriores numa pontuação"],
];

const BLOCKS: [string, string][] = [
  ["A", "Resumo da função em linguagem simples"],
  ["B", "Correspondência entre o CV e cada requisito, importância e lacunas"],
  ["C", "Forma de apresentar a tua experiência para esta função"],
  ["D", "Pesquisa salarial e comparação com o mercado"],
  ["E", "Notas para adaptar a candidatura"],
  ["F", "Preparação da entrevista com exemplos STAR adaptados à função"],
  ["G", "Verificação da legitimidade da oferta"],
];

export function ScoreMethodology() {
  return (
    <details className="group mt-10 overflow-hidden rounded-2xl border border-border bg-surface/30">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3.5 text-sm font-medium transition-colors hover:bg-surface-hover">
        Como foi calculada esta pontuação
        <ChevronDown className="ml-auto size-4 text-faint transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-5 border-t border-border px-5 py-4 text-sm">
        <p className="text-muted">
          Cada oportunidade recebe uma pontuação de <strong className="text-foreground">1,0 a 5,0</strong> em seis dimensões.{" "}
          A referência para avançar com a candidatura é <strong className="text-brand">4,0</strong>.
        </p>
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-faint">As seis dimensões</div>
          <ul className="space-y-1.5">
            {DIMENSIONS.map(([k, v]) => (
              <li key={k}>
                <span className="font-medium text-foreground">{k}</span> <span className="text-muted">— {v}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-faint">Conteúdo do relatório</div>
          <ul className="space-y-2">
            {BLOCKS.map(([k, v]) => (
              <li key={k} className="flex items-start gap-2.5">
                <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded bg-brand-soft text-xs font-semibold text-brand">
                  {k}
                </span>
                <span className="text-muted">{v}</span>
              </li>
            ))}
          </ul>
        </div>
        <a
          href="https://career-ops.org/methodology"
          target="_blank"
          rel="noreferrer"
          aria-label="Metodologia completa, abre num novo separador"
          className="inline-flex min-h-[24px] items-center gap-1 text-xs text-brand transition-colors hover:underline max-sm:min-h-[44px]"
        >
          Consultar a metodologia <ExternalLink className="size-3" aria-hidden="true" />
        </a>
      </div>
    </details>
  );
}
