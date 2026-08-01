# Modus: vacature -- Volledige evaluatie A-F

Wanneer de kandidaat een vacature (tekst of URL) plakt, lever dan ALTIJD alle 6 blokken aan.

## Stap 0 -- Archetypedetectie

Classificeer de vacature in een van de 6 archetypen (zie `_shared.md`). Indien hybride: geef de twee dichtstbijzijnde aan. Dit bepaalt:
- Welk bewijs wijst op prioriteit in blok B
- Hoe herschrijf je de samenvatting in blok E
- Welke STAR-verhalen moet je voorbereiden in blok F

## Blok A -- Rolsamenvatting

Tabel met:
- Archetype gedetecteerd
- Domein (Platform / Agentic / LLMOps / ML / Enterprise)
- Functie (Bouw / Consulting / Beheer / Implementatie)
- Senioriteitsniveau
- Op afstand (volledig op afstand / hybride / ter plaatse)
- Teamgrootte (indien vermeld)
- TL;DR in 1 zin

## Blok B - Match met CV

Lees `cv.md`. Maak een tabel waarin elke voorwaarde van de vacature wordt weergegeven op de exacte regels van het CV.

**Aangepast aan het archetype:**
- FDE -> geef prioriteit aan proof points voor snelle levering en nabijheid bij de klant
- SA -> geeft prioriteit aan systeemontwerp en -integraties
- PM -> geef prioriteit aan productontdekking en metrics
- LLMOps -> prioriteit geven aan evaluaties, observability, pipelines
- Agentisch -> geef prioriteit aan multi-agent, HITL, orkestratie
- Transformatie -> prioriteit geven aan verandermanagement, adoptie en opschaling

**Hiaten**: geef voor elk hiaat een mitigatiestrategie:
1. Is het een harde blokkering of een nice-to-have?
2. Kan de kandidaat aangrenzende ervaring aantonen?
3. Bestaat er een portfolioproject dat deze leemte overbrugt?
4. Concreet mitigatieplan (zin voor begeleidende brief, snel miniproject, enz.)

## Blok C -- Niveau en strategie

1. **Niveau gedetecteerd** in de vacature versus **natuurlijk niveau van de kandidaat voor dit archetype**
2. **Plan “Verkoop senior zonder te liegen”**: specifieke formuleringen aangepast aan het archetype, concrete prestaties om te benadrukken, hoe de ervaring van de oprichter als een troef te positioneren
3. **Plan "als ik downlevel ben"**: accepteer als de beloning eerlijk is, onderhandel over een evaluatie van zes maanden, duidelijke promotiecriteria

## Blok D -- Beloning en vraag

Gebruik WebSearch om:
- Huidige salarissen voor de functie (Glassdoor, Levels.fyi, Intermediair, Indeed Salarissen, Jobat, StepStone)
- Reputatie van de beloning bij het bedrijf (Glassdoor en andere betrouwbare bronnen)
- Evolutie van de vraag naar de rol op de Nederlandstalige markt

Tabel met gegevens en geciteerde bronnen. Als er geen gegevens zijn, vermeld dit dan duidelijk - verzin het niet.

**Nederland en België -- Verplichte verificaties:**
- Welk land, welke cao of welk paritair comité is van toepassing?
- Is het salaris exclusief of inclusief vakantiegeld, dertiende maand/eindejaarsuitkering en andere vaste componenten?
- Welk deel is variabel (bonus, commissie, winstdeling, aandelen of opties), en onder welke voorwaarden?
- Gaat het om een contract voor onbepaalde of bepaalde tijd? Controleer duur, proeftijd, verlenging en opzegtermijn.
- Welke pensioenregeling of groepsverzekering, zorg-/hospitalisatieverzekering en mobiliteitsvoordelen zijn inbegrepen?
- Freelance of zelfstandig? Controleer tarief, btw, verzekeringen, pensioen, opdrachtduur en risico op schijnzelfstandigheid.

## Blok E -- Personalisatieplan

| # | Sectie | Huidige status | Voorgestelde wijziging | Reden |
| --- | --------- | ------------ | ----------------- | ------------------- |
| 1 | Samenvatting | ... | ... | ... |
| ... | ... | ... | ... | ... |

Top 5 CV-bewerkingen + Top 5 LinkedIn-bewerkingen om de match te maximaliseren.

## Blok F -- Interviewplan

6-10 STAR+R-verhalen afgestemd op de vereisten van de vacature (STAR ​​+ **Reflectie**):

| # | Vacaturevereiste | Verhaal STAR+R | S | T | A | R | Reflectie |
|---|--------------------|-------------|---|---|---|---|------------|

De kolom **Reflectie** geeft weer wat er is geleerd of wat er anders zou worden gedaan. Dit duidt op anciënniteit: junioren beschrijven wat er is gebeurd, senioren leren ervan.

**Verhalenbank:** Als `interview-prep/story-bank.md` bestaat, controleer dan of deze verhalen er al zijn. Voeg anders het nieuws toe. In de loop van de tijd bouwt dit een herbruikbare bank van 5-10 meesterverhalen op die aanpasbaar zijn aan elke interviewvraag.

**Geselecteerd en gepositioneerd volgens het archetype:**
- FDE -> leveringssnelheid en klantnabijheid benadrukken
- SA -> architectonische beslissingen benadrukken
- PM -> benadruk ontdekking en arbitrage
- LLMOps -> benadruk metrics, evaluaties, verharding in productie
- Agentic -> benadruk orkestratie, foutbeheer, HITL
- Transformatie -> benadruk adoptie en organisatorische verandering

Bevat ook:
- 1 aanbevolen case study (welk project te presenteren en hoe)
- Red-flag-vragen en hoe u deze kunt beantwoorden (bijvoorbeeld: "Waarom heeft u uw bedrijf verkocht?", "Had u een team onder uw verantwoordelijkheid?", "Waarom een ​​verandering na zo'n korte tijd?")

---

## Post-evaluatie

**ALTIJD** uitvoeren na blokken A-F:

### 1. Sla het .md-rapport op

Sla de volledige evaluatie op in `reports/{###}-{company-slug}-{YYYY-MM-DD}.md`.

- `{###}` = volgend volgnummer (3 cijfers, nullen opgevuld). Om het atomair toe te wijzen en racecondities te vermijden, zou je `node reserve-report-num.mjs` uitvoeren om het nummer te reserveren (stdout retourneert `{###}`), het rapport schrijven en vervolgens `node reserve-report-num.mjs --release {###}` uitvoeren om de sentinel vrij te geven.
- `{company-slug}` = bedrijfsnaam in kleine letters, zonder spaties (gebruik koppeltekens)
- `{JJJJ-MM-DD}` = huidige datum

**Rapportformaat:**

```markdown
# Evaluatie: {Bedrijf} -- {Functie}

**Datum:** {YYYY-MM-DD}
**Archetype:** {gedetecteerd}
**Score:** {X/5}
**URL:** {URL van de vacature}
**PDF:** {pad of in afwachting}

---

## A) Samenvatting van de functie
(volledige inhoud van blok A)

## B) Match met het cv
(volledige inhoud van blok B)

## C) Niveau en strategie
(volledige inhoud van blok C)

## D) Beloning en marktvraag
(volledige inhoud van blok D)

## E) Personalisatieplan
(volledige inhoud van blok E)

## F) Sollicitatiegesprekplan
(volledige inhoud van blok F)

## G) Conceptantwoorden voor de sollicitatie
(alleen bij score >= 4,5 -- conceptantwoorden voor het sollicitatieformulier)

---

## Geextraheerde trefwoorden
(lijst van 15-20 trefwoorden uit de vacature voor ATS-optimalisatie)
```

### 2. Opslaan in tracker

**ALTIJD** registreren via een TSV-bestand in `batch/tracker-additions/`; bewerk `data/applications.md` nooit rechtstreeks. Voer vóór voltooiing, in deze volgorde, `node merge-tracker.mjs`, `node verify-pipeline.mjs`, `node normalize-statuses.mjs` en `node dedup-tracker.mjs` uit:
- Volgend opeenvolgend nummer
- De datum van vandaag
- Bedrijf
- Rol
- Status: `Evaluated`
- Gemiddelde score (1-5): uitsluitend een numerieke TSV-waarde met een punt als decimaalteken, bijvoorbeeld `4.2/5`; kopieer geen beschrijvende tekst naar dit veld
- PDF: nee (of ja als de auto-pipeline een PDF heeft gegenereerd)
- Rapport: relatieve link naar het rapportbestand (bijvoorbeeld: `[001](reports/001-company-2026-01-01.md)`)
- Notities: optioneel

**TSV-formaat (door tabs gescheiden):**

```tsv
num	date	company	role	status	score	pdf	report	notes
```
