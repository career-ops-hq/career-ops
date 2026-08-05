import Link from "next/link";
import { ArrowRight, CheckCircle2, ShieldCheck, Sparkles, Keyboard, Route, Lightbulb } from "lucide-react";
import { NAV_SECTIONS } from "@/lib/nav-items";

const workflow = [
  { step: "1", title: "Bygg din grund", text: "Lägg in profil och CV. Career-Ops använder dem för matchning och anpassning.", href: "/cv", cta: "Öppna CV-studio" },
  { step: "2", title: "Hitta rätt roller", text: "Sök brett, filtrera hårt och spara bara relevanta möjligheter.", href: "/explore", cta: "Hitta jobb" },
  { step: "3", title: "Arbeta systematiskt", text: "Flytta roller genom pipelinen och låt inga uppföljningar falla bort.", href: "/pipeline", cta: "Visa pipeline" },
  { step: "4", title: "Lär av resultat", text: "Använd analysen för att förbättra CV, urval och aktivitet vecka för vecka.", href: "/analytics", cta: "Se analys" },
];

export default function GuidePage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
      <header className="overflow-hidden rounded-3xl border border-border bg-surface p-6 shadow-sm sm:p-9">
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-brand-text">
          <Sparkles className="size-4" /> Career-Ops hjälpcenter
        </div>
        <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_320px] lg:items-end">
          <div>
            <h1 className="max-w-3xl text-3xl font-semibold tracking-tight text-landing sm:text-5xl">Hela jobbsökningen, utan onödig komplexitet.</h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-muted">Här ser du vad varje del gör, hur arbetsflödet hänger ihop och vilka säkerhetsregler som alltid gäller.</p>
          </div>
          <div className="rounded-2xl border border-brand/20 bg-brand-soft p-4 text-sm text-brand-text">
            <div className="flex items-center gap-2 font-semibold"><Keyboard className="size-4" /> Snabbaste vägen</div>
            <p className="mt-2 leading-6">Tryck <kbd className="rounded border border-brand/30 bg-background/70 px-1.5 py-0.5 font-mono text-xs">⌘ K</kbd> var som helst för att söka efter en funktion eller uppgift.</p>
          </div>
        </div>
      </header>

      <section className="mt-10" aria-labelledby="workflow-title">
        <div className="flex items-center gap-2"><Route className="size-5 text-brand-text" /><h2 id="workflow-title" className="text-xl font-semibold text-foreground">Rekommenderat arbetsflöde</h2></div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {workflow.map((item) => (
            <article key={item.step} className="group rounded-2xl border border-border bg-surface p-5 transition-colors hover:border-brand/30">
              <div className="flex gap-4">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">{item.step}</span>
                <div>
                  <h3 className="font-semibold text-foreground">{item.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-muted">{item.text}</p>
                  <Link href={item.href} className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-text hover:underline">{item.cta}<ArrowRight className="size-3.5" /></Link>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-10" aria-labelledby="features-title">
        <div className="flex items-center gap-2"><Lightbulb className="size-5 text-brand-text" /><h2 id="features-title" className="text-xl font-semibold text-foreground">Alla funktioner</h2></div>
        <div className="mt-4 space-y-7">
          {NAV_SECTIONS.map((section) => (
            <div key={section.id}>
              <h3 className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-faint">{section.label}</h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {section.items.map(({ href, label, description, icon: Icon, shortcut }) => (
                  <Link key={href} href={href} className="group flex gap-3 rounded-2xl border border-border bg-surface p-4 transition-all hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-sm">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-background text-muted group-hover:text-brand-text"><Icon className="size-5" /></span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 font-semibold text-foreground">{label}{shortcut && <kbd className="rounded border border-border px-1.5 py-0.5 text-[9px] font-normal text-faint">{shortcut}</kbd>}</span>
                      <span className="mt-1 block text-sm leading-5 text-muted">{description}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-10 grid gap-4 lg:grid-cols-2">
        <article className="rounded-2xl border border-border bg-surface p-6">
          <div className="flex items-center gap-2 font-semibold text-foreground"><ShieldCheck className="size-5 text-emerald-500" /> Säkerhet som standard</div>
          <ul className="mt-4 space-y-3 text-sm text-muted">
            {["Din profil, ditt CV och din pipeline lagras i lokala filer.", "Career-Ops skickar aldrig en ansökan åt dig — du godkänner och skickar själv.", "AI-funktioner är valfria och konfigureras tydligt under Inställningar.", "Bakgrundskörningar och fel kan alltid granskas under Automatisering."].map((text) => <li key={text} className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />{text}</li>)}
          </ul>
        </article>
        <article className="rounded-2xl border border-border bg-surface p-6">
          <h2 className="font-semibold text-foreground">Behöver du felsöka?</h2>
          <p className="mt-2 text-sm leading-6 text-muted">Kontrollera först inställningar och senaste automatiseringskörning. Där visas saknade krav, status och fel utan att du behöver leta i terminalen.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/config" className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90">Kontrollera inställningar</Link>
            <Link href="/jobs" className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-surface-hover">Visa körningar</Link>
          </div>
        </article>
      </section>
    </div>
  );
}
