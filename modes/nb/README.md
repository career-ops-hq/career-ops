# career-ops -- Norske modes (`modes/nb/`)

Denne mappen inneholder de norske (bokmål) oversettelsene av de viktigste career-ops-modene for kandidater som søker jobb på det norske markedet.

## Når bør du bruke disse modene?

Bruk `modes/nb/` når du søker jobber i **det norske markedet**: hos norske arbeidsgivere eller med arbeidssted i Norge (FINN.no, arbeidsplassen.no, Jobbnorge, LinkedIn NO, virksomhetenes karrieresider). Det gjelder også når annonsene er på engelsk, noe som er vanlig i tech: norske kontraktsforhold følger stillingen, ikke språket i annonsen. Modene håndterer fast og midlertidig ansettelse, prøvetid, oppsigelsestid, tariffavtale, ferie og feriepenger, OTP og AFP, konkurranseklausul, og reglene for staten.

Søker du bare jobber utenfor Norge, bruk det markedets modes (eller standard-modene i `modes/` der det ikke finnes noen), selv om du selv bor i Norge eller annonsen er på norsk. Søker du i flere markeder samtidig, erklær dem som en liste, f.eks. `modes_dir: [modes/nb, modes/da]` eller `[modes/nb, modes]`: den første er primærmarkedet, hvert erklært markeds `_shared.md` lastes, og reglene til markedet stillingen hører til, gjelder for den stillingen. Velg markedet etter hvor stillingen er, aldri etter språket i annonsen (se "Output Language vs Market Modes" i AGENTS.md).

Språket i rapporter og søknader styres for seg av `language.output`: norske markedsregler med engelsk output er et gyldig valg, og med `nb` skriver modene naturlig tech-norsk, ikke maskinoversatt.

## Hvordan aktiverer du dem?

### Alternativ 1 -- Per sesjon

Si til Claude ved starten av sesjonen:

> "Bruk de norske modene under `modes/nb/`."

Claude leser da filene i denne mappen i stedet for `modes/`.

### Alternativ 2 -- Permanent

Legg til i `config/profile.yml`:

```yaml
language:
  output: nb
  modes_dir: modes/nb
```

Søker du parallelt i flere markeder, kan `modes_dir` være en liste (f.eks. `[modes/nb, modes/da]`); den første er primærmarkedet. Se "Multiple simultaneous target markets" i AGENTS.md.

Minn Claude på det i første sesjon ("Se i `profile.yml`, jeg har konfigurert `language.modes_dir`"). Claude bruker da de norske modene automatisk.

## Hvilke modes er oversatt?

Denne første iterasjonen dekker de fire modene med størst effekt. Hver fil er oversatt i sin helhet fra den engelske originalen, med samme seksjoner i samme rekkefølge, og det norske markedslaget lagt på toppen:

| Fil | Oversatt fra | Rolle |
|-----|--------------|-------|
| `_shared.md` | `modes/_shared.md` (EN) | Felles kontekst, poengsystem, arketyper, globale regler, særtrekk ved det norske markedet |
| `stilling.md` | `modes/oferta.md` (EN) | Full evaluering av en stillingsannonse (Blokk A-H) |
| `soknad.md` | `modes/apply.md` (EN) | Live-assistent for utfylling av søknadsskjemaer |
| `pipeline.md` | `modes/pipeline.md` (EN) | URL-innboks / Second Brain for innsamlede annonser |

Filnavnene er norske: `stilling` (stillingen som evalueres) og `soknad` (søknaden, uten ø så filnavnet holder seg til ASCII). `pipeline.md` beholder navnet, som i de andre markedene. Brukeren sier fortsatt "evaluer denne stillingen" eller "hjelp meg med søknaden"; AGENTS.md → Language Modes kobler modene til filene.

**Hvorfor fullstendige oversettelser?** Med `language.modes_dir: modes/nb` lastes `modes/nb/_shared.md` i stedet for `modes/_shared.md`, og `soknad.md` i stedet for `modes/apply.md`. Et tynt markedslag ville derfor miste regler som bare står i de engelske filene: poengsystemet, North Star 1 for umatchede roller, delegering til subagenter, unattended runs, preflighten i søknadsflyten og liveness-sjekken i pipelinen. Endres en engelsk fil, viser `node i18n-drift.mjs --lang nb` hvilke seksjoner som må følge etter.

De øvrige modene (`scan`, `batch`, `pdf`, `tracker`, `auto-pipeline`, `deep`, `contacto`, `ofertas`, `project`, `training`, `interview/*`) forblir på engelsk. Innholdet deres er hovedsakelig tooling, stier og kommandoer -- det skal være språkuavhengig.

## Hva som forblir på engelsk

Bevisst ikke oversatt, fordi det er standard tech-ordforråd:

- `cv.md`, `pipeline`, `tracker`, `report`, `score`, `archetype`, `proof point`
- Verktøynavn (`Playwright`, `WebSearch`, `WebFetch`, `Read`, `Write`, `Edit`, `Bash`)
- Statusverdier i trackeren (`Evaluated`, `Applied`, `Interview`, `Offer`, `Rejected`)
- Kodeutdrag, stier, kommandoer

Modene bruker naturlig tech-norsk slik det snakkes i engineering-team i Oslo, Bergen, Trondheim eller Stavanger: løpende tekst på norsk, tekniske termer på engelsk der det er normen. Ingen tvungen oversettelse av "Pipeline" til "Rørledning" eller "Deploy" til "Utrulling".

## Antakelser om det norske markedet

Disse antakelsene er lagt inn i modene. Er du uenig, åpne en issue -- de er ment å kunne diskuteres:

- **Arbeidsmiljøloven gjelder alle, unntatt der statsansatteloven gjelder i staten.** Norge har ingen funksjonærlov; modene leter ikke etter en "funksjonærstatus" i annonsen. For statlige stillinger bruker modene statsansatteloven for midlertidig ansettelse (§ 9), prøvetid (§ 15) og oppsigelse (§ 22), og Statens pensjonskasse i stedet for OTP.
- **Fast ansettelse er hovedregelen.** En midlertidig stilling må ha et grunnlag i arbeidsmiljøloven § 14-9 (i staten statsansatteloven § 9), så modene ber om grunnlaget i stedet for bare å spørre "hvorfor ikke fast?".
- **Prøvetid inntil 6 måneder er normalt.** Det flagges først over 6 måneder.
- **Ferie er 25 virkedager ved lov, 5 uker i praksis.** Bare lovens minimum regnes som under markedet for funksjonærstillinger.
- **Feriepenger erstatter lønnen for feriedagene.** Arbeidsgiveren trekker vanlig lønn for feriedagene samtidig som feriepengene utbetales (Skatteetaten, "trekk i lønn for ferie"), så feriepengene er ikke et tillegg på toppen av årslønnen, og modene sammenligner årslønn mot årslønn. Første år hos en ny arbeidsgiver kan ferien bli ulønnet.
- **Pensjon oppgis i G-bånd.** Modene ber om satsen for 0-7,1 G og 7,1-12 G, og behandler OTP-minimumet (2 %) som under markedet.
- **Ingen A-kasse.** Dagpenger kommer fra NAV; fagforeningsmedlemskap handler om juridisk hjelp, lønnsstatistikk og tariffavtale.
- **Overskriftene følger `language.output`.** Med `nb` bruker reporten de norske overskriftene i `stilling.md`; med `en` bruker den malen i `modes/oferta.md`.
- **Signal 6 bruker norsk rett for norske stillinger,** også når kandidaten bor utenfor Norge. De andre jurisdiksjonstabellene følger kandidatens `location`, som i `modes/oferta.md`.
- **Netto regnes per år.** Trekkfri juni og halv skatt i desember gjør enkeltmåneder misvisende.
- **Offentlig sektor leses fra stillingskode og lønnsspenn**, ikke fra tittelen alene. Statens hovedlønnstabell finnes ikke lenger (fra 1. mai 2024).
- **FINN.no hentes ikke automatisk.** FINNs robots.txt forbyr automatisert tilgang uten samtykke, og Webcruiter stenger ute alle unntatt Googlebot. Modene ber kandidaten lime inn teksten, eller bruker samme annonse på arbeidsplassen.no.
- **Søkerlisten er offentlig.** Ved søknad til en offentlig arbeidsgiver varsler modene kandidaten om at navn, alder, stilling og kommune kan bli publisert, og spør om kandidaten vil be om unntak.
- **Søknadsfristen er absolutt**, og "Snarest" betyr løpende vurdering.
- **Ingen kan kreve betaling av en jobbsøker** for formidling (arbeidsmarkedsloven § 26). Et gebyr er alltid et varselsignal i blokk G.
- **Beløp i kroner som avhenger av G** (dagpenger, pensjon, sykepenger, kompensasjon ved konkurranseklausul) må regnes om hvert år etter 1. mai.

## Referanseordliste

For å holde tonen konsistent hvis du endrer eller utvider modene:

| Engelsk | Norsk (i denne kodebasen) |
|---------|---------------------------|
| Job posting | Stillingsannonse / Utlysning |
| Application | Søknad |
| Cover letter | Søknadsbrev / Følgebrev |
| Resume / CV | CV |
| Salary | Lønn |
| Compensation | Lønn og betingelser / Pakke |
| Skills | Kompetanse |
| Interview | Intervju |
| Hiring manager | Ansettende leder / Hiring manager |
| Recruiter | Rekrutterer / Rekrutteringsrådgiver |
| AI | AI (kunstig intelligens, KI) |
| Requirements | Krav / Kvalifikasjoner |
| Career history | Arbeidserfaring / Yrkeserfaring |
| Application deadline | Søknadsfrist |
| Start date | Tiltredelse |
| Notice period | Oppsigelsestid |
| Probation | Prøvetid |
| Vacation | Ferie |
| Holiday pay | Feriepenger |
| Permanent employment | Fast ansettelse |
| Fixed-term contract | Midlertidig ansettelse / Vikariat / Engasjement |
| Freelance / contractor | Selvstendig næringsdrivende / Konsulent / Oppdragstaker |
| Collective agreement | Tariffavtale |
| Working Environment Act | Arbeidsmiljøloven |
| Holiday act | Ferieloven |
| Trade union | Fagforening |
| Unemployment benefit | Dagpenger (NAV) |
| Pension | Tjenestepensjon (OTP) |
| Non-compete clause | Konkurranseklausul |
| Base amount (National Insurance) | Grunnbeløpet (G) |
| References | Referanser |
| Certificates and diplomas | Attester og vitnemål |

## Bidra

For å forbedre en oversettelse eller legge til en mode:

1. Åpne en issue med forslaget ditt (se `CONTRIBUTING.md`)
2. Følg ordlisten ovenfor for å holde tonen konsistent
3. Oversett idiomatisk -- ingen ord-for-ord-oversettelse
4. Behold de strukturelle elementene (Blokk A-H, tabeller, kodeblokker, verktøyinstruksjoner) uendret
5. Test med en ekte norsk annonse (FINN.no, arbeidsplassen.no, Jobbnorge, LinkedIn NO) før du sender PR-en
