# Projektanalys: Career-Ops Pro → CareerPilot AI

> FAS 0, verifierad 2026-08-06. Produktnamnet planeras bli **CareerPilot AI**, men projektmappen, runtime-identifierare och app-bundle heter fortsatt **Career-Ops-Pro/Career-Ops** tills en senare godkänd migreringsfas.

## Omfattning och skyddsräcken

Analysen är utförd i originalprojektet `/Volumes/LaCie/Hermes-Projects/Career-Ops-Pro`. Ingen flytt, namnändring, radering, commit eller push har gjorts. Befintlig Git-historik, kod, integrationer och användarlager har bevarats. Hemligheter och verkliga användarprofiler har inte lästs eller återgivits.

## Projektstruktur

| Område | Sökvägar | Ansvar |
|---|---|---|
| Kärn-CLI och domänlogik | rotens `*.mjs`, `lib/`, `modes/`, `templates/` | sökning, CV-generering, ansökningar, offerter, pipeline och rapporter |
| Webbfrontend | `web/src/app/`, `web/src/components/` | Next.js App Router, svensk dashboard, formulär och serverrenderade vyer |
| Webbbackend/API | `web/src/app/api/`, `web/src/lib/` | lokala API-routes, filbaserade repositories, automation och integrationer |
| Native macOS | `desktop/` | Cocoa/Swift-appen med `WKWebView`, installation och LaunchAgents |
| Automation | `scan.mjs`, `scheduler.mjs`, `scripts/`, `web/src/lib/automation-*` | schemalagd jobbsökning, filtrering, rankning och övervakning |
| Leverantörer | `providers/`, `provider-runner.mjs` | jobbportaler och provider-adaptrar |
| Konfiguration | `config/`, `portals.yml` | masterprofil, marknads-/portalinställningar och policyer |
| Användardata | `cv.md`, `data/`, `reports/`, `output/`, `local/` | CV, pipeline, sökhistorik, rapporter och lokala artefakter; git-ignorerade |
| Tester | `tests/`, `test/`, `web/tests/`, `fixtures/` | kärn-, regressions-, webb- och integrationstester |
| Drift | `Dockerfile`, `docker-compose.yml`, `desktop/install-*.mjs` | container- och fristående macOS-runtime |
| Dokumentation | `README.md`, `docs/` | användning, arkitektur och drift |

## Teknikstack

- **JavaScript/Node.js ESM** för kärna, CLI, providers, scheduler och testverktyg.
- **TypeScript + React 19 + Next.js 16 App Router** för webbgränssnitt och server-API.
- **Tailwind CSS 4**, Radix UI och Lucide för UI.
- **Swift/Cocoa + WebKit (`WKWebView`)** för native Intel-macOS-appen.
- **YAML, Markdown, TSV och JSON** som lokal persistens. Projektet har ingen central SQL-databas, ORM eller fjärrdatabas som driftkrav.
- **Playwright/Chromium** för browser-, PDF- och integrationsflöden.
- **Node `node:test`** som primär testmotor.
- **Docker/Compose** som alternativ runtime.

## Frontend

`web/src/app` innehåller App Router-sidor för bland annat dashboard, ansökningar, CV, dokument, onboarding, providers, inställningar och jobbbevakning. Komponenterna ligger i `web/src/components`. Sidorna använder lokala `/api/*`-routes och är byggbara som fristående Next.js-server.

## Backend och API:er

Backend är inbyggd i Next.js och kompletterar rotens CLI-moduler. API-ytan omfattar bland annat:

- profil och CV: `/api/profile`, `/api/cv`, `/api/cv/ingest`
- ansökningar och arbetsflöden: `/api/applications`, `/api/apply`, `/api/work`
- jobbsökning och automation: `/api/explore`, `/api/providers`, `/api/scheduler`, `/api/automation`
- integrationer och drift: `/api/integrations`, `/api/settings`, `/api/setup`, `/api/status`, `/api/health`
- dokument, e-post, onboarding, rollback och streaming.

Readiness är korrekt separerad till den billiga `/api/health`; `/api/status` är den rikare statusytan.

## AI-moduler

- OmniRoute-klienten i `web/src/lib/omniroute-client.mjs` hämtar gatewaystatus och förbättrar jobbrankning.
- Deterministisk lokal rankning är fallback, så extern AI är inte ett driftkrav.
- CV-ingest kan läsa text lokalt och använda AI för strukturerad konvertering av mer komplexa dokument.
- Kärnans modes/prompter och providerflöden använder profilen och CV:t som kontext.
- Automatiska jobbansökningar är inte tillåtna utan uttryckligt användargodkännande.

## Databas och lagring

Det finns ingen relationsdatabas. Lagringen är avsiktligt lokal och filbaserad:

- `config/profile.yml`: kandidat- och sökprofil.
- `cv.md`: aktivt CV.
- `data/*.md|*.tsv|*.json`: pipeline, ansökningar, sökhistorik och runtime-state.
- `reports/` och `output/`: genererade resultat.

Användarlagret är git-ignorerat. Befintliga webbskrivningar är atomiska och skapar tidsstämplad backup, men privata filrättigheter och explicit CV-versionsindex saknades vid FAS 0.

## Byggsystem och beroenden

- Roten använder npm och Node ESM men saknar rot-`package-lock.json`.
- `web/` har egen `package-lock.json`, TypeScript-konfiguration och Next.js-build.
- Native-appen kompileras från `desktop/CareerOpsApp.swift` och installeras tillsammans med en fristående runtime och separata dashboard-/scheduler-LaunchAgents.
- Dockerbilden bygger kärna och webb i flera steg.

Verifierad miljö: Node `v24.14.1`, npm `11.18.0`.

## Git-baslinje

Aktiv gren vid FAS 0: `feat/professional-navigation`.

Arbetskopian var redan smutsig innan denna beställning. Befintliga ändringar omfattar navigation, native desktop/runtime, automation, readiness och OmniRoute. De betraktas som tidigare arbete och får inte skrivas över. FAS 0 tillför endast denna rapport.

## Vad som fungerar

- Live native-runtime svarade `200` på `/api/health`, `/watch` och `/api/automation`.
- Webbens fulla testkommando passerade: **21/21 tester**.
- TypeScript-kontroll passerade.
- Next.js produktionsbuild passerade.
- Rotens `node test-all.mjs --quick` passerade efter installation av deklarerade rotberoenden.
- npm rapporterade **0 kända sårbarheter** för de installerade rotberoendena.
- CV kan redigeras, importeras från text/Markdown och säkerhetssparas atomiskt med backup.
- Profilen kan deep-merge-uppdateras utan att okända YAML-fält förloras.
- Jobbautomation, deterministisk rankning och OmniRoute-fallback finns.
- Native Cocoa/`WKWebView`-app, separat runtime och LaunchAgents finns i arbetskopian.

## Vad som inte fungerar eller saknas

1. En ren rotklon kan inte köra testsuiten direkt eftersom rotens beroenden saknar lockfil och inte är installerade. Första försöket gav `ERR_MODULE_NOT_FOUND: js-yaml`.
2. Career Master Profile har ingen komplett läs-/redigeringsvy; `/api/profile` är huvudsakligen en skrivyta.
3. CV-lagringen har endast aktiv `cv.md` plus lösa backupfiler, inte en indexerad versionshistorik med återställning.
4. Den lokala lagringen garanterar inte ägarbehörighet (`0600`) för varje privat fil eller `0700` för privata kataloger.
5. Det saknas en explicit, lokal ATS-analysmodell/API med förklarbar poäng och keyword-gap.
6. Native Swift-källan innehåller en miljöstyrd verifierings-/snapshot-hook. Den är inaktiv normalt men bör tas bort i en senare, separat städfas efter att befintligt arbete har säkrats.

## Identifierade buggar och avvikelser

| Allvar | Problem | Bevis/konsekvens |
|---|---|---|
| Medel | Rotberoenden saknas i ren arbetsmiljö | `test-all --quick` föll på saknat `js-yaml`; `npm install --no-package-lock --ignore-scripts` löste baslinjen |
| Medel | Ingen verklig CV-versionering | endast `cv.md` och tidsstämplade `.bak-*`; ingen listning/restore/metadata |
| Medel | Privata filrättigheter är implicita | processens umask styr rättigheter; PII kan bli mer läsbar än avsett |
| Medel | Profilen saknar komplett GET/UI-kontrakt | svårt att verifiera och redigera masterdata från produkten |
| Låg | ATS-readiness är endast en enkel CV-längdsignal | ger inte rollspecifika nyckelord, sektionstäckning eller förbättringsförslag |
| Låg | Debug-snapshotkod finns kvar i native-källan | risk för oavsiktlig verifieringsartefakt; inte aktiv utan miljövariabel |

## Förbättringsmöjligheter

- Inför ett explicit repository-lager för masterprofil och CV-versioner.
- Sätt privata fil-/katalogrättigheter vid varje skrivning och undvik symlink-följning för user layer.
- Lägg till schema/normalisering ovanpå befintlig YAML utan att kasta okända fält.
- Gör ATS-poäng deterministisk och förklarbar; låt AI vara en valfri förbättring senare.
- Lägg kontraktstester runt API-routes och filformat.
- Skapa och committa en rot-lockfil i en senare godkänd beroendefas.
- Separera historiska, ännu ej committade desktop/automation-ändringar från kommande produktfaser.

## Risker

- **PII-risk:** profil, CV och ansökningsdata innehåller personuppgifter.
- **Dataförlust:** filbaserad lagring kräver atomiska skrivningar, versioner och återställning.
- **Schema-drift:** `profile.yml` är omfattande; en förenklad UI-modell får inte skriva bort okända fält.
- **Samtidighet:** flera API-skrivningar kan skapa konkurrerande versioner; unika ID:n och atomiska indexskrivningar krävs.
- **Externa tjänster:** OmniRoute och jobbportaler kan vara intermittenta; lokala fallbacks måste bestå.
- **Smutsig arbetskopia:** tidigare ändringar kan blandas ihop med FAS 1 om filredovisningen inte är strikt.
- **ExFAT-projektvolym:** filrättigheter på projektvolymen kan ha andra semantiker än APFS. Installerad runtime under Application Support är säkrare för produktion.

## Rekommenderad utvecklingsplan

1. **FAS 1 – kandidatfundament:** masterprofil, CV-import, indexerade CV-versioner, säkra user-layer-skrivningar och lokal ATS-grund.
2. **FAS 2 – profil/CV-produktisering:** validering, versionsjämförelse, selektiv återställning och förbättrad tillgänglighet.
3. **FAS 3 – ATS och jobbanpassning:** rollspecifik analys, kravextraktion, bevismappning och human-in-the-loop.
4. **FAS 4 – produktnamnsmigrering:** byt UI-, bundle-, LaunchAgent- och runtime-identitet till CareerPilot AI först efter full regressions- och migreringstestning.
5. **FAS 5 – leveranshärdning:** rot-lockfil, CI-matris, signerad macOS-release, backup/restore-test och dokumenterad rollback.

## FAS 1:s avgränsade acceptanskriterier

- Profilen kan läsas och deep-merge-sparas utan förlust av okända fält.
- CV-import accepterar säkra, tillåtna format och storleksgränser.
- Varje sparat/importerat CV får en listbar, återställningsbar version med metadata.
- Privata filer försöker sättas till `0600` och privata mappar till `0700`.
- ATS-analys returnerar deterministisk poäng, styrkor, varningar och saknade nyckelord.
- Befintliga tester, TypeScript och produktionsbuild förblir gröna.
- Ingen mapp-, app- eller projektnamnändring görs.

## FAS 1 – implementerat och verifierat

- Career Master Profile exponeras i `/cv` och deep-merge-sparas i `config/profile.yml`.
- CV-importen använder format- och 10 MB-gräns; sparning skapar oföränderliga versioner.
- Versionshistorik kan listas och återställas utan att äldre versioner skrivs över.
- ATS-grunden ger lokal, deterministisk struktur- och nyckelordsanalys.
- Isolerat HTTP-test verifierade tre CV-versioner, ATS-score och `0600/0700` på APFS.
- Produktnamn, projektmapp, bundle-identifierare och LaunchAgents är oförändrade.
