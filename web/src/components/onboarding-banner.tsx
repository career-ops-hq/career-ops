"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { X, Settings } from "lucide-react";

type Doctor = { available: boolean; onboardingNeeded: boolean; missing: string[]; warnings: string[] };

function hasCli(): boolean {
  try {
    return !!JSON.parse(localStorage.getItem("career-ops:config") || "{}").cliId;
  } catch {
    return false;
  }
}

const LABELS: Record<string, string> = {
  "cv.md": "o teu CV",
  "config/profile.yml": "o perfil — funções, remuneração e localização",
  "modes/_profile.md": "as tuas preferências",
  "portals.yml": "as empresas a pesquisar",
};

// Detect (via the core's doctor.mjs) whether setup is incomplete, and offer to
// finish it CONVERSATIONALLY — the assistant asks in plain language and writes
// the canonical files (no YAML to edit). This is the #1 adoption barrier.
export function OnboardingBanner() {
  const [d, setD] = useState<Doctor | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [cli, setCli] = useState(true); // assume until read (avoid CTA flash)

  useEffect(() => {
    setCli(hasCli());
    fetch("/api/doctor")
      .then((r) => r.json())
      .then(setD)
      .catch(() => {});
  }, []);

  if (dismissed || !d || !d.onboardingNeeded) return null;
  const items = d.missing.map((m) => LABELS[m] ?? m);
  const kickoff =
    `Ajuda-me a concluir a configuração do career-ops. Ainda faltam ${items.join(", ")}. Pergunta apenas o que for necessário e escreve os ficheiros por mim. Não voltes a pedir o que já está configurado.`;

  return (
    <div className="relative mb-6 overflow-hidden rounded-xl border border-brand/30 bg-surface/40 p-5">
      <button
        onClick={() => setDismissed(true)}
        className="absolute right-3 top-3 text-faint transition-colors hover:text-foreground"
        aria-label="Fechar"
      >
        <X className="size-4" />
      </button>
      <h2 className="font-display text-xl text-landing">Falta concluir a configuração</h2>
      <p className="mt-1.5 max-w-xl text-sm text-muted">
        Ainda faltam {items.join(", ")}. Responde em texto corrido; o assistente atualiza os ficheiros.
      </p>
      {cli ? (
        <button
          onClick={() => window.dispatchEvent(new CustomEvent("co-assistant", { detail: { message: kickoff } }))}
          className="mt-4 inline-flex items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-200"
        >
          <Settings className="size-4" /> Configurar com o assistente
        </button>
      ) : (
        // The assistant needs a CLI to run — without one the kickoff would silently
        // drop. Send them to connect one first.
        <Link
          href="/config"
          className="mt-4 inline-flex items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-200"
        >
          <Settings className="size-4" /> Escolher um agente nas Definições
        </Link>
      )}
    </div>
  );
}
