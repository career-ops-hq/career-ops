# Mode: apply -- Live-assistent til ansøgningsformularer

Interaktiv mode til det øjeblik, hvor kandidaten udfylder en ansøgningsformular i Chrome. Den læser, hvad der er på skærmen, indlæser konteksten fra opslagets tidligere evaluering og genererer personaliserede svar til hvert spørgsmål i formularen.

## Forudsætninger

- **Bedst med Playwright synlig**: I synlig tilstand ser kandidaten browseren, og Claude kan interagere med siden.
- **Uden Playwright**: kandidaten deler et skærmbillede eller indsætter spørgsmålene manuelt.

## Workflow

```
1. DETEKTÉR     -> Læs den aktive Chrome-fane (skærmbillede/URL/titel)
2. IDENTIFICÉR  -> Udtræk virksomhed + rolle fra siden
3. SØG          -> Match mod eksisterende reports i reports/
4. INDLÆS       -> Læs den fulde report + Blok G (hvis den findes)
5. SAMMENLIGN   -> Svarer rollen på skærmen til den evaluerede? Hvis ændret -> advar
6. ANALYSÉR     -> Identificér ALLE synlige spørgsmål i formularen
7. GENERÉR      -> Generér et personaliseret svar til hvert spørgsmål
8. PRÆSENTÉR    -> Vis de formaterede svar til copy-paste
```

## Trin 1 -- Detektér opslaget

**Med Playwright:** Snapshot af den aktive side. Læs titel, URL og synligt indhold.

**Uden Playwright:** Bed kandidaten om at:
- Dele et skærmbillede af formularen (Read-værktøjet læser billeder)
- Eller indsætte formularens spørgsmål som tekst
- Eller angive virksomhed + rolle, så vi kan finde konteksten

## Trin 2 -- Identificér og indlæs konteksten

1. Udtræk virksomhedens navn og stillingstitlen fra siden
2. Søg i `reports/` efter virksomhedsnavn (Grep case-insensitive)
3. Hvis match -> indlæs den fulde report
4. Hvis Blok G findes -> indlæs de tidligere svar-udkast som grundlag
5. Hvis INTET match -> advar kandidaten og foreslå en hurtig auto-pipeline

## Trin 3 -- Detektér rolleændringer

Hvis rollen på skærmen afviger fra den evaluerede:
- **Advar kandidaten**: "Rollen har ændret sig fra [X] til [Y]. Ønsker du, at jeg genevaluerer, eller at jeg tilpasser svarene til den nye titel?"
- **Hvis tilpas**: Justér svarene til den nye rolle uden at genevaluere
- **Hvis genevaluér**: Kør den fulde A-F-evaluering, opdatér report, regenerér Blok G
- **Opdatér trackeren**: Ret rollens titel i applications.md om nødvendigt

## Trin 4 -- Analysér formularens spørgsmål

Identificér ALLE synlige spørgsmål:
- Fritekstfelter (følgebrev, "hvorfor denne stilling", motivation, osv.)
- Dropdowns (hvordan hørte du om virksomheden, arbejdstilladelse, osv.)
- Ja/Nej (mobilitet, visum, tilgængelighed, osv.)
- Lønfelter (interval, lønforventning -- i brutto årsløn for Danmark)
- Upload-felter (CV, følgebrev som PDF, referencer)

Klassificér hvert spørgsmål:
- **Allerede besvaret i Blok G** -> genbrug det eksisterende svar
- **Nyt spørgsmål** -> generér svaret fra report + `cv.md`

## Trin 5 -- Generér svarene

For hvert spørgsmål, byg svaret efter dette skema:

1. **Kontekst fra report**: Brug proof points fra blok B, STAR-stories fra blok F
2. **Tidligere Blok G**: Hvis et udkast findes, så brug det som grundlag og finpuds
3. **Tonen "Jeg vælger jer"**: samme framework som i auto-pipeline -- selvsikker, ikke bønfaldende
4. **Specificitet**: citér noget konkret fra opslaget, der er synligt på skærmen
5. **career-ops proof point**: inkludér i "Yderligere oplysninger", hvis et sådant felt findes

**Felter, der er specifikke for almindelige danske formularer:**
- **Lønforventning (brutto årsløn)** -> Interval fra `profile.yml`, i DKK, med bemærkningen "forhandlelig afhængigt af den samlede pakke"
- **Startdato** -> Realistisk dato, der tager højde for opsigelsesvarsel (ofte 1-3 måneder)
- **Arbejdstilladelse / Nationalitet** -> Ærligt og kortfattet; for EU-borgere: "Ingen opholdstilladelse påkrævet (EU-borger)"
- **Sprog** -> Niveauer efter CEFR (A1-C2)
- **Mobilitet** -> Angiv det acceptable geografiske område og hyppigheden af rejser

**Output-format:**

```
## Svar til [Virksomhed] -- [Rolle]

Grundlag: Report #NNN | Score: X.X/5 | Arketype: [type]

---

### 1. [Eksakt spørgsmål fra formularen]
> [Svar klar til copy-paste]

### 2. [Næste spørgsmål]
> [Svar]

...

---

Noter:
- [Observationer om rollen, ændringer, osv.]
- [Forslag til personalisering, som kandidaten bør tjekke]
```

## Trin 6 -- Efter ansøgningen (valgfrit)

Hvis kandidaten bekræfter, at ansøgningen er sendt:
1. Opdatér status til "Applied" med det kanoniske CLI: `node set-status.mjs <report#> Applied` (redigér ikke `applications.md`-tabellen i hånden)
2. Opdatér report'ens Blok G med de endelige svar
3. Foreslå næste trin: `/career-ops contacto` til LinkedIn-outreach mod den ansættende leder

## Håndtering af scroll

Hvis formularen har flere spørgsmål, end der er synlige:
- Bed kandidaten om at scrolle og dele endnu et skærmbillede
- Eller indsætte de resterende spørgsmål
- Behandl i iterationer, indtil hele formularen er dækket
