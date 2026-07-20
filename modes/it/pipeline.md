# Modalità: pipeline -- Inbox degli URL (Second Brain)

Elabora gli URL degli annunci accumulati in `data/pipeline.md`. Il candidato aggiunge gli URL quando vuole, poi esegue `/career-ops pipeline` per elaborarli tutti in una volta.

## Workflow

1. **Leggere** `data/pipeline.md` -> trovare gli elementi contrassegnati come `- [ ]` nella sezione "In attesa" / "Pending" / "Pendientes" / "En attente"
2. **Per ogni URL in attesa**:
   a. Riservare il prossimo `REPORT_NUM` sequenziale eseguendo `node reserve-report-num.mjs` (liberare la prenotazione con `node reserve-report-num.mjs --release <num>` una volta scritto il report)
   b. **Estrarre l'annuncio** con Playwright (`browser_navigate` + `browser_snapshot`) -> WebFetch -> WebSearch
   c. Se l'URL non è accessibile -> contrassegnarlo come `- [!]` con una nota e passare al successivo
   d. **Auto-pipeline completo**: Valutazione A-F -> Report .md -> PDF (se punteggio >= 3.0) -> Tracker
   e. **Spostare da "In attesa" a "Elaborati"**: `- [x] #NNN | URL | Azienda | Ruolo | Punteggio/5 | PDF sì/no`
3. **Se ci sono 3+ URL in attesa**, avviare gli agenti in parallelo (strumento Agent con `run_in_background`) per massimizzare la velocità.
4. **Al termine**, mostrare una tabella riassuntiva:

```
| # | Azienda | Ruolo | Punteggio | PDF | Azione raccomandata |
```

## Formato di pipeline.md

```markdown
## In attesa
- [ ] https://jobs.example.com/posting/123
- [ ] https://boards.greenhouse.io/company/jobs/456 | Azienda SRL | Senior PM
- [!] https://private.url/job -- Errore: richiesto login

## Elaborati
- [x] #143 | https://jobs.example.com/posting/789 | Acme SRL | AI PM | 4.2/5 | PDF sì
- [x] #144 | https://boards.greenhouse.io/xyz/jobs/012 | BigCo | SA | 2.1/5 | PDF no
```

> Nota: Le intestazioni delle sezioni possono essere in inglese ("Pending"/"Processed"), spagnolo ("Pendientes"/"Procesadas"), tedesco ("Offen"/"Verarbeitet"), francese ("En attente"/"Traitees") o italiano ("In attesa"/"Elaborati"). Flessibili in lettura, fedeli allo stile esistente in scrittura.

## Rilevamento dell'annuncio dall'URL

1. **Playwright (preferito):** `browser_navigate` + `browser_snapshot`. Funziona con tutte le Single Page Application (SPA).
   - **Opzionale — estrattore CLI (`scan.extractor: cli` in `config/profile.yml`):** esegui invece `node browser-extract.mjs <url>` (`--mode jd`) — `{ "url", "title", "text" }` compatto, meno token (dipende dal portale). **Ripiega in silenzio** su `browser_navigate` + `browser_snapshot` in caso di errore o assenza.
2. **WebFetch (fallback):** Per le pagine statiche o quando Playwright non è disponibile.
3. **WebSearch (ultima risorsa):** Per cercare su portali secondari che indicizzano l'annuncio.

**Casi particolari:**
- **LinkedIn:** può richiedere login -> contrassegnare come `[!]` e chiedere al candidato di incollare il testo dell'annuncio
- **PDF:** se l'URL punta a un PDF, leggerlo direttamente con il Read tool
- **Prefisso `local:`:** legge un file locale. Esempio: `local:jds/linkedin-pm-ai.md` -> legge `jds/linkedin-pm-ai.md`
- **Indeed IT / LinkedIn IT:** portali molto diffusi in Italia. Playwright gestisce bene i cookie banner.

## Numerazione automatica

1. Eseguire `node reserve-report-num.mjs` per riservare in modo atomico il prossimo numero sequenziale (restituisce `{###}` su stdout).
2. Scrivere il report con questo numero.
3. Liberare la prenotazione con `node reserve-report-num.mjs --release {###}` una volta scritto il report.

## Sincronizzazione delle fonti

Prima di elaborare un URL, verificare la sincronizzazione:

```bash
node cv-sync-check.mjs
```

In caso di desincronizzazione, avvisare il candidato prima di procedere.
