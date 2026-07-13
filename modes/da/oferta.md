# Mode: oferta -- Fuld evaluering A-F

Når kandidaten indsætter et opslag (tekst eller URL), så lever ALTID alle 6 blokke.

## Trin 0 -- Arketype-detektion

Klassificér opslaget i en af de 6 arketyper (se `_shared.md`). Hvis hybrid, så angiv de 2 nærmeste. Det afgør:
- Hvilke proof points der prioriteres i blok B
- Hvordan summary omskrives i blok E
- Hvilke STAR-stories der forberedes i blok F

## Blok A -- Rolleopsummering

Tabel med:
- Detekteret arketype
- Domain (Platform / Agentic / LLMOps / ML / Enterprise)
- Funktion (Build / Consult / Manage / Deploy)
- Senioritet
- Remote (Fuld remote / Hybrid / På kontoret)
- Teamstørrelse (hvis nævnt)
- TL;DR i 1 sætning

## Blok B -- Match med CV'et

Læs `cv.md`. Lav en tabel, hvor hvert krav i opslaget mappes til eksakte linjer i CV'et.

**Tilpasset arketypen:**
- FDE -> prioritér proof points om hurtig levering og kundenærhed
- SA -> prioritér systemdesign og integrationer
- PM -> prioritér product discovery og metrics
- LLMOps -> prioritér evals, observability, pipelines
- Agentic -> prioritér multi-agent, HITL, orkestrering
- Transformation -> prioritér forandringsledelse, adoption, skalering

Afsnit om **Mangler (Gaps)** med en mitigeringsstrategi for hver enkelt. For hver mangel:
1. Er det en hard blocker eller et nice-to-have?
2. Kan kandidaten påvise tilstødende erfaring?
3. Findes der et portfolio-projekt, der dækker manglen?
4. Konkret mitigeringsplan (sætning til følgebrevet, hurtigt mini-projekt, osv.)

## Blok C -- Niveau og strategi

1. **Detekteret niveau** i opslaget vs **kandidatens naturlige niveau for denne arketype**
2. **Plan "sælg senior uden at lyve"**: konkrete formuleringer tilpasset arketypen, konkrete resultater at fremhæve, hvordan founder-erfaring positioneres som en fordel
3. **Plan "hvis jeg bliver downlevelet"**: accepter, hvis aflønningen er fair, forhandl en revision efter 6 måneder, klare forfremmelseskriterier

## Blok D -- Aflønning og efterspørgsel

Brug WebSearch til:
- Aktuelle lønninger for rollen (Glassdoor, Levels.fyi, Jobindex Lønstatistik, IDA Lønstatistik, PROSA)
- Virksomhedens lønreputation (Glassdoor)
- Efterspørgselstendens for rollen på det danske marked

Tabel med data og citerede kilder. Hvis der ingen data er, så sig det klart -- opfind ikke noget.

**Det danske marked -- Obligatoriske tjek:**
- Pension nævnt? Indregn arbejdsgiverbidraget (typisk 8-12%) i den samlede pakke.
- Variabel del (bonus, provision, warrants / aktieoptioner)?
- Feriepenge / feriefridage ud over ferielovens minimum?
- Overenskomst eller funktionærvilkår? Hvis overenskomst: tjek løntrin og vilkår.
- Fastansættelse eller tidsbegrænset? Hvis tidsbegrænset: varighed, begrundelse, mulighed for fastansættelse.
- Freelance / selvstændig? Dagssats, opgavens varighed, risiko for omklassificering.

## Blok E -- Personaliseringsplan

| # | Sektion | Nuværende tilstand | Foreslået ændring | Begrundelse |
|---|---------|--------------------|--------------------|-------------|
| 1 | Summary | ... | ... | ... |
| ... | ... | ... | ... | ... |

Top 5 ændringer i CV'et + Top 5 ændringer på LinkedIn for at maksimere matchet.

## Blok F -- Samtaleplan

6-10 STAR+R-stories mappet til opslagets krav (STAR + **Reflection**):

| # | Krav i opslaget | STAR+R-story | S | T | A | R | Reflection |
|---|-----------------|--------------|---|---|---|---|------------|

Kolonnen **Reflection** indfanger, hvad der blev lært, eller hvad der ville blive gjort anderledes. Det signalerer senioritet -- juniorer beskriver, hvad der skete, seniorer drager læring af det.

**Story Bank:** Hvis `interview-prep/story-bank.md` findes, så tjek om disse stories allerede er der. Hvis ikke, så tilføj de nye. Med tiden opbygger det en genbrugelig bank på 5-10 master-stories, der kan tilpasses ethvert samtalespørgsmål.

**Udvalgt og rammesat efter arketypen:**
- FDE -> fremhæv leveringstempo og kundenærhed
- SA -> fremhæv arkitekturbeslutninger
- PM -> fremhæv discovery og trade-offs
- LLMOps -> fremhæv metrics, evals, production hardening
- Agentic -> fremhæv orkestrering, error handling, HITL
- Transformation -> fremhæv adoption og organisatorisk forandring

Inkludér også:
- 1 anbefalet case study (hvilket projekt der præsenteres og hvordan)
- Red-flag-spørgsmål og hvordan man besvarer dem (fx "Hvorfor solgte du din virksomhed?", "Havde du et team, der refererede til dig?", "Hvorfor et skifte efter så kort tid?")

---

## Efter evalueringen

**ALTID** efter blok A-F skal du udføre:

### 1. Gem report .md

Gem den fulde evaluering i `reports/{###}-{company-slug}-{YYYY-MM-DD}.md`.

- `{###}` = næste fortløbende nummer (3 cifre, nul-paddet). For at allokere det atomisk og undgå race conditions skal du køre `node reserve-report-num.mjs` for at reservere nummeret (stdout returnerer `{###}`), skrive rapporten og derefter køre `node reserve-report-num.mjs --release {###}` for at frigive sentinel'en.
- `{company-slug}` = virksomhedsnavn i små bogstaver, uden mellemrum (brug bindestreger)
- `{YYYY-MM-DD}` = dagens dato

**Report-format:**

```markdown
# Evaluering: {Virksomhed} -- {Rolle}

**Dato:** {YYYY-MM-DD}
**Arketype:** {detekteret}
**Score:** {X/5}
**URL:** {opslagets URL}
**PDF:** {sti eller afventer}

---

## A) Rolleopsummering
(fuldt indhold af blok A)

## B) Match med CV'et
(fuldt indhold af blok B)

## C) Niveau og strategi
(fuldt indhold af blok C)

## D) Aflønning og efterspørgsel
(fuldt indhold af blok D)

## E) Personaliseringsplan
(fuldt indhold af blok E)

## F) Samtaleplan
(fuldt indhold af blok F)

## G) Udkast til svar til ansøgningen
(kun ved score >= 4.5 -- udkast til svar til ansøgningsformularen)

---

## Udtrukne nøgleord
(liste med 15-20 nøgleord fra opslaget til ATS-optimering)
```

### 2. Registrér i trackeren

**ALTID** registrér i `data/applications.md`:
- Næste fortløbende nummer
- Dagens dato
- Virksomhed
- Rolle
- Score: gennemsnit af matchet (1-5)
- Status: `Evaluated`
- PDF: nej (eller ja, hvis auto-pipeline har genereret en PDF)
- Report: relativt link til report-filen (fx `[001](reports/001-company-2026-01-01.md)`)

**Tracker-format:**

```markdown
| # | Dato | Virksomhed | Rolle | Score | Status | PDF | Report |
```
