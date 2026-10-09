export const PT_PT_LOCALE = "pt-PT";

const STATUS_LABELS: Record<string, string> = {
  Evaluated: "Avaliada",
  Applied: "Candidatura enviada",
  Responded: "Com resposta",
  Interview: "Entrevista",
  Offer: "Proposta",
  Hired: "Contratação",
  Rejected: "Recusada",
  Discarded: "Descartada",
  SKIP: "Ignorar",
};

/** Traduz apenas estados canónicos; valores externos mantêm-se intactos. */
export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

/** Zero execuções não é uma taxa de sucesso de 100%. */
export function scheduledSuccessRate(total: number, successful: number): string {
  if (total <= 0) return "—";
  return `${Math.min(100, Math.round((Math.max(0, successful) / total) * 100))}%`;
}
