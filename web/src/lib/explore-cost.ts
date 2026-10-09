// The cost-honesty taxonomy — a single source for the FREE vs $ boundary that the
// Explorer teaches by repetition. Discovery (finding roles) is structurally free:
// it calls no LLM. Only evaluation (scoring a role against your CV) spends tokens,
// and only when the user chooses it. The framing is always local-first: "your key,
// your AI, your machine."

export type CostClass = "free" | "free-network" | "spend" | "free-gemini";

export const COST_META: Record<CostClass, { label: string; tip: string }> = {
  "free-network": {
    label: "Sem custo",
    tip: "Pesquisa ofertas públicas por HTTP. Não usa IA nem tokens e não guarda nada até adicionares uma oferta.",
  },
  free: {
    label: "Sem custo",
    tip: "Não usa tokens. Lê e escreve apenas ficheiros locais.",
  },
  spend: {
    label: "Usa tokens",
    tip: "Avalia a oferta de A a F com o agente escolhido. Só usa tokens quando pedes uma avaliação.",
  },
  "free-gemini": {
    label: "Sem custo · Gemini",
    tip: "Avalia com o plano gratuito do Gemini, sem custo de tokens.",
  },
};
