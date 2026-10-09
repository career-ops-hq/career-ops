"use client";

import { instrumentSerif } from "@/lib/fonts";
import { CvIngest } from "@/components/cv/cv-ingest";

// The first-run takeover: when cv.md is missing, the CV-upload hero IS the home.
// One input, value-coming framing (not a form), so the first step feels like part
// of the app rather than a gate. The path is CV → free matches → first score.
export function FirstRunHome() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-10 md:py-16">
      <section className="relative overflow-hidden rounded-xl border border-border bg-surface/40 px-7 py-10 md:px-10 md:py-12">
        <div>
          <h1 className={`${instrumentSerif.className} text-4xl leading-[1.05] text-landing md:text-5xl`}>
            Começa pelo teu CV.
          </h1>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-muted">
            Cola o texto do CV ou escolhe um ficheiro .md ou .txt. Para ler um PDF, escolhe primeiro um agente de IA nas{" "}
            <a href="/config" className="text-foreground underline-offset-2 hover:underline">
              Definições
            </a>. A pesquisa inicial não usa tokens; só a avaliação detalhada de uma oferta usa o agente.
          </p>
          <div className="mt-7">
            <CvIngest />
          </div>
        </div>
      </section>
    </div>
  );
}
