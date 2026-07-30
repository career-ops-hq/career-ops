# Modus: pipeline - URL-inbox (tweede brein)

Processen bieden URL's aan die zijn verzameld in `data/pipeline.md`. De kandidaat voegt URL's toe wanneer hij maar wil en voert vervolgens `/career-ops pipeline` uit om ze allemaal in één keer te verwerken.

## Werkstroom

1. **Lees** `data/pipeline.md` -> zoek de items `- [ ]` in de sectie "In afwachting" / "Pending" / "Pendientes" / "Offen" / "En attente"
2. **Voor elke openstaande URL**:
   a. **Extraheer de vacature** met Playwright (`browser_navigate` + `browser_snapshot`) -> WebFetch -> WebSearch. Alleen geslaagde Playwright-navigatie plus een snapshot mogen bevestigen dat de vacature actief is. WebFetch en WebSearch dienen uitsluitend voor extractie en bevestigen nooit de actieve status
   b. Als de URL niet toegankelijk is -> laat het item als `- [ ]` staan of markeer het als `- [!]` met de foutdetails, zodat het zichtbaar en opnieuw uitvoerbaar blijft; er is dan nog geen rapportnummer gereserveerd. Als extractie alleen via WebFetch of WebSearch lukt, ga dan verder met `**Verification:** unconfirmed` in het rapport. Gebruik `**Verification:** unconfirmed (batch mode)` uitsluitend bij headless batchverwerking
   c. Gebruik bij seriële verwerking het volgende `REPORT_NUM` via `node reserve-report-num.mjs`. Gebruik bij parallelle verwerking uitsluitend het nummer dat de coördinator vooraf uit de gereserveerde reeks heeft toegewezen; laat workers nooit zelfstandig een nummer reserveren
   d. Voer de volledige auto-pipeline uit binnen een cleanup-pad: Evaluatie A-F -> Rapport .md -> PDF (indien score >= 3.0) -> tracker-TSV in `batch/tracker-additions/`
   e. Voer in een `finally`-stap altijd `node reserve-report-num.mjs --release <num>` uit, ook als een vervolgstap, evaluatie, PDF-generatie of trackerregistratie mislukt
   f. **Verplaats alleen na volledig succes van "In afwachting" naar "Verwerkt"**: evaluatie, eventuele PDF-generatie en trackerregistratie moeten allemaal zijn geslaagd. Schrijf dan `- [x] #NNN | URL | Bedrijf | Rol | Score/5 | PDF ja/nee`. Laat het item bij elke fout als `- [ ]` staan of markeer het als `- [!]` met de foutdetails, zodat het zichtbaar en opnieuw uitvoerbaar blijft
3. **Als er meer dan 3 URL's wachten**, voer alleen stappen zonder Playwright parallel uit (Agent-tool met `run_in_background`). Verwerk Playwright-gestuurde vacatures serieel, omdat agenten dezelfde browserinstantie delen. Verdeel de geschikte URL's in batches van maximaal 50 workers, omdat `reserve-report-num.mjs --count` maximaal 50 plaatsen accepteert. Reserveer direct vóór elke batch één aaneengesloten reeks met `node reserve-report-num.mjs --count <batchgrootte>`; wijs elke worker een uniek nummer uit die reeks toe en wacht tot de batch klaar is. Voer na elke batch, in deze volgorde, `node merge-tracker.mjs`, `node verify-pipeline.mjs`, `node normalize-statuses.mjs` en `node dedup-tracker.mjs` uit. Reserveer of dispatch de volgende batch pas als alle vier opdrachten zijn geslaagd. Elke gestarte worker geeft uitsluitend zijn eigen toegewezen nummer in de `finally`-stap vrij. Als de dispatch wordt afgebroken of mislukt, geeft de coördinator elk nog niet aan een gestarte worker overgedragen nummer vrij met `node reserve-report-num.mjs --release <num-or-range>`. Laat geen worker zelfstandig een nummer berekenen of reserveren en laat de coördinator geen reeds overgedragen nummer vrijgeven. Als batching niet beschikbaar is, verwerk de URL's serieel.
4. **Na seriële verwerking:** voer, nadat de worker klaar is, in deze volgorde `node merge-tracker.mjs`, `node verify-pipeline.mjs`, `node normalize-statuses.mjs` en `node dedup-tracker.mjs` uit. **Na batchverwerking:** controleer dat deze barrière voor elke batch, inclusief de laatste, is geslaagd; stop bij een fout.
5. **Aan het einde** geeft u een samenvattende tabel weer:

```text
| # | Bedrijf | Functie | Score | PDF | Aanbevolen actie |
```

## Pipeline.md-indeling

```markdown
## In afwachting
- [ ] https://jobs.example.com/posting/123
- [ ] https://boards.greenhouse.io/company/jobs/456 | Company SAS | Senior PM
- [!] https://private.url/job -- Fout: inloggen vereist

## Verwerkt
- [x] #143 | https://jobs.example.com/posting/789 | Acme SAS | AI PM | 4,2/5 | PDF ja
- [x] #144 | https://boards.greenhouse.io/xyz/jobs/012 | BigCo | SA | 2,1/5 | PDF nee
```

> Opmerking: Sectiekoppen kunnen in EN ("Pending"/"Processed"), ES ("Pendientes"/"Procesadas"), DE ("Offen"/"Verarbeitet"), FR ("En attente"/"Traitees") of NL ("In afwachting"/"Verwerkt") zijn. Lees flexibel en blijf bij het schrijven trouw aan de bestaande stijl.

## Intelligente vacaturesdetectie via URL

1. **Playwright (bij voorkeur):** `browser_navigate` + `browser_snapshot`. Werkt met alle SPA's en is de enige methode waarmee de actieve status van een vacature mag worden bevestigd.
   - **Optie — CLI-extractor (`scan.extractor: cli` in `config/profile.yml`):** voer in plaats daarvan `node browser-extract.mjs <url>` (`--mode jd`) uit — `{ "url", "title", "text" }` compact, minder tokens (afhankelijk van de site). **Stille terugval** naar `browser_navigate` + `browser_snapshot` in geval van een fout of afwezigheid.
2. **WebFetch (fallback):** Voor statische pagina's of wanneer Playwright niet beschikbaar is. Gebruik de inhoud alleen voor extractie en zet `**Verification:** unconfirmed` in het rapport, of `**Verification:** unconfirmed (batch mode)` bij headless batchverwerking.
3. **WebSearch (laatste redmiddel):** Zoek op secundaire portals die de vacature indexeren. Gebruik zoekresultaten nooit als bevestiging dat de vacature actief is en zet `**Verification:** unconfirmed` in het rapport, of `**Verification:** unconfirmed (batch mode)` bij headless batchverwerking.

**Speciale gevallen:**
- **LinkedIn**: Mogelijk is een login vereist -> benadruk `[!]` en vraag de kandidaat om de tekst te plakken
- **PDF**: als de URL naar een PDF verwijst, kunt u deze direct lezen met de Leestool
- **Prefix `local:`**: Lees het lokale bestand. Voorbeeld: `local:jds/linkedin-pm-ai.md` -> lees `jds/linkedin-pm-ai.md`
- **Indeed NL/BE, Nationale Vacaturebank, Intermediair, Jobat, StepStone, VDAB en Werkenvoor.be**: veelgebruikte bronnen voor Nederlandstalige vacatures. Gebruik Playwright voor dynamische pagina's en cookiebanners

## Automatische nummering

1. Voer `node reserve-report-num.mjs` uit om het volgende volgnummer atomair te reserveren (stdout retourneert `{###}`).
2. Schrijf het rapport met dit nummer.
3. Geef de sentinel in een `finally`-stap altijd vrij met `node reserve-report-num.mjs --release {###}`, zowel na succes als na een fout.

## Bronsynchronisatie

Controleer de synchronisatie voordat u een URL verwerkt:

```bash
node cv-sync-check.mjs
```

Als `cv-sync-check.mjs` met een niet-nulstatus afsluit, stop dan de URL-verwerking, ook als vereiste bestanden ontbreken. Ga alleen verder bij afsluitstatus 0; toon eventuele waarschuwingen met afsluitstatus 0 aan de kandidaat voordat u doorgaat.
