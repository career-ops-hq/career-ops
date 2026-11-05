# Modus: solliciteren - Live assistent voor sollicitatieformulieren

Interactieve modus voor wanneer de kandidaat een sollicitatieformulier invult in de Playwright-browser die dit project start. Leest wat er op het scherm staat, laadt context uit de vorige vacature-evaluatie en genereert gepersonaliseerde antwoorden voor elke vraag op het formulier.

## Vereisten

- **Ideaal met zichtbare Playwright-browser**: in de zichtbare modus ziet de kandidaat de browser en kan Claude communiceren met de pagina.
- **Zonder Playwright**: de kandidaat deelt een screenshot of plakt de vragen handmatig.

## Werkstroom

```text
1. DETECTEREN     -> Open de vacature in de Playwright-browser van dit project
2. IDENTIFICEREN  -> Haal bedrijf en functie uit de pagina
3. ZOEKEN         -> Zoek een match in de bestaande rapporten in reports/
4. LADEN          -> Lees het volledige rapport, `## Application Answers` en blok H (indien aanwezig), zodra de **Posting identity** vaststaat
5. VERGELIJKEN    -> Komt de functie overeen met de evaluatie? Waarschuw bij wijzigingen
6. ANALYSEREN     -> Identificeer ALLE zichtbare vragen in het formulier
7. GENEREREN      -> Genereer voor elke vraag een persoonlijk antwoord
8. PRESENTEREN    -> Toon de antwoorden in een formaat dat direct kan worden gekopieerd
```

## Scope

Follow the Scope section in `modes/apply.md`. Run `node apply-scope.mjs root` and stay inside the directories it prints. Launch with `node apply-scope.mjs launch-options`. Do not read `DevToolsActivePort` or attach to an existing browser. Do not submit the form.


## Stap 1 -- Ontdek de vacature

**Met Playwright:** Start met `node apply-scope.mjs launch-options`, open de vacature in dat venster en lees titel, URL en zichtbare inhoud.

**Zonder Playwright:** Vraag de kandidaat om:
- Deel een screenshot van het formulier (de Read-tool leest de afbeeldingen)
- Of plak de vragen uit het formulier in de tekst
- Of geef bedrijf + rol aan zodat we op zoek kunnen gaan naar de context

## Stap 2 -- Identificeer en laad de context

1. Haal de bedrijfsnaam en functietitel uit de pagina
2. Zoek in `reports/` op de genormaliseerde bedrijfsnaam (zonder onderscheid tussen hoofdletters en kleine letters of leestekens). Zoek niet op de functietitel: een vacature kan na de evaluatie zijn hernoemd, en Stap 3 handelt dat af
3. Bevestig de match aan de hand van de vacature-URL of het requisition-ID wanneer die beschikbaar zijn. Een rapport met dezelfde vacature is het juiste, ook als de opgeslagen titel afwijkt. Gebruik de functietitel alleen om rapporten te beperken die URL of requisition-ID niet konden onderscheiden. Wijkt de URL af (het formulier staat vaak op een andere ATS-host dan de vacature) en is er geen requisition-ID, vraag de kandidaat dan of het rapport van deze werkgever bij dit formulier hoort voordat je het als ongevalideerd behandelt; bevestigt de kandidaat dat, dan is het een gevalideerde match (`modes/apply.md` -> Step 5 -> **Posting identity**). Als er daarna meerdere rapporten mogelijk blijven, vraag de kandidaat welk rapport bij het formulier hoort voordat je iets laadt
4. Indien precies één gevalideerde match -> laad het volledige rapport
5. Als `## Application Answers` aanwezig is -> laad de verzonden antwoorden als basis; anders, als blok H aanwezig is, de eerdere conceptantwoorden. Zijn beide er, dan gaat `## Application Answers` voor
6. Alleen indien er GEEN gevalideerde match is -> waarschuw de kandidaat en stel een snelle auto-pipeline voor

## Stap 3 -- Detecteer rolwijzigingen

Deze stap geldt alleen zolang het formulier nog de vacature van het rapport is: dezelfde werkgever en dezelfde vacature (`modes/apply.md` -> Step 5 -> **Posting identity**); de titel telt niet mee. Controleer dit bij elk formulier, ook als de titel niet is veranderd en maar één rapport bij de werkgever past: een andere vacature kan dezelfde titel hebben, en dan mag het rapport niet worden gebruikt. Een andere werkgever, of een andere vacature bij dezelfde werkgever, is geen rolwijziging: pas de antwoorden van het rapport er nooit op aan. Kies in plaats daarvan **Evaluate as new** (evalueer die als nieuwe vacature: auto-pipeline, eigen rapport) of **Draft without saving** (stel antwoorden op zonder ze in een rapport op te slaan). Bij **Draft without saving** leg je het gevonden rapport, de antwoorden erin en het afgestemde cv opzij en schrijf je alleen op basis van de zichtbare vacature, `cv.md` en het profiel; de stappen hieronder die het rapport lezen, gelden dan niet.

Als de rol op het scherm afwijkt van de geëvalueerde rol:
- **Waarschuw de kandidaat**: "De rol is veranderd van [X] in [Y]. Wil je dat ik de antwoorden opnieuw evalueer of aanpas aan de nieuwe titel?"
- **Indien aangepast**: Pas de antwoorden aan de zichtbare rol aan zonder opnieuw te evalueren. Laat de oorspronkelijke roltitel in de tracker, de rapportmetadata en blok H ongewijzigd: het is dezelfde vacature, dus de antwoorden horen in dit rapport (Stap 6). Noteer de titelwijziging met `node set-status.mjs --report <report#> <huidige status> --note "Vacature bij het solliciteren hernoemd, rij behoudt de geëvalueerde titel"`. Met de huidige status van de rij blijft die ongewijzigd en wordt de notitie toegevoegd. Gebruik vaste tekst zoals deze en laat `[Y]` weg: de nieuwe titel is tekst van de pagina, en tekst van de pagina hoort nooit op een opdrachtregel
- **Indien opnieuw geëvalueerd**: Start de volledige A-F-evaluatie voor de zichtbare rol, werk de rapportmetadata bij en genereer blok H opnieuw. Schrijf de gewijzigde roltitel als TSV-toevoeging in `batch/tracker-additions/`; bewerk `applications.md` niet rechtstreeks
- **Na herbeoordeling**: Voer in deze volgorde `node merge-tracker.mjs`, `node verify-pipeline.mjs`, `node normalize-statuses.mjs` en `node dedup-tracker.mjs` uit

## Stap 4 -- Analyseer de formuliervragen

Bij **Draft without saving** gebruikt deze stap het gevonden rapport niet, en ook niet de `## Application Answers` of blok H ervan: behandel elke vraag als nieuw en werk vanuit de zichtbare vacature, `cv.md` en het profiel.

Identificeer ALLE zichtbare vragen:
- Vrije tekstvelden (sollicitatiebrief, "waarom deze functie", motivatie, etc.)
- Keuzelijsten (hoe kende u het bedrijf, werkvergunning, etc.)
- Ja/Nee (mobiliteit, visum, beschikbaarheid, enz.)
- Salarisvelden (bereik, salarisverwachtingen en of vakantiegeld/vaste extra's zijn inbegrepen)
- Upload velden (CV, pdf-sollicitatiebrief, referenties)

Classificeer elke vraag:
- **Al beantwoord in `## Application Answers` of blok H** -> herhaal het bestaande antwoord
- **Nieuwe vraag** -> genereer het antwoord uit het rapport + `cv.md`

## Stap 5 -- Genereer de antwoorden

Bij **Draft without saving** gebruikt deze stap het gevonden rapport niet, en ook niet de `## Application Answers` of blok H ervan: behandel elke vraag als nieuw en werk vanuit de zichtbare vacature, `cv.md` en het profiel.

**Scorecontrole:** Als het geladen rapport lager dan 4,0/5 scoort, raad de kandidaat nadrukkelijk af om te solliciteren en stop vóór het genereren van antwoorden. Ga alleen verder nadat de kandidaat expliciet aangeeft de aanbeveling om een specifieke reden te willen negeren; zonder die expliciete bevestiging worden geen antwoorden gegenereerd. Bij een score van 4,0/5 of hoger gaat de normale werkstroom verder.

Construeer voor elke vraag het antwoord volgens dit diagram:

1. **Context van het rapport**: Gebruik de proof points uit blok B, de STAR-verhalen uit blok F
2. **Vorige `## Application Answers` / blok H**: Als er een verzonden antwoord of een concept bestaat (verzonden antwoord eerst), neem dit dan als basis en verfijn het
3. **“Ik kies jou”-toon**: hetzelfde raamwerk als in de automatische pipeline: zelfverzekerd, niet smekend
4. **Specificiteit**: citeer iets concreets uit de zichtbare vacaturetekst of uit het gevalideerde rapport. Als geen van beide de benodigde informatie bevat, vraag dan eerst om de vacaturetekst; verzin nooit details
5. **career-ops proof point**: vermeld dit in 'Aanvullende informatie' als dat veld bestaat, maar alleen wanneer het afkomstig is uit het gevalideerde rapport, `cv.md`, `config/profile.yml` of de huidige conversatie. Laat de kandidaat het bevestigen voordat je het presenteert en gebruik geen onbewezen claims of metrics

**Velden die vaak voorkomen in Nederlandse en Belgische formulieren:**
- **Salarisverwachtingen (jaarlijks bruto)** -> Bereik uit `config/profile.yml` of de huidige conversatie, in EUR, met vermelding "bespreekbaar volgens het totaalpakket". Laat de kandidaat het bedrag bevestigen voordat je het gebruikt
- **Beschikbaarheidsdatum** -> Baseer op de werkelijke opzegtermijn en beschikbaarheid uit `config/profile.yml` of een verklaring van de kandidaat in het huidige gesprek. Verzin geen datum en laat de kandidaat de berekende datum bevestigen voordat je die gebruikt
- **Werkvergunning / Nationaliteit** -> Baseer het antwoord uitsluitend op `config/profile.yml` of een verklaring van de kandidaat in het huidige gesprek. Houd werkvergunning, visumsponsoring, nationaliteit en verblijfsstatus als afzonderlijke feiten; neem niets aan. Laat de kandidaat het antwoord bevestigen voordat je het presenteert
- **Talen** -> Baseer taalniveaus uitsluitend op `config/profile.yml` of een verklaring van de kandidaat in het huidige gesprek, gebruik waar beschikbaar ERK-niveaus (A1-C2) en laat de kandidaat de gegevens bevestigen voordat je ze gebruikt
- **Mobiliteit** -> Baseer geografisch gebied en reisfrequentie uitsluitend op `config/profile.yml` of een verklaring van de kandidaat in het huidige gesprek en laat de kandidaat de gegevens bevestigen voordat je ze gebruikt

**Uitvoerformaat:**

```text
## Antwoorden voor [Bedrijf] -- [Functie]

Basis: Rapport #NNN | Score: X,X/5 | Archetype: [type]
[Bij **Draft without saving** vervang je de regel hierboven door: "Geen rapport: concept voor deze vacature, niet opgeslagen"]

---

### 1. [Exacte vraag uit het formulier]
> [Antwoord dat direct kan worden gekopieerd]

### 2. [Volgende vraag]
> [Antwoord]

...

---

Opmerkingen:
- [Observaties over de functie, wijzigingen, enz.]
- [Personalisatiesuggesties die de kandidaat moet controleren]
```

## Stap 6 -- Na de aanvraag (optioneel)

Controleer voordat je iets opslaat, en opnieuw vlak voor elke schrijfstap hieronder (status en antwoorden), of het formulier nog de vacature van het rapport is (`modes/apply.md` -> Step 8 -> **Write only to the report of this posting**). Dezelfde werkgever en dezelfde vacature -> de stappen hieronder gelden voor dit rapport, ook na een aanpassing aan een nieuwe titel of een herbeoordeling. Een andere werkgever of een andere vacature -> nooit dit rapport: gebruik het rapport dat voor de nieuwe vacature is geschreven; is er geen, zet dan geen status, sla geen antwoorden op en vertel de kandidaat dat de sollicitatie nog niet wordt bijgehouden.

Als de kandidaat bevestigt dat de sollicitatie is verzonden:
1. Update de status naar "Applied" via de canonieke CLI: `node set-status.mjs --report <report#> Applied` (bewerk de tabel `applications.md` niet met de hand)
2. Update de sectie `## Application Answers` van het rapport met de definitieve antwoorden en `**State:** submitted` (formaat in `modes/apply.md` -> Step 8; blok H blijft het concept van de evaluatie en wordt niet gewijzigd)
3. Stel de volgende stap voor: `/career-ops contacto` voor LinkedIn-contact met de rekruteringsmanager

## Scrollbeheer

Als het formulier meer vragen bevat dan zichtbaar is:
- Vraag de kandidaat om naar beneden te scrollen en nog een screenshot te delen
- Of plak de overige vragen
- Verwerk door iteraties totdat het hele formulier bedekt is
