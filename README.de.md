<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/wordmark-dark.svg"><img src="docs/wordmark-light.svg" alt="career-ops" width="250" height="56"></picture></p>

<p align="center">
  <em>Ich habe monatelang Jobs auf die harte Tour gesucht. Also habe ich das System gebaut, das ich gern gehabt hätte.</em><br>
  Unternehmen nutzen KI, um Bewerber:innen zu filtern. <strong>Ich habe Bewerber:innen KI gegeben, um Unternehmen zu <em>bewerten</em>.</strong><br>
  Es bewertet, sortiert und entwirft. <strong>Es schickt nie etwas ab: das machst du.</strong> Open Source, lokal, deins.
</p>

<p align="center">
  <a href="https://x.com/santifer/status/2041403685696053741"><img src="docs/demo.gif" alt="career-ops-Pipeline: bewertete Stellen, 219 als nicht bewerben markiert, dann eine vollständige Auswertung" width="800"></a>
</p>

<p align="center"><sub>Eine Momentaufnahme mitten in der Suche: die Pipeline, dann eine Stelle geöffnet und von Anfang bis Ende ausgewertet.</sub></p>

<p align="center"><strong>Von 740 Stellen waren 68 eine Bewerbung wert. 12 Interviews. 1 Angebot.</strong></p>
<p align="center"><sub>Eine Suche, die des Autors, 2026. Die Zahl, die zählt, ist die Auslese, nicht die Menge. Alle Zahlen in der <a href="https://santifer.io/career-ops-system">Fallstudie</a>.</sub></p>

<p align="center"><sub>Schickt nie ab, sendet nie E-Mails, funkt nie nach Hause: <a href="#was-career-ops-nicht-tut">was es nicht tut</a> · läuft in der KI-CLI, die du schon benutzt, <a href="docs/RUNNING_ON_A_BUDGET.md">kostenlose und lokale Modelle inklusive</a>.</sub></p>

<details>
<summary>In 17 Sprachen lesen</summary>
<div align="center">

[English](README.md) | [Español](README.es.md) | [Deutsch](README.de.md) | [Français](README.fr.md) | [Português (Brasil)](README.pt-BR.md) | [한국어](README.ko-KR.md) | [日本語](README.ja.md) | [简体中文](README.cn.md) | [繁體中文](README.zh-TW.md) | [Українська](README.ua.md) | [Русский](README.ru.md) | [Polski](README.pl.md) | [Dansk](README.da.md) | [தமிழ்](README.ta.md) | [العربية](README.ar.md) | [हिन्दी](README.hi.md) | [Türkçe](README.tr.md)

</div>
</details>

<hr>

<p align="center">
  <a href="HIRED.md"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fsantifer%2Fcareer-ops%2Fmain%2Fdocs%2Fhired-count.json&query=%24.count&label=%F0%9F%8E%89%20HIRED%20WITH%20CAREER-OPS&suffix=%20verified&color=2ea44f&style=for-the-badge&labelColor=2b3137" alt="Mit career-ops eingestellt: verifizierte Anzahl"></a>
</p>

<p align="center"><sub>Job gelandet? <a href="https://github.com/career-ops-hq/career-ops/issues/new?template=i-got-hired.yml">Teile es →</a> · deine Karte zeigt jemandem mitten in der Suche, dass es einen Ausweg gibt.</sub></p>

<p align="center">
  <a href="HIRED.md"><img src="docs/hired-wall.svg" alt="Die drei neuesten Einstellungsgeschichten" width="800"></a>
</p>

<p align="center"><sub>Jede Zahl ist eine öffentliche Geschichte, die du <a href="HIRED.md">prüfen kannst →</a> · jede davon hat dort angefangen, wo du jetzt bist.</sub></p>

<p align="center"><sub>BEKANNT AUS</sub></p>

<p align="center">
  <a href="https://wired.com.gr/article/to-ai-ergaleio-pou-fernei-epanastasi-ston-tropo-pou-psachnoume-douleia/" rel="noopener noreferrer nofollow"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/press/wired-dark.svg"><img src="docs/press/wired.svg" alt="WIRED" height="32"></picture></a>
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <a href="https://www.businessinsider.com/how-i-built-tool-filter-job-listings-landed-head-ai-2026-4" rel="noopener noreferrer nofollow"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/press/business-insider-dark.svg"><img src="docs/press/business-insider.svg" alt="Business Insider" height="32"></picture></a>
</p>

<p align="center">
  <a href="https://www.producthunt.com/products/santifer-io?utm_source=badge-featured&utm_medium=badge" target="_blank" rel="noopener noreferrer"><img src="docs/press/producthunt.svg" alt="career-ops on Claude | Product Hunt" style="width: 206px; height: 54px; vertical-align: middle;" width="206" height="54"/></a>
  &nbsp;&nbsp;
  <a href="https://trendshift.io/repositories/25195" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/repositories/25195" alt="santifer%2Fcareer-ops | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
</p>

<p align="center"><sub>Erstellt und gepflegt von <a href="https://santifer.io">Santiago Fernández de Valderrama Aparicio</a> (<a href="https://github.com/santifer">@santifer</a>)</sub></p>

## Was ist das?

career-ops ([career-ops.org](https://career-ops.org), auch bekannt als **careerops**) ist eine quelloffene KI-Jobsuche, die lokal in jeder KI-Coding-CLI läuft: Sie bewertet Stellenangebote, passt deinen Lebenslauf an und verfolgt jede Bewerbung, und die finale Entscheidung liegt immer bei dir. Statt Bewerbungen manuell in einer Tabelle zu verfolgen, bekommst du eine KI-gestützte Pipeline, die:

- **Stellenangebote bewertet** und in einen strukturierten Report gießt: Blöcke A bis H, mit einer globalen Bewertung von 1 bis 5, die aus einem ganzheitlichen Urteil über fünf Dimensionen entsteht, nicht aus einer Rechenformel. Die Spalte zur Wichtigkeit jeder Anforderung in Block B und die Legitimitätsprüfung der Anzeige in Block G sind eigenständige, bewertungsneutrale Signale, die die Note nie beeinflussen; Block H wird erst ab 4,5 entworfen
- **maßgeschneiderte PDFs generiert**: ATS-optimierte Lebensläufe, angepasst an jede Stellenbeschreibung
- **Portale automatisch scannt** (Greenhouse, Ashby, Lever, Unternehmensseiten)
- **im Batch verarbeitet**: 10+ Stellenangebote parallel mit Sub-Agents bewerten
- **alles verfolgt** in einer einzigen Source of Truth mit Integritätsprüfungen
- **Unternehmen recherchiert und die richtige Kontaktperson findet**: Bewerbungen bringen dich in die Warteschlange; Recherche bringt dich ins Gespräch

> **Wichtig: Das ist KEIN Spray-and-Pray-Tool.** career-ops ist ein Filter: Es hilft dir, aus hunderten Stellenangeboten die wenigen zu finden, die deine Zeit wert sind. Das System rät deutlich davon ab, sich auf irgendetwas mit weniger als 4,0/5 zu bewerben. Deine Zeit ist wertvoll, und die der Recruiter:innen auch. Prüfe immer, bevor du absendest.

career-ops ist agentisch: Die KI-Coding-CLI deiner Wahl navigiert mit Playwright durch Karriereseiten, bewertet den Fit, indem sie deinen Lebenslauf gegen die Stellenbeschreibung abwägt (kein Keyword-Matching), und passt deinen Lebenslauf pro Stellenanzeige an.

> **Hinweis: Die ersten Bewertungen werden nicht großartig sein.** Das System kennt dich noch nicht. Gib ihm Kontext: deinen Lebenslauf, deinen Werdegang, deine Proof Points, deine Präferenzen, worin du gut bist, was du vermeiden willst. Je mehr du es fütterst, desto besser wird es. Denk daran wie an die Einarbeitung einer neuen Recruiterin: In der ersten Woche muss sie dich kennenlernen, danach ist sie unbezahlbar.

Gebaut von jemandem, der damit 740 Stellenangebote ausgewertet, sich auf 68 beworben und eine Stelle als Head of Applied AI bekommen hat. [Die ganze Fallstudie lesen](https://santifer.io/career-ops-system).

## Was career-ops nicht tut

- **Eine Bewerbung abschicken.** Es bereitet die Antworten vor; du öffnest das Formular und klickst auf Absenden. Das Skript sendet nie einen POST (`prepare-application.mjs`).
- **Eine E-Mail senden.** Nur Entwürfe. Nirgendwo in diesem Code gibt es einen Mailversand.
- **Nach Hause funken.** Keine Telemetrie, kein Backend von uns. Dein Lebenslauf geht von deinem Rechner zum KI-Anbieter deiner Wahl, und nirgendwo sonst. Das einzige öffentliche Register ist dieses Repository: `HIRED.md` und seine Issues.
- **Dich zu Bewerbungen unter 4,0/5 drängen.** Es rät dir davon ab. Du kannst dich darüber hinwegsetzen, und es sagt es dir.

Es formuliert deinen Lebenslauf um; es darf ihn nie erfinden. Heute steht diese Regel in den Prompts, noch nicht in einer erzwingenden Prüfung. Lies jeden Lebenslauf, bevor du ihn abschickst. Details in den [FAQ](#faq).

## Das CareerOps-Manifest

career-ops ist die erste Referenzimplementierung des [CareerOps-Manifests](https://career-ops.org/manifesto?utm_source=readme). lies es. wenn es sagt, woran du glaubst, unterschreib es. deine Unterschrift wird zu einem Commit.

## Features

| Feature                  | Beschreibung                                                                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Auto-Pipeline**        | URL einfügen, vollständige Bewertung + PDF + Tracker-Eintrag erhalten                                                                   |
| **A-H-Bewertung**        | Rollen-Zusammenfassung, Lebenslauf-Match (mit der Wichtigkeit jeder Anforderung für diese Anzeige und der Angabe, ob das Gewicht aus dem Wortlaut der Stellenbeschreibung, ihrer Struktur oder einer Schätzung stammt, pro Anforderung gekennzeichnet; eine Schätzung kann nie in der obersten Stufe landen), Level-Strategie, Vergütungsrecherche, Personalisierung, Interview-Vorbereitung (STAR+R), dazu eine Legitimitätsprüfung in Block G, die Scams und Ghost Jobs markiert, und ein Work-Auth-Signal, das eine Stellenbeschreibung mit ausdrücklich ausgeschlossenem Visa-Sponsoring als harten Blocker kennzeichnet |
| **Interview Story Bank** | Sammelt STAR+Reflection-Geschichten über Bewertungen hinweg: 5-10 Master-Stories, die jede Behavioral Question beantworten              |
| **Verhandlungsskripte**  | Frameworks für Gehaltsverhandlungen, Pushback gegen geografische Abschläge, Hebel durch konkurrierende Angebote                          |
| **ATS-PDF-Generierung**  | Lebensläufe mit Keyword-Injektion im Space-Grotesk- und DM-Sans-Design                                                                   |
| **Anschreiben-Generator** | Recherchegestützte Anschreiben mit Keyword-Mirroring, vier interaktiven Angle-Prompts (warum/Probleme/Ansatz/Ton), Freigabe des Entwurfs im Chat und A4-PDF über dieselbe HTML- und Playwright-Pipeline wie Lebensläufe. Entwirft bei jeder Bewertung automatisch; vervollständigen und erzeugen bei Bedarf mit `/career-ops cover` |
| **Bewerbungs-E-Mail-Entwürfe** | Formelle E-Mails an Recruiter:innen, für Empfehlungen oder Initiativbewerbungen aus einem Report oder einer eingefügten Stellenbeschreibung, mit Betreff, Anhang-Checkliste, belegten Fit-Punkten und einem Kontaktblock aus deinem Profil. Nur Entwürfe: career-ops sendet, reicht ein oder klickt nie etwas. |
| **Portal-Scanner**       | 100+ vorkonfigurierte Unternehmen (Anthropic, OpenAI, ElevenLabs, Retool, n8n...) plus eigene Queries über Ashby, Greenhouse, Lever, Wellfound |
| **Finanzierte Unternehmen entdecken** | Der Befehl `company:funded` (erst prüfen, dann handeln) zeigt kürzlich finanzierte Unternehmen und Quellendiagnosen aus strukturierten öffentlichen Feeds, ohne deine Daten anzufassen |
| **Batch-Verarbeitung**   | Parallele Bewertung mit headless CLI-Workern (`claude -p` / `opencode run`)                                                             |
| **Dashboard TUI**        | Terminal-UI zum Durchsuchen, Filtern und Sortieren deiner Pipeline                                                                       |
| **Human-in-the-Loop**    | KI bewertet und empfiehlt, du entscheidest und handelst. Das System reicht niemals eine Bewerbung ein: die finale Entscheidung liegt immer bei dir <!-- hitl: absolute guarantee. Do not add "automatically", "by itself", "without your permission" or any other hedge when translating this row. -->               |
| **Pipeline-Integrität**  | Automatisches Mergen, Deduplizieren, Status-Normalisierung, Health Checks                                                                |
| **Interview-Suite**      | Zeitgeblockte Vorbereitungspläne, Übungssessions mit Feedback, Debriefs nach dem Interview ([`interview/`](modes/interview/README.md)) und ein Red-Flag-Detektor für Unternehmen ([`interview-redflag`](modes/interview-redflag.md)) |
| **Angebotsphase**        | Begleiter beim Lesen des Vertrags: Klausel für Klausel plus eine Fragenliste für den Anwalt ([`offer-prep`](modes/offer-prep.md)), und ein Analysator für die Lücke zwischen gewünschtem, ausgeschriebenem und tatsächlichem Gehalt (`salary-gap.mjs`) |
| **Follow-ups & Antworten** | Rechner für die Follow-up-Kadenz und vorbereitete Erinnerungen (`followup-cadence.mjs`, `followup-seed.mjs`); Klassifizierung von Arbeitgeber-Antworten in Tracker-Updates ([`reply-watch`](modes/reply-watch.md)) |
| **Musteranalyse**        | Ablehnungsmuster und Weiterkommensquoten je ATS-Kanal (`analyze-patterns.mjs`), Funnel-Statistiken über die gesamte Suche (`stats.mjs`), Erkennung von Reposts und Ghost Jobs (`detect-reposts.mjs`) |
| **Plugin-System**        | Optionale Integrationen (Gmail, Notion, Apify + ein Community-Registry), standardmäßig deaktiviert; siehe [docs/PLUGINS.md](docs/PLUGINS.md) |
| **Über den Lebenslauf hinaus** | Die Unternehmensrecherche ([`deep`](modes/deep.md)) legt KI-Strategie, jüngste Schritte, Engineering-Kultur und den Winkel offen, den dein Profil einnehmen sollte. Die Kontaktsuche ([`contacto`](modes/contacto.md)) identifiziert Hiring Manager, Recruiter:in oder Teammitglied, bei denen sich eine Nachricht lohnt, und entwirft eine LinkedIn-Nachricht mit ≤300 Zeichen, abgestimmt auf den Kontakttyp. Formelle Bewerbungs-E-Mail-Entwürfe ([`email`](modes/email.md)) machen aus einem bewerteten Report oder einer eingefügten Stellenbeschreibung Betreff, Text und Anhang-Checkliste, ohne etwas zu senden, einzureichen oder anzuklicken. Bewerbungen bringen dich in die Warteschlange; Recherche bringt dich ins Gespräch. |

## Schnellstart

**Der schnellste Weg: ein einziger Befehl:**

```bash
npx @santifer/career-ops init
```

> 💡 `npx` kommt mit [Node.js](https://nodejs.org): Es führt den Installer einmal aus,
> ohne etwas global zu installieren. Noch kein Node? Installiere es zuerst.
> (Nutzt du schon eine Claude Code / Gemini / Codex CLI? Dann hast du es bereits.)

Das klont das neueste Release nach `./career-ops` und installiert die Abhängigkeiten. Dann:

```bash
cd career-ops
claude   # or codex / qwen / opencode / agy / grok — open your AI CLI here
```

**Beim ersten Start führt dich career-ops durch die Einrichtung (dein Lebenslauf, dein Profil und deine Zielrollen), einfach im Gespräch. Nichts muss von Hand bearbeitet werden.**

<details>
<summary><b>Lieber manuell einrichten? (git clone)</b></summary>

```bash
git clone https://github.com/career-ops-hq/career-ops.git
cd career-ops && npm install
npx playwright install chromium   # only needed for PDF generation

# 2. Check setup
npm run doctor                     # Validates all prerequisites

# 3. Configure
cp config/profile.example.yml config/profile.yml  # Edit with your details
cp templates/portals.example.yml portals.yml       # Customize companies

# 4. Add your CV
# Create cv.md in the project root with your CV in markdown

# 5. Open your AI CLI in this directory
claude   # or codex / opencode / qwen / agy / grok

# Then ask your CLI to adapt the system to you:
# "Change the archetypes to backend engineering roles"
# "Translate the modes to English"
# "Add these 5 companies to portals.yml"
# "Update my profile with this CV I'm pasting"

# 6. Start using
# Paste a job URL or JD text to trigger auto-pipeline
# If your CLI supports slash commands, use /career-ops (or its CLI-specific alias)
# In Codex, ask for the same mode in plain language, e.g.:
# "Run the career-ops scan mode"
# "Run the career-ops pipeline mode for data/pipeline.md"
# "Run the career-ops pdf mode for the latest evaluated role"
# "Run the career-ops tracker mode and summarize the current statuses"
```

</details>

### Globale Installation

```bash
npm i -g @santifer/career-ops
```

Das installiert die `career-ops`-Binary global, sodass du sie direkt statt über `npx` ausführen kannst. Anders als `npx @santifer/career-ops init` (das ein Projektverzeichnis anlegt) gibt dir die globale Installation einen dauerhaften Befehl `career-ops`, der überall in deinem Terminal verfügbar ist.

**Welche Variante solltest du nutzen?**
- `npx @santifer/career-ops init`: am besten für den ersten Einsatz; legt einen eigenen Projektordner an.
- `npm i -g @santifer/career-ops`: am besten, sobald du einen Projektordner hast und career-ops-Befehle direkt ausführen willst.

> **Das System ist dafür gebaut, von deiner KI-Coding-CLI selbst angepasst zu werden.** Modi, Archetypen, Bewertungsgewichte, Verhandlungsskripte: Bitte sie einfach, das zu ändern. Sie liest dieselben Dateien, die sie benutzt, und weiß daher genau, was zu bearbeiten ist.

Siehe [docs/SETUP.md](docs/SETUP.md) für die vollständige Einrichtungsanleitung, [docs/RUNNING_ON_A_BUDGET.md](docs/RUNNING_ON_A_BUDGET.md) für den günstigen Betrieb von career-ops mit eigenen oder lokalen Modellen (und [docs/FREE_TIER.md](docs/FREE_TIER.md) für den kostenlosen Betrieb im Free Tier der Antigravity CLI), [docs/AUTOMATION.md](docs/AUTOMATION.md) für wiederkehrende Scans und ein Rezept vom Triage zur Shortlist ohne Token-Verbrauch, [docs/APPLY_AUTOFILL.md](docs/APPLY_AUTOFILL.md) für Details zum ATS-Autofill-Ablauf, [docs/LINKEDIN_JOIN.md](docs/LINKEDIN_JOIN.md) für den Abgleich eines LinkedIn-Kontaktexports mit den Unternehmen in deinem Funnel und [docs/FAQ.md](docs/FAQ.md) für Antworten auf häufige Einrichtungsfragen, darunter [wie die Herkunft von Geschichten erfundene Zahlen verhindert](docs/FAQ.md#why-does-career-ops-refuse-to-use-a-number-from-my-story-bank). Designprinzipien stehen in [ARCHITECTURE.md](ARCHITECTURE.md); Laufzeitabläufe in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Antigravity-CLI-Integration

career-ops unterstützt die Antigravity CLI nativ, genauso wie Claude Code und OpenCode. Alle Slash Commands sind über den gemeinsamen Skill-Einstiegspunkt verfügbar, mit derselben Bewertungslogik aus `modes/*.md`.

Google hat den Zugang zur Gemini CLI für Endnutzer:innen auf die Antigravity CLI umgestellt. `GEMINI.md` ist jetzt ein wirkungsloser Kompatibilitätsschutz, damit Antigravity die vollständigen Projektanweisungen nicht doppelt lädt, wenn es sowohl `AGENTS.md` als auch `GEMINI.md` liest.

### Native Antigravity CLI

```bash
# 1. Run in the career-ops directory
cd career-ops
agy

# 2. Use the unified /career-ops command with subcommands:
/career-ops "Senior AI Engineer at Anthropic..."
/career-ops pipeline
/career-ops scan
/career-ops pdf
/career-ops tracker
```

Der Skill ist nach dem offenen Standard in `.agents/skills/career-ops/SKILL.md` definiert und für jede unterstützte CLI verlinkt oder referenziert (z. B. `.claude/`, `.cursor/`, `.qwen/`, `.antigravitycli/`, `.grok/`).

## Codex-Integration

career-ops unterstützt Codex über denselben gemeinsamen Router, aber das Aufrufmodell unterscheidet sich von CLIs, die Slash Commands automatisch registrieren. Die vollständige Anleitung steht in [docs/CODEX.md](docs/CODEX.md).

### Interaktives Codex

```bash
cd career-ops
codex
```

Slash Commands sind in Codex nicht garantiert. Falls `/career-ops` nicht verfügbar ist, bitte Codex in natürlicher Sprache, den Modus direkt auszuführen:

```text
Evaluate this JD with career-ops auto-pipeline: https://company.com/jobs/123
Run the career-ops scan mode and summarize new matches.
Run the career-ops pipeline mode for data/pipeline.md.
Run the career-ops pdf mode for the latest evaluated role.
Run the career-ops tracker mode and summarize the current statuses.
```

### Codex im Einzelaufruf (`codex exec`)

```bash
codex exec "Evaluate this JD with career-ops auto-pipeline: https://company.com/jobs/123"
codex exec "Run career-ops scan mode in this repo and summarize new matches."
codex exec "Run career-ops pipeline mode for data/pipeline.md."
codex exec "Run career-ops pdf mode for the latest evaluated role."
codex exec "Run career-ops tracker mode and summarize the current statuses."
```

## Grok-Build-CLI-Integration

career-ops unterstützt die Grok Build CLI nativ, genauso wie Claude Code und OpenCode. `AGENTS.md` wird automatisch als Projektregeln geladen, und alle Slash Commands sind über den gemeinsamen Skill-Einstiegspunkt verfügbar.

### Native Grok Build CLI

```bash
# 1. Run in the career-ops directory
cd career-ops
grok

# 2. Use the unified /career-ops command with subcommands:
/career-ops "Senior AI Engineer at Anthropic..."
/career-ops pipeline
/career-ops scan
/career-ops pdf
/career-ops tracker
```

Für headless Batch-Worker nutze `grok -p "prompt"` (mit `--yolo` werden Tool-Ausführungen automatisch freigegeben).

### Eigenständiges Gemini-API-Skript (keine CLI-Installation nötig)

```bash
# 1. Get a free API key at https://aistudio.google.com/apikey
cp .env.example .env
# Edit .env, set GEMINI_API_KEY=your_key_here

# 2. Install dependencies
npm install

# 3. Evaluate a job description
node gemini-eval.mjs "We are looking for a Senior AI Engineer..."
node gemini-eval.mjs --file ./jds/my-job.txt
node agent-inbox.mjs add "..."   # queue a request for the next session
npm run gemini:eval -- "JD text here"
```

> **Free Tier:** Beide Optionen funktionieren ohne Abrechnung. Die native CLI nutzt Google OAuth; das API-Skript nutzt `gemini-3.6-flash` (Rate Limits hängen von Modell und Stufe ab; aktuelle Kontingente stehen in den Google-AI-Docs).

## Nutzung

career-ops nutzt einen gemeinsamen Befehls-Router. In CLIs, die Slash Commands registrieren, sieht das so aus:

```
/career-ops           → Alle verfügbaren Befehle anzeigen
/career-ops {JD}      → AUTO-PIPELINE: Bewertung + Report + PDF + Tracker (Text oder URL einfügen)
/career-ops pipeline  → Ausstehende URLs aus der Inbox verarbeiten (data/pipeline.md)
/career-ops oferta    → Nur Bewertung, Blöcke A bis G (kein automatisches PDF)
/career-ops ofertas   → Mehrere Angebote vergleichen und ranken
/career-ops contacto  → LinkedIn-Power-Move: Kontakte finden + Nachricht entwerfen
/career-ops deep      → Tiefen-Recherche-Prompt zum Unternehmen
/career-ops interview-prep → Unternehmensspezifisches Interview-Vorbereitungsdokument erzeugen
/career-ops interview    → Interaktives Onboarding-Interview für Profil und Lebenslauf
/career-ops eu-swe    → Eine europäische SWE-Bewerbung vor Lebenslauf, Bewerbung und Interview kalibrieren
/career-ops eu-fintech → 21 EU-Fintech-Portale nach Product-Manager-Rollen scannen (ohne Tokens)
/career-ops interview/plan → Zeitgeblockter Vorbereitungsplan für ein anstehendes Interview
/career-ops interview/practice → Übungsinterview, eine Frage nach der anderen mit Feedback
/career-ops interview/debrief → Debrief nach dem Interview: Lücken schließen, nächste Runde vorhersagen
/career-ops interview-redflag → Warnsignale des Arbeitgebers analysieren, bevor du einsteigst
/career-ops pdf       → Nur PDF, ATS-optimierter Lebenslauf
/career-ops text      → Angepasster Markdown-Lebenslauf (spiegelt cv.md, kein PDF)
/career-ops latex     → Lebenslauf als LaTeX/Overleaf .tex exportieren
/career-ops latex-tex → Deine eigene resume.tex direkt anpassen (opt-in; cv.md bleibt Standard)
/career-ops cover     → Anschreiben: eigenständig aus eingefügter Stellenbeschreibung oder /career-ops cover {slug}
/career-ops email     → Formeller Bewerbungs-E-Mail-Entwurf (nur Entwurf; sendet, reicht ein oder klickt nie)
/career-ops add       → Projekt/Paper/Rolle zum Lebenslauf hinzufügen (laden + Vorschau + bestätigen)
/career-ops expand    → Fehlende Kompetenzen aus Profil-Links automatisch entdecken und ergänzen
/career-ops training  → Kurs/Zertifikat gegen den North Star bewerten
/career-ops project   → Portfolio-Projektidee bewerten
/career-ops tracker   → Übersicht über den Bewerbungsstatus
/career-ops agent-inbox → Anfragen für die nächste Session einreihen/abarbeiten (data/agent-inbox.md)
/career-ops apply     → Live-Bewerbungsassistent (liest das Formular + erzeugt Antworten)
/career-ops scan      → Portale scannen und neue Angebote entdecken
/career-ops discover  → Unternehmensliste in scannbare ATS-Boards auflösen + an portals.yml anhängen (ohne Tokens)
/career-ops batch     → Batch-Verarbeitung mit parallelen Workern
/career-ops patterns  → Ablehnungsmuster analysieren und Zielrichtung verbessern
/career-ops offer-prep → Ein erhaltenes Angebot/einen Vertrag mit dem Kandidaten lesen: Klauseln durchgehen + Fragen für den Anwalt (keine Rechtsberatung)
/career-ops titles    → Verwandte Jobtitel aus deinem Lebenslauf vorschlagen, um die Suche zu erweitern
/career-ops upskill   → Aggregierte Skill-Gap-Analyse aus deinen bewerteten Reports
/career-ops followup  → Follow-up-Kadenz-Tracker: Überfällige markieren, Entwürfe erzeugen
/career-ops reply-watch → Arbeitgeber-Antworten klassifizieren und Tracker-Updates vorschlagen
/career-ops outcome   → Bewerbungsergebnis erfassen & Artefakte archivieren
/career-ops calibrate → Beratender Report: Sagen deine Bewertungen deine echten Ergebnisse voraus? Liest /outcome-Daten; ändert nie die Bewertung
/career-ops update    → career-ops-Systemdateien aktualisieren mit Diff-Vorschau + Kompatibilitätsprüfung
```

Oder füge einfach eine Stellen-URL oder Stellenbeschreibung direkt ein: career-ops erkennt sie automatisch und startet die komplette Pipeline.

In Codex sind Slash Commands nicht garantiert. Nutze stattdessen dieselben Modusnamen in einem Prompt oder rufe sie über `codex exec` auf.

## Wie es funktioniert

```
You paste a job URL or description
        │
        ▼
┌──────────────────┐
│  Archetype       │  Classifies: LLMOps / Agentic / PM / SA / FDE / Transformation
│  Detection       │
└────────┬─────────┘
         │
┌────────▼─────────┐
│  A-H Evaluation  │  Match, gaps, comp research, STAR stories, legitimacy
│  (reads cv.md)   │
└────────┬─────────┘
         │
    ┌────┼────┐
    ▼    ▼    ▼
 Report  PDF  Tracker
  .md   .pdf  entry
```

## Vorkonfigurierte Portale

Der Scanner kommt mit **100+ Unternehmen**, die sofort gescannt werden können, und **45+ Suchanfragen** über die großen Jobbörsen. Kopiere `templates/portals.example.yml` nach `portals.yml` und füge deine eigenen hinzu:

**AI Labs:** Anthropic, OpenAI, Mistral, Cohere, LangChain, Pinecone
**Voice AI:** ElevenLabs, PolyAI, Parloa, Hume AI, Deepgram, Vapi, Bland AI
**AI-Plattformen:** Retool, Airtable, Vercel, Temporal, Glean, Arize AI
**Contact Center:** Ada, LivePerson, Sierra, Decagon, Talkdesk, Genesys
**Enterprise:** Salesforce, Twilio, Gong, Dialpad
**LLMOps:** Langfuse, Weights & Biases, Lindy, Cognigy, Speechmatics
**Automatisierung:** n8n, Zapier, Make.com
**Europa:** Factorial, Attio, Tinybird, Clarity AI, Travelperk

**Durchsuchte Jobbörsen:** 55+ Provider-Module decken ATS-APIs, Feeds ganzer Jobbörsen, XML/RSS-Feeds, Markdown-Feeds und lokale Parser ab. Die vollständige Tabelle steht unter [Unterstützte Jobbörsen](docs/SUPPORTED_JOB_BOARDS.md).

Standardmäßig vertraut `node scan.mjs` (alias `npm run scan`) dem, was jeder ATS-Feed zurückgibt. Manche Unternehmen lassen veraltete Anzeigen in ihrer öffentlichen API stehen, auch wenn die Stelle längst geschlossen ist, sodass diese abgelaufenen Einträge in `pipeline.md` durchsickern können. Übergib `--verify`, um nach dem API-Durchlauf Playwright zu starten und abgelaufene Anzeigen zu verwerfen, bevor sie die Pipeline erreichen:

```bash
node scan.mjs --verify          # zero-token discovery + Playwright liveness check
```

Die Prüfung läuft sequenziell und nur über neue Angebote (nach dem Deduplizieren), sodass die Kosten begrenzt bleiben.

## Dashboard TUI

Das eingebaute Terminal-Dashboard lässt dich deine Pipeline visuell durchsuchen:

```bash
npm run serve:dashboard   # launch the TUI
npm run build:dashboard   # optional: build the standalone binary
```

Features: 6 Filter-Tabs, 4 Sortiermodi, gruppierte/flache Ansicht, Vorschauen mit Lazy Loading, Statusänderungen inline.

Es gibt außerdem eine **experimentelle Web-UI** (Alpha, opt-in: Nichts läuft, solange du sie nicht startest): siehe [`web/README.md`](web/README.md).

## Projektstruktur

```
career-ops/
├── AGENTS.md                    # Canonical agent instructions (all CLIs)
├── CLAUDE.md                    # Claude Code wrapper (imports AGENTS.md)
├── CODEX.md                     # Codex wrapper (imports AGENTS.md)
├── OPENCODE.md                  # OpenCode wrapper (imports AGENTS.md)
├── GEMINI.md                    # Legacy no-op guard to avoid Antigravity duplicate context
├── cv.md                        # Your CV (create this)
├── article-digest.md            # Your proof points (optional)
├── config/
│   └── profile.example.yml      # Template for your profile
├── modes/                       # Skill modes
│   ├── _shared.md               # Shared context (customize this)
│   ├── oferta.md                # Single evaluation
│   ├── pdf.md                   # PDF generation
│   ├── cover.md                 # Cover letter generation
│   ├── email.md                 # Formal application email drafts
│   ├── scan.md                  # Portal scanner
│   ├── batch.md                 # Batch processing
│   └── ...
├── templates/
│   ├── cv-template.html         # ATS-optimized CV template
│   ├── portals.example.yml      # Scanner config template
│   └── states.yml               # Canonical statuses
├── batch/
│   ├── batch-prompt.md          # Self-contained worker prompt
│   └── batch-runner.sh          # Orchestrator script
├── dashboard/                   # Go TUI pipeline viewer
├── data/                        # Your tracking data (gitignored)
├── reports/                     # Evaluation reports (gitignored)
├── output/                      # Generated PDFs (gitignored)
├── fonts/                       # Space Grotesk + DM Sans
├── docs/                        # Setup, customization, budget guide, architecture
└── examples/                    # Sample CV, report, proof points
```

## Externes Datenverzeichnis (optional)

Standardmäßig liegen die Daten der Nutzerebene (etwa `cv.md`, `portals.yml` und die Ordner `data/`, `reports/`, `output/`) im Wurzelordner des Projekts.

Um deine persönlichen Daten vom Code zu trennen (damit du leichter Branches wechseln, Updates ziehen oder mehrere Profile testen kannst), kannst du ein externes Datenverzeichnis mit folgender Rangfolge konfigurieren:

1. **Umgebungsvariablen:** Setze die Variable `CAREER_OPS_ROOT` oder `CAREER_OPS_DATA_DIR`:
   ```bash
   export CAREER_OPS_ROOT=~/my-career-data
   ```
2. **Marker-Datei:** Lege im Repository-Wurzelverzeichnis eine Datei `.career-ops-data` an, die den Pfad zu deinem Datenverzeichnis enthält.
3. **Standard:** Fällt auf das Repository-Wurzelverzeichnis zurück.

Sobald das aufgelöst ist, werden alle Nutzerdateien relativ zu diesem Ordner aufgelöst und geschrieben, während Prompt-Dateien und Skripte weiterhin relativ zum Repository aufgelöst werden.

- **Tracker überschreiben:** Du kannst auch `CAREER_OPS_TRACKER` setzen, um den Pfad der Bewerbungs-Tracker-Datei direkt zu überschreiben.
- **Schreibvorgänge:** Alle Schreibvorgänge (etwa Merges) zielen kanonisch auf `{DATA_ROOT}/data/applications.md`.

Das Go-Dashboard-TUI, die Node.js-Skripte und die KI-Agentenmodi respektieren diese Auflösungshierarchie automatisch.


## Tech Stack

![Claude Code](https://img.shields.io/badge/Claude_Code-000?style=flat&logo=anthropic&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-2EAD33?style=flat&logo=playwright&logoColor=white)
![Go](https://img.shields.io/badge/Go-00ADD8?style=flat&logo=go&logoColor=white)
![Bubble Tea](https://img.shields.io/badge/Bubble_Tea-FF75B5?style=flat&logo=go&logoColor=white)

- **Agent**: KI-Coding-CLI mit gemeinsamen Skills und Modi (`AGENTS.md` + CLI-Wrapper)
- **PDF**: Playwright + HTML-Template
- **Anschreiben**: HTML-Template + Playwright (A4-PDF, dieselbe Pipeline wie Lebensläufe)
- **Scanner**: Playwright + Greenhouse-API + WebSearch
- **Dashboard**: Go + Bubble Tea + Lipgloss (Catppuccin-Mocha-Theme)
- **Daten**: Markdown-Tabellen + YAML-Konfiguration + TSV-Batch-Dateien

## Ebenfalls Open Source

- **[cv-santiago](https://github.com/santifer/cv-santiago)**: Die Portfolio-Website (santifer.io) mit KI-Chatbot, LLMOps-Dashboard und Case Studies. Wenn du ein Portfolio brauchst, das deine Jobsuche begleitet, fork es und mach es zu deinem eigenen.

## FAQ

**Was ist career-ops?**
career-ops ist eine quelloffene KI-Jobsuche, die lokal in deiner KI-Coding-CLI läuft (Claude Code, Codex, OpenCode und andere) und jede Entscheidung dir überlässt. Es bewertet Stellenangebote gegen deinen Lebenslauf, erzeugt ATS-optimierte PDFs, findet die richtige Kontaktperson und verfolgt alles an einem Ort: Die finale Entscheidung liegt immer bei dir. Es ist die erste Referenzimplementierung des CareerOps-Manifests. Mehr auf [career-ops.org](https://career-ops.org).

**Kann der zugeschnittene Lebenslauf etwas erfinden?**
Er darf es nicht, und die Prompts sagen das: umformulieren, nie erfinden. Diese Regel wird noch nicht durch eine Prüfung im Code erzwungen. Zwei offene Issues verfolgen das: [#2677](https://github.com/career-ops-hq/career-ops/issues/2677) (Jobtitel müssen zu cv.md passen) und [#1411](https://github.com/career-ops-hq/career-ops/issues/1411) (Treueprüfung, die bei Verstoß blockiert). Bis sie gemergt sind: Lies jeden Lebenslauf, bevor du ihn abschickst. Der [Haftungsausschluss](LEGAL_DISCLAIMER.md) sagt dasselbe mit mehr Worten.

**Kann ich career-ops kostenlos oder mit einem günstigeren / lokalen Modell nutzen?**
Ja. career-ops ist CLI-unabhängig und läuft mit kostenlosen und lokalen Modellen (über kostenlose OpenRouter-Modelle, Ollama oder jeden OpenAI-kompatiblen Endpoint), sodass du nicht an ein kostenpflichtiges Abo gebunden bist. Die vollständige Einrichtung findest du in [docs/RUNNING_ON_A_BUDGET.md](docs/RUNNING_ON_A_BUDGET.md).

**Ich zahle für Claude Pro/Max, aber career-ops verbraucht API-Guthaben. Warum?**
Weil ein `ANTHROPIC_API_KEY` in deiner Umgebung Vorrang vor deinem eingeloggten Abo hat: Die CLI nutzt den Schlüssel und rechnet pro Token ab. Führe `echo $ANTHROPIC_API_KEY` aus, und falls etwas ausgegeben wird, entferne den Schlüssel aus deinem Shell-Profil, starte das Terminal neu und führe `/login` aus. Der Batch-Modus ist die Ausnahme, weil `claude -p`-Worker den interaktiven Login nicht nutzen: Führe einmal `claude setup-token` aus und exportiere das Ergebnis als `CLAUDE_CODE_OAUTH_TOKEN`. Die vollständige Anleitung steht in [docs/RUNNING_ON_A_BUDGET.md](docs/RUNNING_ON_A_BUDGET.md#2b-already-paying-for-a-subscription-make-sure-you-are-using-it).

**Mit welchen KI-CLIs funktioniert career-ops?**
career-ops läuft mit jeder gängigen KI-Coding-CLI (Claude Code, Codex, Gemini / Antigravity, OpenCode, Grok, Qwen und mehr) über den offenen Agent Skill Standard, ist also nie an einen einzelnen Anbieter gebunden. Nutze die CLI, die du bereits hast.

**Wie installiere ich career-ops unter Windows?**
career-ops läuft unter Windows. Die plattformspezifische Einrichtung und die bekannten Stolpersteine (Git-Bash-Erkennung, Zeilenenden, Aufgabenplanung) stehen in [docs/WINDOWS.md](docs/WINDOWS.md). Falls Skills während der Installation mit einem Symlink-Fehler nicht laden, steht die Lösung in [docs/FAQ.md](docs/FAQ.md). Die vollständigen Schritte findest du in [docs/SETUP.md](docs/SETUP.md).

**Bewirbt sich career-ops automatisch für mich?**
Nein. career-ops ist ein Filter, kein Spray-and-Pray-Auto-Bewerber. Die KI bewertet, sortiert und entwirft; du prüfst und entscheidest. Sie reicht nie etwas ein, sendet nichts und klickt nichts: Die finale Entscheidung liegt immer bei dir. Genau dieses Human-in-the-Loop-Design ist der Kern der Sache.

**Ist career-ops kostenlos und Open Source?**
Ja. career-ops ist kostenlos und Open Source, und für Bewerber:innen wird es das immer bleiben: Es ist die erste Referenzimplementierung des [CareerOps-Manifests](https://career-ops.org/manifesto). Lies es, und wenn es sagt, woran du glaubst, unterschreib es.

## Über den Autor

Ich bin [Santiago Fernández de Valderrama Aparicio](https://santifer.io/about) (santifer): Head of Applied AI, ehemaliger Gründer (ich habe ein Unternehmen aufgebaut und verkauft, das bis heute mit meinem Namen läuft). Ich habe career-ops gebaut, um meine eigene Jobsuche zu steuern. Es hat funktioniert: Ich habe damit meine aktuelle Stelle bekommen.

Neugierig, wie dieses Repository in etwa 4 Stunden pro Woche gepflegt wird? Lies [Agentic maintenance: how career-ops is run by a fleet of AI agents](https://santifer.io/ai-agent-fleet).

Mein Portfolio und weitere Open-Source-Projekte → [santifer.io](https://santifer.io)

Wikidata: [Santiago Fernández de Valderrama Aparicio](https://www.wikidata.org/wiki/Q138710224) · [career-ops](https://www.wikidata.org/wiki/Q139007988).

## Haftungsausschluss

**career-ops ist ein lokales Open-Source-Tool, KEIN gehosteter Service.** Mit der Nutzung dieser Software erkennst du an:

1. **Du kontrollierst deine Daten.** Dein Lebenslauf, deine Kontaktdaten und persönlichen Daten bleiben auf deinem Rechner und werden direkt an den KI-Anbieter gesendet, den du auswählst (Anthropic, OpenAI usw.). Wir sammeln, speichern oder sehen keine deiner Daten.
2. **Du kontrollierst die KI.** Die Standard-Prompts weisen die KI an, Bewerbungen nicht automatisch abzusenden, aber KI-Modelle können sich unvorhersehbar verhalten. Wenn du die Prompts änderst oder andere Modelle nutzt, tust du das auf eigenes Risiko. **Prüfe KI-generierte Inhalte immer auf Richtigkeit, bevor du sie absendest.**
3. **Du hältst dich an die AGB Dritter.** Du musst dieses Tool im Einklang mit den Nutzungsbedingungen der Karriereportale verwenden, mit denen du interagierst (Greenhouse, Lever, Workday, LinkedIn usw.). Nutze dieses Tool nicht, um Arbeitgeber zu spammen oder ATS-Systeme zu überlasten.
4. **Keine Garantien.** Bewertungen sind Empfehlungen, keine Wahrheit. KI-Modelle können Kenntnisse oder Erfahrungen halluzinieren. Die Autor:innen haften nicht für Beschäftigungsergebnisse, abgelehnte Bewerbungen, Kontosperren oder andere Folgen.

Siehe [LEGAL_DISCLAIMER.md](LEGAL_DISCLAIMER.md) für alle Details. Diese Software wird unter der [MIT-Lizenz](LICENSE) „wie besehen“ bereitgestellt, ohne Gewährleistung jeglicher Art.

## Mitwirkende

<a href="https://github.com/career-ops-hq/career-ops/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=career-ops-hq/career-ops" />
</a>

Alle, die Code, Dokumentation, Übersetzungen oder Tests beigesteuert haben, stehen in
[CONTRIBUTORS.md](CONTRIBUTORS.md), einschließlich der Beiträge ohne Code, die
die Grafik oben nicht zeigen kann.

Mit career-ops eingestellt worden? [Teile deine Geschichte!](https://github.com/career-ops-hq/career-ops/issues/new?template=i-got-hired.yml)

## Lizenz & Trademark

Der Code steht unter der [MIT](LICENSE)-Lizenz. Der Name und die Marke
„career-ops“ unterliegen der [Trademark Policy](TRADEMARK.md): offen
für die Community-Nutzung, reserviert für kommerzielle Produktnamen und
Endorsements.

## Auszeichnungen

<p align="center">
  <a href="https://warpchart.dev/hq">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://warpchart.dev/api/chart?theme=dark&v=3">
      <img alt="Live star telemetry of career-ops-hq/career-ops" src="https://warpchart.dev/api/chart?theme=light&v=3" loading="lazy">
    </picture>
  </a>
</p>

<p align="center">
  <a href="https://discord.gg/8pRpHETxa4"><img src="https://img.shields.io/badge/Join_the_community-Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord"></a>
</p>

<p align="center">
  <a href="https://github.com/career-ops-hq/career-ops/releases/latest"><img src="https://img.shields.io/npm/v/%40santifer%2Fcareer-ops?style=for-the-badge&labelColor=2b3137&color=2ea44f&label=release" alt="Latest release"></a>
</p>

<p align="center">
  <a href="https://claude.com/claude-code"><img src="https://img.shields.io/badge/Built_with-Claude_Code-000?style=for-the-badge&logo=anthropic&logoColor=white" alt="Built with Claude Code"></a>
</p>

<p align="center">
  <sub>Läuft auch in jeder CLI nach dem Agent-Skill-Standard. Siehe <a href="docs/SUPPORTED_CLIS.md">Unterstützte CLIs</a>.</sub><br>
  <img src="https://img.shields.io/badge/Claude_Code-000?style=flat&logo=anthropic&logoColor=white" alt="Claude Code">
  <img src="https://img.shields.io/badge/OpenCode-111827?style=flat&logo=terminal&logoColor=white" alt="OpenCode">
  <img src="https://img.shields.io/badge/Antigravity_CLI-4285F4?style=flat&logo=google&logoColor=white" alt="Antigravity CLI">
  <img src="https://img.shields.io/badge/Codex-412991?style=flat&logo=openai&logoColor=white" alt="Codex">
  <img src="https://img.shields.io/badge/Qwen-615CED?style=flat" alt="Qwen">
  <img src="https://img.shields.io/badge/Kimi-FF4B4B?style=flat" alt="Kimi">
  <img src="https://img.shields.io/badge/GitHub_Copilot-000?style=flat&logo=githubcopilot&logoColor=white" alt="GitHub Copilot">
  <img src="https://img.shields.io/badge/Grok_Build_CLI-000?style=flat&logo=x&logoColor=white" alt="Grok Build CLI">
  <br>
  <img src="https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/Go-00ADD8?style=flat&logo=go&logoColor=white" alt="Go">
  <img src="https://img.shields.io/badge/Playwright-2EAD33?style=flat&logo=playwright&logoColor=white" alt="Playwright">
  <img src="https://img.shields.io/badge/Bubble_Tea-FF75B5?style=flat&logo=go&logoColor=white" alt="Bubble Tea">
  <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT">
  <a href="TRADEMARK.md"><img src="https://img.shields.io/badge/Trademark-Policy-blue.svg" alt="Trademark Policy"></a>
</p>

## Kontakt

[![Website](https://img.shields.io/badge/santifer.io-000?style=for-the-badge&logo=safari&logoColor=white)](https://santifer.io)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white)](https://linkedin.com/in/santifer)
[![X](https://img.shields.io/badge/X-000?style=for-the-badge&logo=x&logoColor=white)](https://x.com/santifer)
[![Discord](https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/8pRpHETxa4)
[![Email](https://img.shields.io/badge/Email-EA4335?style=for-the-badge&logo=gmail&logoColor=white)](mailto:hi@santifer.io)
