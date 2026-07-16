# career-ops -- Modalità in italiano (`modes/it/`)

Questa cartella contiene le traduzioni in italiano delle principali modalità di career-ops per i candidati che si rivolgono al mercato italiano.

## Quando usare queste modalità?

Usa `modes/it/` se si verifica almeno una di queste condizioni:

- Ti candidi principalmente ad **annunci di lavoro in italiano** (LinkedIn IT, Indeed IT, portali aziendali)
- Il tuo **CV è in italiano** (o alterni tra italiano e inglese a seconda dell'annuncio)
- Hai bisogno di risposte e lettere di presentazione scritte in un **italiano tech naturale**, non tradotte da una macchina
- Devi gestire **specificità contrattuali italiane**: contratti a tempo indeterminato o determinato, CCNL, TFR, buoni pasto, assicurazione sanitaria integrativa, tredicesima, quattordicesima, periodo di prova, preavviso, permessi retribuiti e inquadramento come Quadro.

Se la maggior parte delle tue offerte è in inglese, ti conviene rimanere sulle modalità standard in `modes/`. Le modalità in inglese funzionano anche per le offerte in Italia, ma non conoscono in dettaglio le specificità del mercato italiano.

## Come attivarle?

### Opzione 1 -- Per singola sessione

All'inizio della sessione, dì all'agente:

> "Usa le modalità in italiano sotto `modes/it/`."

L'agente leggerà quindi i file di questa cartella anziché quelli di `modes/`.

### Opzione 2 -- In modo permanente

Aggiungi nel file `config/profile.yml`:

```yaml
language:
  primary: it
  modes_dir: modes/it
```

Ricordalo all'agente durante la tua prima sessione ("Guarda in `profile.yml`, ho configurato `language.modes_dir`"). L'agente utilizzerà automaticamente le modalità in italiano.

## Quali modalità sono tradotte?

Questa prima iterazione copre le quattro modalità a più alto impatto:

| File | Tradotto da | Ruolo |
|------|-------------|-------|
| `_shared.md` | `modes/_shared.md` (EN) | Contesto condiviso, archetipi, regole globali, specificità del mercato italiano |
| `annuncio.md` | `modes/oferta.md` (ES) | Valutazione completa di un annuncio di lavoro (Blocchi A-F) |
| `candidarsi.md` | `modes/apply.md` (EN) | Assistente live per compilare i moduli di candidatura |
| `pipeline.md` | `modes/pipeline.md` (ES) | Inbox di URL / Second Brain per gli annunci raccolti |

Le altre modalità (`scan`, `batch`, `pdf`, `tracker`, `auto-pipeline`, `deep`, `contacto`, `ofertas`, `project`, `training`) rimangono in inglese/spagnolo. Il loro contenuto riguarda principalmente il tooling, i percorsi e i comandi, e deve rimanere indipendente dalla lingua.

## Cosa rimane in inglese

Volutamente non tradotto perché fa parte del vocabolario tecnologico standard:

- `cv.md`, `pipeline`, `tracker`, `report`, `score`, `archetype`, `proof point`
- Nomi degli strumenti (`Playwright`, `WebSearch`, `WebFetch`, `Read`, `Write`, `Edit`, `Bash`)
- Valori di stato nel tracker (`Evaluated`, `Applied`, `Interview`, `Offer`, `Rejected`)
- Porzioni di codice, percorsi, comandi

Le modalità utilizzano un italiano tech naturale, come quello parlato nei team di engineering: testo corrente in italiano, termini tecnici in inglese laddove è d'uso comune. Evitiamo traduzioni forzate (ad esempio, lasciamo "Pipeline" invece di "Canalizzazione" o "Deploy" invece di "Dispiegamento").

## Lessico di riferimento

Per mantenere un tono coerente se decidi di modificare o estendere le modalità:

| Inglese | Italiano (in questa codebase) |
|---------|-------------------------------|
| Job posting | Annuncio di lavoro |
| Application | Candidatura |
| Cover letter | Lettera di presentazione |
| Resume / CV | CV / Curriculum Vitae |
| Salary | Stipendio / Retribuzione |
| Compensation | Retribuzione |
| Skills | Competenze |
| Interview | Colloquio |
| Hiring manager | Responsabile della selezione |
| Recruiter | Recruiter / Selezionatore |
| AI | IA (Intelligenza Artificiale) |
| Requirements | Requisiti |
| Career history | Percorso professionale |
| Notice period | Periodo di preavviso |
| Probation | Periodo di prova |
| Vacation | Ferie |
| 13th month salary | Tredicesima |
| Permanent contract | Contratto a tempo indeterminato |
| Fixed-term contract | Contratto a tempo determinato |
| Freelance | Libero Professionista |
| Collective agreement | CCNL (Contratto Collettivo Nazionale di Lavoro) |
| Works council | RSU / Rappresentanza Sindacale |
| Profit sharing | Premio di risultato / MBO / Partecipazione agli utili |
| Meal vouchers | Buoni pasto |
| Health insurance | Assicurazione sanitaria integrativa / Cassa sanitaria |
| Disability/life insurance | Assicurazione vita |
| RTT | Permessi retribuiti |
| Cadre status | Quadro |

## Contribuire

Per migliorare una traduzione o aggiungere una modalità:

1. Apri una Issue con la tua proposta (vedi `CONTRIBUTING.md`)
2. Rispetta il lessico indicato sopra per mantenere un tono coerente
3. Traduci in modo idiomatico -- evita traduzioni letterali o da traduttore automatico
4. Conserva gli elementi strutturali (Blocchi A-F, tabelle, blocchi di codice, istruzioni strumenti) esattamente come nell'originale
5. Esegui un test con un vero annuncio in italiano prima di inviare la PR
