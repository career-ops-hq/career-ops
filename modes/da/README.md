# career-ops -- Danske modes (`modes/da/`)

Denne mappe indeholder de danske oversættelser af de vigtigste career-ops-modes for kandidater, der søger på det danske marked.

## Hvornår skal du bruge disse modes?

Brug `modes/da/`, hvis mindst én af disse betingelser er opfyldt:

- Du søger primært **jobopslag på dansk** (Jobindex, The Hub, LinkedIn DK, virksomhedernes karrieresider, Jobnet)
- Dit **CV er på dansk**, eller du skifter mellem DA og EN afhængigt af opslaget
- Du har brug for svar og ansøgninger på **naturligt tech-dansk**, ikke maskinoversat
- Du skal håndtere **danske kontraktspecifikke forhold**: overenskomst, funktionærloven, ferie efter ferieloven, opsigelsesvarsel, prøvetid, pension, feriepenge, A-kasse, fagforening

Hvis de fleste af dine opslag er på engelsk, så bliv ved standard-modes i `modes/`. De engelske modes fungerer til danske opslag, men de kender ikke det danske markeds særtræk i detaljen.

## Hvordan aktiverer du dem?

### Mulighed 1 -- Per session

Sig til Claude i starten af sessionen:

> "Brug de danske modes under `modes/da/`."

Claude vil så læse filerne i denne mappe i stedet for `modes/`.

### Mulighed 2 -- Permanent

Tilføj i `config/profile.yml`:

```yaml
language:
  primary: da
  modes_dir: modes/da
```

Mind Claude om det i din første session ("Kig i `profile.yml`, jeg har konfigureret `language.modes_dir`"). Claude bruger så automatisk de danske modes.

## Hvilke modes er oversat?

Denne første iteration dækker de fire modes med størst effekt:

| Fil | Oversat fra | Rolle |
|-----|-------------|-------|
| `_shared.md` | `modes/_shared.md` (EN) | Delt kontekst, arketyper, globale regler, særtræk ved det danske marked |
| `oferta.md` | `modes/oferta.md` (ES) | Fuld evaluering af et opslag (Blok A-F) |
| `apply.md` | `modes/apply.md` (EN) | Live-assistent til udfyldelse af ansøgningsformularer |
| `pipeline.md` | `modes/pipeline.md` (ES) | URL-indbakke / Second Brain til indsamlede opslag |

De øvrige modes (`scan`, `batch`, `pdf`, `tracker`, `auto-pipeline`, `deep`, `contacto`, `ofertas`, `project`, `training`) forbliver på EN/ES. Deres indhold er primært tooling, stier og kommandoer -- det skal forblive sproguafhængigt.

## Hvad forbliver på engelsk

Bevidst ikke oversat, fordi det er standard tech-ordforråd:

- `cv.md`, `pipeline`, `tracker`, `report`, `score`, `archetype`, `proof point`
- Værktøjsnavne (`Playwright`, `WebSearch`, `WebFetch`, `Read`, `Write`, `Edit`, `Bash`)
- Statusværdier i trackeren (`Evaluated`, `Applied`, `Interview`, `Offer`, `Rejected`)
- Kodeuddrag, stier, kommandoer

Modes bruger naturligt tech-dansk, sådan som det tales i engineering-teams i København, Aarhus eller Odense: løbende tekst på dansk, tekniske termer på engelsk dér, hvor det er normen. Ingen tvungen oversættelse af "Pipeline" til "Rørledning" eller "Deploy" til "Udrulning".

## Referenceordliste

For at holde tonen konsistent, hvis du ændrer eller udvider modes:

| Engelsk | Dansk (i denne codebase) |
|---------|--------------------------|
| Job posting | Jobopslag / Stillingsopslag |
| Application | Ansøgning |
| Cover letter | Ansøgning (motiveret) / Følgebrev |
| Resume / CV | CV |
| Salary | Løn / Aflønning |
| Compensation | Aflønning / Pakke |
| Skills | Kompetencer |
| Interview | Samtale / Jobsamtale |
| Hiring manager | Ansættende leder / Hiring manager |
| Recruiter | Rekrutteringskonsulent (eller Recruiter) |
| AI | AI (kunstig intelligens) |
| Requirements | Krav / Forudsætninger |
| Career history | Karriereforløb / Erhvervserfaring |
| Notice period | Opsigelsesvarsel |
| Probation | Prøvetid |
| Vacation | Ferie |
| Holiday pay | Feriepenge |
| Permanent employment | Fastansættelse (tidsubegrænset) |
| Fixed-term contract | Tidsbegrænset ansættelse |
| Freelance | Freelance / Selvstændig |
| Collective agreement | Overenskomst |
| Salaried-employee act | Funktionærloven |
| Holiday act | Ferieloven |
| Trade union | Fagforening |
| Unemployment insurance fund | A-kasse |
| Pension | Pension (arbejdsgiverbidrag) |

## Bidrag

For at forbedre en oversættelse eller tilføje en mode:

1. Åbn en Issue med dit forslag (se `CONTRIBUTING.md`)
2. Følg ordlisten ovenfor for at holde tonen konsistent
3. Oversæt idiomatisk -- ingen ord-for-ord-oversættelse
4. Bevar de strukturelle elementer (Blok A-F, tabeller, kodeblokke, værktøjsinstruktioner) uændret
5. Test med et rigtigt dansk opslag (Jobindex, The Hub, LinkedIn DK), før du sender din PR
