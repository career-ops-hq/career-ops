# Modus: solliciteren - Live assistent voor sollicitatieformulieren

Interactieve modus voor wanneer de kandidaat een sollicitatieformulier in Chrome invult. Leest wat er op het scherm staat, laadt context uit de vorige vacature-evaluatie en genereert gepersonaliseerde antwoorden voor elke vraag op het formulier.

## Vereisten

- **Ideaal met zichtbare Playwright-browser**: in de zichtbare modus ziet de kandidaat de browser en kan Claude communiceren met de pagina.
- **Zonder Playwright**: de kandidaat deelt een screenshot of plakt de vragen handmatig.

## Werkstroom

```text
1. DETECTEREN     -> Lees het actieve Chrome-tabblad (screenshot/URL/titel)
2. IDENTIFICEREN  -> Haal bedrijf en functie uit de pagina
3. ZOEKEN         -> Zoek een match in de bestaande rapporten in reports/
4. LADEN          -> Lees het volledige rapport en blok G (indien aanwezig)
5. VERGELIJKEN    -> Komt de functie overeen met de evaluatie? Waarschuw bij wijzigingen
6. ANALYSEREN     -> Identificeer ALLE zichtbare vragen in het formulier
7. GENEREREN      -> Genereer voor elke vraag een persoonlijk antwoord
8. PRESENTEREN    -> Toon de antwoorden in een formaat dat direct kan worden gekopieerd
```

## Stap 1 -- Ontdek de vacature

**Met Playwright:** Maak een snapshot van de actieve pagina. Lees titel, URL en zichtbare inhoud.

**Zonder Playwright:** Vraag de kandidaat om:
- Deel een screenshot van het formulier (de Read-tool leest de afbeeldingen)
- Of plak de vragen uit het formulier in de tekst
- Of geef bedrijf + rol aan zodat we op zoek kunnen gaan naar de context

## Stap 2 -- Identificeer en laad de context

1. Haal de bedrijfsnaam en functietitel uit de pagina
2. Zoek in `reports/` met een genormaliseerde combinatie van bedrijfsnaam en functietitel (zonder onderscheid tussen hoofdletters en kleine letters of leestekens)
3. Bevestig de match aan de hand van de vacature-URL wanneer die beschikbaar is. Als er daarna meerdere rapporten mogelijk blijven, vraag de kandidaat welk rapport bij het formulier hoort voordat je iets laadt
4. Indien precies één gevalideerde match -> laad het volledige rapport
5. Als Blok G aanwezig is -> laad eerdere conceptantwoorden als basis
6. Alleen indien er GEEN gevalideerde match is -> waarschuw de kandidaat en stel een snelle auto-pipeline voor

## Stap 3 -- Detecteer rolwijzigingen

Als de rol op het scherm afwijkt van de geëvalueerde rol:
- **Waarschuw de kandidaat**: "De rol is veranderd van [X] in [Y]. Wil je dat ik de antwoorden opnieuw evalueer of aanpas aan de nieuwe titel?"
- **Indien aangepast**: Pas de antwoorden eenmalig aan de zichtbare rol aan zonder opnieuw te evalueren. Laat de oorspronkelijke roltitel in de tracker, de rapportmetadata en blok G ongewijzigd en sla de aangepaste antwoorden niet in het oude rapport op
- **Indien opnieuw geëvalueerd**: Start de volledige A-F-evaluatie voor de zichtbare rol, werk de rapportmetadata bij en genereer blok G opnieuw. Schrijf de gewijzigde roltitel als TSV-toevoeging in `batch/tracker-additions/`; bewerk `applications.md` niet rechtstreeks
- **Na herbeoordeling**: Voer in deze volgorde `node merge-tracker.mjs`, `node verify-pipeline.mjs`, `node normalize-statuses.mjs` en `node dedup-tracker.mjs` uit

## Stap 4 -- Analyseer de formuliervragen

Identificeer ALLE zichtbare vragen:
- Vrije tekstvelden (sollicitatiebrief, "waarom deze functie", motivatie, etc.)
- Keuzelijsten (hoe kende u het bedrijf, werkvergunning, etc.)
- Ja/Nee (mobiliteit, visum, beschikbaarheid, enz.)
- Salarisvelden (bereik, salarisverwachtingen en of vakantiegeld/vaste extra's zijn inbegrepen)
- Upload velden (CV, pdf-sollicitatiebrief, referenties)

Classificeer elke vraag:
- **Al beantwoord in Blok G** -> herhaal het bestaande antwoord
- **Nieuwe vraag** -> genereer het antwoord uit het rapport + `cv.md`

## Stap 5 -- Genereer de antwoorden

**Scorecontrole:** Als het geladen rapport lager dan 4,0/5 scoort, raad de kandidaat nadrukkelijk af om te solliciteren en stop vóór het genereren van antwoorden. Ga alleen verder nadat de kandidaat expliciet aangeeft de aanbeveling om een specifieke reden te willen negeren; zonder die expliciete bevestiging worden geen antwoorden gegenereerd. Bij een score van 4,0/5 of hoger gaat de normale werkstroom verder.

Construeer voor elke vraag het antwoord volgens dit diagram:

1. **Context van het rapport**: Gebruik de proof points uit blok B, de STAR-verhalen uit blok F
2. **Vorig blok G**: Als er een concept bestaat, neem dit dan als basis en verfijn het
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

Als de kandidaat bevestigt dat de sollicitatie is verzonden:
1. Update de status naar "Applied" via de canonieke CLI: `node set-status.mjs <report#> Applied` (bewerk de tabel `applications.md` niet met de hand)
2. Update blok G van het rapport met de definitieve antwoorden alleen als bedrijf en rol nog exact overeenkomen met de rapportmetadata. Na een eenmalige aanpassing aan een andere rol moet eerst een afzonderlijk rapport voor die rol worden gemaakt of de volledige herbeoordeling worden uitgevoerd; overschrijf nooit het rapport van de oorspronkelijke rol
3. Stel de volgende stap voor: `/career-ops contacto` voor LinkedIn-contact met de rekruteringsmanager

## Scrollbeheer

Als het formulier meer vragen bevat dan zichtbaar is:
- Vraag de kandidaat om naar beneden te scrollen en nog een screenshot te delen
- Of plak de overige vragen
- Verwerk door iteraties totdat het hele formulier bedekt is
