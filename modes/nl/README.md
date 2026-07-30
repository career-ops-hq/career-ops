# career-ops -- Nederlandstalige modi (`modes/nl/`)

Dit bestand bevat Nederlandse vertalingen van de belangrijkste carrièremodi voor kandidaten die zich richten op de Nederlandstalige arbeidsmarkt (Nederland en Vlaanderen).

## Wanneer gebruik je deze modi?

Gebruik `modes/nl/` als aan minstens één van deze voorwaarden is voldaan:

- Je solliciteert voornamelijk op **Nederlandstalige vacatures** (LinkedIn, Indeed NL/BE, Nationale Vacaturebank, VDAB, Werkenvoor.be, bedrijfssites)
- Je **cv is in het Nederlands** of je wisselt tussen NL en EN, afhankelijk van de vacature
- Je hebt antwoorden en motivatiebrieven nodig in **natuurlijk technisch Nederlands**, zonder letterlijke vertalingen
- Je wilt rekening houden met **arbeidsvoorwaarden in Nederland en België**: cao/sectorale afspraken, vakantiegeld, pensioen, bonus of dertiende maand, proefperiode, opzegtermijn en aanvullende verzekeringen

Als de meeste vacatures in het Engels zijn, gebruik dan de standaardmodi in `modes/`. De Engelse modi werken ook voor Nederlandstalige vacatures, maar behandelen de Nederlandse en Belgische arbeidsmarkt minder specifiek.

## Hoe activeren?

### Optie 1 -- Per sessie

Vertel Claude aan het begin van de sessie:

> "Gebruik Nederlandse modi onder `modes/nl/`."

Claude zal dan bestanden uit deze map lezen in plaats van `modes/`.

### Optie 2 -- Permanent

Voeg in `config/profile.yml` toe:

```yaml
language:
  primary: nl
  modes_dir: modes/nl
```

Herinner Claude hieraan tijdens je eerste sessie ("Kijk in `config/profile.yml`, ik heb `language.modes_dir` geconfigureerd"). Claude gebruikt automatisch de Nederlandse modi.

## Welke modi zijn vertaald?

Deze eerste iteratie omvat de vier modi met de hoogste impact:

| Bestand | Vertaald uit | Rol |
|--------|----------------|------|
| `_shared.md` | `modes/fr/_shared.md` (FR) | Gedeelde context, archetypen, algemene regels, Nederlandstalige marktspecifieke kenmerken |
| `vacature.md` | `modes/fr/offre.md` (FR) | Volledige evaluatie van een vacature (blokken A-F) |
| `solliciteren.md` | `modes/fr/postuler.md` (FR) | Live assistent bij het invullen van sollicitatieformulieren |
| `pipeline.md` | `modes/fr/pipeline.md` (FR) | URL inbox / Second Brain voor verzamelde vacatures |

De andere modi (`scan`, `batch`, `pdf`, `tracker`, `auto-pipeline`, `deep`, `contacto`, `ofertas`, `project`, `training`) blijven in EN/ES. Hun inhoud bestaat voornamelijk uit tools, paden en commando's - het moet taalonafhankelijk blijven.

## Wat blijft in het Engels

Opzettelijk niet vertaald vanwege standaard technische woordenschat:

- `cv.md`, `pipeline`, `tracker`, `report`, `score`, `archetype`
- Toolnamen (`Playwright`, `WebSearch`, `WebFetch`, `Read`, `Write`, `Edit`, `Bash`)
- Statuswaarden in de tracker (`Evaluated`, `Applied`, `Interview`, `Offer`, `Rejected`)
- Codefragmenten, paden, opdrachten

De modi gebruiken natuurlijk technisch Nederlands zoals dat in teams in Nederland en Vlaanderen wordt gesproken: gewone tekst in het Nederlands, met Engelse technische termen waar die gangbaar zijn. Termen als "pipeline", "deployment" en "stack" worden niet geforceerd vertaald.

## Referentiewoordenlijst

Om een ​​consistente toon te behouden als u de modi wijzigt of uitbreidt:

| Engels | Nederlands (in deze codebase) |
|---------|----------------------------|
| Job posting | Vacature |
| Application | Sollicitatie |
| Cover letter | Sollicitatiebrief |
| Resume / CV | Cv |
| Salary | Salaris |
| Compensation | Beloning / arbeidsvoorwaardenpakket |
| Skills | Vaardigheden |
| Interview | Sollicitatiegesprek |
| Hiring manager | Wervende manager / hiring manager |
| Recruiter | Recruiter |
| AI | AI (kunstmatige intelligentie) |
| Requirements | Vereisten |
| Career history | Loopbaan / werkervaring |
| Notice period | Opzegtermijn |
| Probation | Proeftijd |
| Vacation | Vakantiedagen / betaald verlof |
| 13th month salary | Dertiende maand / eindejaarsuitkering |
| Permanent employment | Arbeidsovereenkomst voor onbepaalde tijd / vast contract |
| Fixed-term contract | Arbeidsovereenkomst voor bepaalde tijd / tijdelijk contract |
| Freelance | Freelance / zelfstandig |
| Collective agreement | Cao (NL) / sectorale cao of paritair comité (BE) |
| Works council | Ondernemingsraad |
| Profit sharing | Winstdeling / winstpremie |
| Meal vouchers | Maaltijdcheques (vooral BE) |
| Health insurance | Zorgverzekering (NL) / hospitalisatieverzekering (BE) |
| Disability/life insurance | Arbeidsongeschiktheids- en overlijdensverzekering |
| Holiday allowance | Vakantiegeld |
| Pension | Pensioenregeling / groepsverzekering |

## Bijdragen

Om een ​​vertaling te verbeteren of een modus toe te voegen:

1. Open een probleem met uw voorstel (zie `CONTRIBUTING.md`)
2. Respecteer de bovenstaande woordenlijst om de toon consistent te houden
3. Vertaal idiomatisch - geen woord-voor-woordvertaling
4. Houd structurele elementen (blokken A-F, tabellen, codeblokken, gereedschapsinstructies) identiek
5. Test met een echte Nederlandstalige vacature (LinkedIn, Indeed NL, Nationale Vacaturebank) voordat je de PR indient
