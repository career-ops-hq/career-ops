# Gedeelde context -- career-ops (Nederlands)

<!-- ============================================================
AANPASSING VAN DIT BESTAND
     ============================================================
Dit bestand bevat de deelcontext voor alle modi
career-ops in de Nederlandse versie. Voordat je career-ops gebruikt, MOET je:
1. Vul config/profile.yml in met uw persoonlijke gegevens
2. Maak cv.md aan in de root van het project (CV in Markdown)
3. (Optioneel) Maak article-digest.md aan met je proof points
4. Vul modes/_profile.md in en pas de secties met [AANPASSEN] hieronder aan
     ============================================================ -->

## Bronnen van waarheid (UITSLUITEND)

Alleen de onderstaande bestanden mogen worden gebruikt voor kandidaatgerichte inhoud. Automatisch geheugen, bovenliggende repositories en aannames uit eerdere sessies vallen buiten deze grens.

| Bestand | Pad | Wanneer |
|--------|--------|-------|
| cv.md | `cv.md` (projectroot) | ALTIJD |
| article-digest.md | `article-digest.md` (indien aanwezig) | ALTIJD (gedetailleerde proof points) |
| profile.yml | `config/profile.yml` | ALTIJD (identiteit en doelrollen) |
| _profile.md | `modes/_profile.md` | ALTIJD (archetypen, verhaal en onderhandeling) |
| writing-samples/ en voice-dna.md | `writing-samples/`, `voice-dna.md` (indien aanwezig) | Bij kandidaatgerichte tekst; gebruik eerst de gecachte sectie `## Writing Style` in `_profile.md` en gebruik voice-dna.md om AI-achtige formuleringen af te vangen en de stem te bewaken |
| interview-prep | `interview-prep/story-bank.md`, `interview-prep/{company}-{role}.md` | Voor formulierantwoorden en sollicitatiegesprekken; bevat eigen STAR-verhalen en notities van de gebruiker |
| _custom.md | `modes/_custom.md` (indien aanwezig) | ALTIJD (vaste opmaak-, inhouds- en workflowregels; geen bron voor feitelijke claims) |

**REGEL: codeer NOOIT metrics uit proof points.** Lees ze uit `cv.md` en `article-digest.md` op het moment van evaluatie.
**REGEL: Voor artikel-/projectmetrics heeft `article-digest.md` voorrang op `cv.md`.**
**REGEL: Lees `_profile.md` NA dit bestand; persoonlijke instellingen daarin hebben voorrang op de standaardwaarden hier.**
**REGEL: Lees `_custom.md` (indien aanwezig) NA `_profile.md` en volg die blijvende procedurele regels in elke modus. `_custom.md` mag geen nieuwe feitelijke claims over de kandidaat introduceren.**
**REGEL: Schrijf een project, repository, library, tool of framework alleen aan de gebruiker toe als `cv.md` of `article-digest.md` dat expliciet ondersteunt.**
**REGEL: Herformuleer trefwoorden, maar verzin ze nooit. Als een claim niet door een toegestane bron wordt ondersteund, vraag het de gebruiker of laat de claim weg.**

---

## North Star - Doelrollen

De vaardigheid behandelt ALLE doelrollen met dezelfde zorg. Geen enkele is primair of secundair; elk is een succes als de beloning en de vooruitzichten op vooruitgang aanwezig zijn:

| Archetype | Thematische assen | Wat het bedrijf koopt |
|--------------|-----------------|-------------------------|
| **AI-platform / LLMOps-ingenieur** | Evaluatie, observability, betrouwbaarheid, pipelines | Iemand die AI met metrics in productie brengt |
| **Agentische workflows / automatisering** | HITL, Tooling, Orchestration, Multi-Agent | Iemand die betrouwbare agentsystemen bouwt |
| **Technische AI-productmanager** | GenAI/agenten, PRD's, ontdekking, levering | Iemand die business vertaalt naar AI-producten |
| **AI-oplossingenarchitect** | Hyperautomatisering, Enterprise, Integraties | Iemand die end-to-end AI-architecturen ontwerpt |
| **AI voorwaarts ingezette ingenieur** | Klantgericht, snelle levering, prototyping | Iemand die AI-oplossingen snel bij de klant inzet |
| **AI-transformatieleider** | Verandermanagement, adoptie, enablement | Iemand die AI-transformatie in organisaties aanjaagt |

<!-- [AANPASSEN] Stem de bovenstaande archetypen af op je doelrollen.
Voorbeeld voor backend-engineering:
- Senior Backend-ingenieur
- Stafplatformingenieur
- Engineeringmanager
enz. -->

### Adaptieve framing op archetype

> **Concrete metrics: lees ze van `cv.md` en `article-digest.md` op het moment van evaluatie. Codeer ze NOOIT hier.**

| Als de rol... | Benadruk de kandidaat... | Bronnen van proof points |
|------------------|-----------------------------------|----------------------|
| Platform / LLMOps | Ervaar productie, observability, evaluaties, closed-loop | article-digest.md + cv.md |
| Agent / Automatisering | Multi-agent orkestratie, HITL, betrouwbaarheid, kosten | article-digest.md + cv.md |
| Technische AI ​​PM | Productontdekking, PRD's, metrics, stakeholdermanagement | cv.md + article-digest.md |
| Oplossingsarchitect | Systeemontwerp, integraties, bedrijfsklaar | article-digest.md + cv.md |
| Voorwaarts ingezette ingenieur | Snelle levering, klantnabijheid, van prototype tot productie | cv.md + article-digest.md |
| AI-transformatieleider | Verandermanagement, team enablement, adoptie | cv.md + article-digest.md |

<!-- [AANPASSEN] Koppel je concrete projecten/artikelen aan de bovenstaande archetypen. -->

### Overgangsverhaal (te gebruiken in ALLE framing)

<!-- [AANPASSEN] Vervang dit door je eigen verhaal. Voorbeelden:
- "SaaS gebouwd en verkocht na 5 jaar. Nu 100% gericht op AI toegepast in het bedrijfsleven."
- "Leid engineering in een Series-B tijdens x10-groei. Op zoek naar de volgende uitdaging."
- "Overgang van advies naar product. Op zoek naar rollen met hoge verantwoordelijkheid."
Lees van config/profile.yml -> narratieve.exit_story -->

Gebruik het transitieverhaal van `config/profile.yml` om ALLE inhoud in te kaderen:
- **In de PDF-samenvattingen:** De kloof overbruggen tussen het verleden en de toekomst -- "Pas nu dezelfde [vaardigheden] toe op het [vacature] domein."
- **In STAR-verhalen:** Raadpleeg de proof points van `article-digest.md`.
- **In de conceptantwoorden (blok G):** Het transitieverhaal staat in het eerste antwoord.
- **Wanneer het vacature "ondernemend", "autonomie", "bouwer", "end-to-end" vermeldt:** Dit is DE nummer 1 onderscheidende factor. Verhoog het wedstrijdgewicht.

### Transversaal voordeel

Positioneer het profiel als **"Technisch bouwer met aantoonbare praktijk"**, waarbij u de kadrering aanpast aan de rol:
- Voor PM: "Bouwer die met prototypes onzekerheid reduceert en vervolgens gedisciplineerd aan productie levert"
- Voor FDE: "Bouwer die op dag 1 levert met observability en metrics"
- Voor SA: "Bouwer die end-to-end systemen ontwerpt met echte integratie-ervaring"
- Voor LLMOps: “Bouwer die AI in productie brengt met gesloten kwaliteitssystemen”

Positioneer ‘bouwer’ als een professioneel signaal – niet als ‘klusjesman’. De echte proof points maken het geloofwaardig.

### Portfolio als bewijspunt (gebruik in toepassingen met hoge inzet)

<!-- [AANPASSEN] Configureer hier je live demo, dashboard of openbare project, indien aanwezig.
Voorbeeld :
dashboard:
url: "https://tondomaine.dev/demo"
wachtwoord: "demo-2026"
wanneer_to_share: "Rollen LLMOps, AI-platform, observability"
Lees van config/profile.yml -> narratieve.proof_points en narratieve.dashboard -->

Indien de kandidaat een live demo/dashboard heeft (controleer `config/profile.yml`), bied dan toegang aan in de betreffende sollicitaties.

### Comp-intelligentie

<!-- [AANPASSEN] Onderzoek salarisschalen voor je doelrollen en pas de waarden aan. -->

**Algemene tips:**
- WebSearch voor actuele marktgegevens (Glassdoor, Levels.fyi, Intermediair, Indeed Salarissen, Jobat, StepStone)
- Frame op functietitel, niet op vaardigheden: titels definiëren salarisschalen
- Vergelijk freelance- en loondiensttarieven niet rechtstreeks: houd rekening met belastingen, sociale lasten, pensioen, verzekeringen, verlof en niet-declarabele tijd
- Geo-arbitrage werkt op afstand: lagere kosten van levensonderhoud = beter netto

### Nederlandstalige markt -- Bijzonderheden (BELANGRIJK)

Nederland en België gebruiken deels dezelfde taal, maar hebben verschillende arbeidsvoorwaarden en regels. Controleer altijd welk land, welke cao of welk paritair comité van toepassing is:

| Termijn | Betekenis | Impact op de evaluatie |
|-------|--------------|-----------------------|
| **Vast of tijdelijk contract** | Arbeidsovereenkomst voor onbepaalde of bepaalde tijd | Controleer duur, verlenging, opzegging en eventuele aanzegging; regels verschillen tussen NL en BE |
| **Cao / paritair comité** | NL: collectieve arbeidsovereenkomst. BE: sectorale cao's via een paritair comité | Kan loonbarema's, werktijd, verlof, toeslagen en pensioen bepalen |
| **Proeftijd** | Alleen geldig binnen de regels van het toepasselijke land en contract | Neem geen standaardduur aan; controleer contract en toepasselijke regelgeving |
| **Opzegtermijn** | Afhankelijk van land, contract, cao en soms anciënniteit | Verifieer vóór het noemen van een startdatum |
| **Vakantiedagen en vakantiegeld** | NL kent wettelijke vakantie-uren en minimaal vakantiegeld; BE kent jaarlijkse vakantie en vakantiegeld via een ander stelsel | Vergelijk het volledige pakket en voorkom dubbeltelling |
| **Dertiende maand / eindejaarsuitkering** | Contractuele of cao-afhankelijke extra betaling | Controleer of deze boven op het genoemde jaarsalaris komt of daarin is inbegrepen |
| **Bonus / winstdeling / winstpremie** | Variabele beloning op individuele, collectieve of bedrijfsresultaten | Vraag naar voorwaarden, doelstelling, historie en gegarandeerd versus variabel deel |
| **Pensioen / groepsverzekering** | NL: vaak pensioenregeling; BE: aanvullend pensioen vaak via groepsverzekering | Controleer werkgevers- en werknemersbijdrage en wat precies is verzekerd |
| **Zorg- en hospitalisatieverzekering** | NL: werknemer sluit doorgaans zelf een zorgverzekering af. BE: hospitalisatieverzekering is een veelvoorkomend extra voordeel | Behandel land en dekking apart; presenteer dit niet als nettoloon |
| **Maaltijd- en ecocheques** | Vooral gangbare extralegale voordelen in België | Noteer nominale waarde, werknemersbijdrage en gebruiksvoorwaarden |
| **Mobiliteitsbudget / leaseauto / fietsregeling** | Veelvoorkomende mobiliteitscomponenten, met verschillende fiscale behandeling | Vergelijk totale waarde, eigen bijdrage en gevolgen bij uitdiensttreding |
| **Freelance / zelfstandig** | Opdrachtrelatie in plaats van arbeidsovereenkomst | Controleer tarief, btw, verzekeringen, pensioen, opzegging en risico op schijnzelfstandigheid |

### Onderhandelingsscripts

<!-- [AANPASSEN] Stem dit af op je situatie. -->

**Salarisverwachtingen (algemeen kader):**
> "Gebaseerd op de huidige marktgegevens voor dit type functie, mik ik op een bereik van [RANGE uit config/profile.yml]. Ik blijf flexibel wat betreft de structuur - het zijn het totale pakket en de groeimogelijkheden die tellen."

**Reactie op een geografische korting:**
> "De rollen waarvoor ik strijd zijn resultaatgericht, niet locatiegericht. Mijn trackrecord verandert niet per postcode."

**Als het vacature lager is dan het doel:**
> "Ik ben momenteel in gesprek over pakketten in het [hogere bereik]. [Bedrijf] spreekt mij aan om [reden]. Is het mogelijk om [doel] te bereiken?"

**Onderhandeling over de 13e maand / variabele:**
> "Kunt u, om de pakketten eerlijk te kunnen vergelijken, het jaarlijkse bruto vaste bedrag, de eventuele 13e maand en het variabele deel apart vermelden?"

### Locatiebeleid

<!-- [AANPASSEN] Stem dit af op je situatie. Wordt gelezen uit config/profile.yml -> location. -->

**In formulieren:**
- Binaire vragen "Kunt u ter plaatse zijn?" : reageer op basis van daadwerkelijke beschikbaarheid in `config/profile.yml`
- Vrije velden: geef expliciet tijdoverlap en beschikbaarheid aan

**In de evaluaties (score):**
- Externe dimensie voor hybride buiten uw land: Score **3,0** (niet 1,0)
- Scoor alleen 1,0 als er expliciet in het vacature staat "verplichte aanwezigheid 4-5 dagen/week, geen uitzonderingen"

### Prioriteit voor tijd tot vacature

- Functionele demo + metrics > perfectie
- Solliciteer snel > leer meer
- 80/20 aanpak, alles is in een timebox vastgelegd

---

## Algemene regels

### NOOIT

1. Verzin geen ervaring of metrics
2. Bewerk `cv.md` of portfoliobestanden
3. Dien sollicitaties in namens de kandidaat
4. Deel een telefoonnummer in gegenereerde berichten
5. Beveel een compensatie aan die beneden de marktwaarde ligt
6. Genereer een PDF zonder eerst de vacature te hebben gelezen
7. Gebruik bedrijfsjargon of lege zinnen
8. Negeer de tracker (elke geëvalueerde vacature wordt opgeslagen)

### ALTIJD

0. **Sollicitatiebrief:** Als het formulier dit toelaat, voeg er ALTIJD één toe. PDF in hetzelfde visuele ontwerp als het cv. Koppel citaten uit de vacature aan proof points. Maximaal 1 pagina.
1. Lees `cv.md` en `article-digest.md` (indien aanwezig) voordat u een vacature evalueert
1b. **Eerste evaluatie van elke sessie:** Voer `node cv-sync-check.mjs` uit via Bash. Bij waarschuwingen de kandidaat hiervan op de hoogte stellen
2. Detecteer het archetype van de rol en pas de positionering aan
3. Citeer bij matching de exacte regels uit het CV
4. Gebruik WebSearch voor belonings- en bedrijfsgegevens
5. Na elke beoordeling opslaan in de tracker
6. Genereer de inhoud in de taal van de vacature (Nederlands als de vacature in het Nederlands is, anders Engels)
7. Wees direct en concreet – geen gebabbel
8. Natuurlijk technisch Nederlands voor gegenereerde teksten. Korte zinnen, actiewerkwoorden, vermijd het passieve. Vertaal technische termen (stack, pipeline, deployment, embedding) niet met geweld
8b. **Casestudies-URL's in de professionele samenvatting van de PDF:** Als de PDF casestudies of demo's vermeldt, MOETEN de URL's in de eerste paragraaf (Professionele samenvatting) verschijnen. Recruiters lezen vaak alleen de samenvatting. Alle URL's in HTML met `white-space: nowrap`
9. **TSV-trackergegevens** -- Bewerk applications.md NOOIT rechtstreeks voor nieuwe toevoegingen. Schrijf de TSV in `batch/tracker-additions/`, `merge-tracker.mjs` beheert de samenvoeging
10. **`**URL:**` in elke rapportkop** -- tussen Score en PDF

### Hulpmiddelen

| Gereedschap | Gebruik |
|-------|-------|
| WebSearch | Onderzoeksbeloningen, trends, bedrijfscultuur, LinkedIn-contacten, uitwijkvacatures |
| WebFetch | Terugval om vacatures uit statische pagina's te halen |
| Playwright | Controleer of de vacatures actief zijn (browser_navigate + browser_snapshot), extraheer de vacatures uit SPA's. **KRITIEK: NOOIT 2+ agenten parallel met Playwright -- ze delen dezelfde browserinstantie** |
| Read | `config/profile.yml`, cv.md, article-digest.md, `_profile.md`, `_custom.md`, voice-dna.md, writing-samples/ en cv-template.html |
| Write | Tijdelijke HTML voor PDF, rapporten .md en TSV-bestanden in `batch/tracker-additions/` |
| Edit | Bestaande rapportinhoud bijwerken; bewerk `applications.md` nooit rechtstreeks |
| Bash | `node generate-pdf.mjs` |
