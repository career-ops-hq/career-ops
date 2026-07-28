# Modalità: annuncio -- Valutazione completa A-F

Quando il candidato incolla o fornisce un annuncio di lavoro (testo o URL), fornire SEMPRE i 6 blocchi di valutazione.

## Blocco 0 -- Rilevamento dell'archetipo

Classificare l'annuncio in uno dei 6 archetipi di riferimento (vedi `_shared.md`). Se è un ruolo ibrido, indicare i 2 archetipi più vicini. Questa classificazione determina:
- Quali proof point prioritizzare nel Blocco B
- Come riformulare il summary del CV nel Blocco E
- Quali storie STAR preparare nel Blocco F

## Blocco A -- Riepilogo del ruolo

Tabella con:
- Archetipo rilevato
- Settore (Platform / Agentic / LLMOps / ML / Enterprise)
- Funzione (Build / Consulenza / Management / Deploy)
- Seniority
- Localizzazione (Full remote / Ibrido / In sede)
- Dimensione del team (se menzionata)
- TL;DR in una sola frase

## Blocco B -- Corrispondenza con il CV

Leggere `cv.md`. Creare una tabella che mappa ogni requisito dell'annuncio su righe esatte del CV.

**Adattamento per archetipo:**
- FDE -> priorità a proof point su velocità di consegna e vicinanza al cliente
- SA -> priorità a progettazione di sistemi e integrazioni complesse
- PM -> priorità a product discovery e metriche di prodotto/business
- LLMOps -> priorità a evals, observability e pipeline in produzione
- Agentic -> priorità a orchestrazione multi-agent, HITL e gestione affidabile degli errori
- Transformation -> priorità a change management, enablement e adozione organizzativa

Aggiungere una sezione **Gap** con strategia di mitigazione per ogni lacuna rilevata:
1. È un blocco insormontabile o un nice-to-have?
2. Il candidato può dimostrare un'esperienza affine o complementare?
3. C'è un progetto nel portfolio che copre questa lacuna?
4. Piano di mitigazione concreto (es. frase per la lettera di presentazione, mini-progetto rapido, ecc.)

## Blocco C -- Inquadramento e strategia

1. **Livello rilevato** nell'annuncio rispetto al **livello naturale del candidato** per questo archetipo.
2. **Piano "valorizzare la seniority in modo autentico"**: formulazioni specifiche per l'archetipo, risultati concreti da evidenziare, come posizionare l'esperienza da founder/imprenditore come valore aggiunto.
3. **Piano "se proposto per un livello inferiore (downlevel)"**: accettare solo se la retribuzione è equa, negoziare revisione a 6 mesi, concordare criteri di promozione chiari fin dall'inizio.

## Blocco D -- Retribuzione e mercato

Usare WebSearch per raccogliere:
- Stipendi attuali per lo stesso ruolo (Glassdoor, Levels.fyi, LinkedIn IT, portali locali)
- Reputazione retributiva dell'azienda (Glassdoor, recensioni online)
- Andamento della domanda per questo ruolo sul mercato italiano

Presentare i dati in tabella con le fonti. Se non ci sono dati, dichiararlo esplicitamente -- non inventare.

**Mercato italiano -- Verifiche obbligatorie:**
- La tredicesima / quattordicesima è menzionata? Includerla nel calcolo della RAL.
- È prevista una parte variabile (bonus, MBO, stock option)?
- Si fa riferimento a Premio di risultato o partecipazione agli utili? Verificare lo storico aziendale.
- Quale CCNL viene applicato? Verificare inquadramento e livello contrattuale proposto.
- Contratto a tempo indeterminato o determinato? Se determinato: durata, motivazione e possibilità di conversione.
- Libero Professionista? Tariffa giornaliera, durata della collaborazione e rischio di contestazione per "falsa Partita IVA" (vincoli di orario e sede).

## Blocco E -- Piano di personalizzazione

| # | Sezione | Stato attuale | Modifica proposta | Giustificazione |
|---|---------|---------------|-------------------|--------------------|
| 1 | Summary | ... | ... | ... |
| ... | ... | ... | ... | ... |

Fornire le 5 modifiche principali al CV + le 5 modifiche principali al profilo LinkedIn per massimizzare il match con l'annuncio.

## Blocco F -- Piano dei colloqui

6-10 storie in formato STAR+R mappate sui requisiti dell'annuncio (STAR + **Reflection**):

| # | Requisito dell'annuncio | Storia STAR+R | S | T | A | R | Reflection |
|---|-------------------------|---------------|---|---|---|---|------------|

La colonna **Reflection** cattura cosa si è imparato o cosa si farebbe diversamente. Questo elemento segnala seniority: i profili junior descrivono cosa è successo, i senior ne traggono insegnamenti e linee guida.

**Story Bank:** Se `interview-prep/story-bank.md` esiste, verificare se le storie sono già presenti. In caso contrario, aggiungerle. Con il tempo si costruisce un archivio riutilizzabile di 5-10 storie principali adattabili a qualsiasi colloquio.

**Storie inquadrate per archetipo:**
- FDE -> evidenziare velocità di consegna e vicinanza al cliente
- SA -> evidenziare decisioni di architettura e trade-off tecnici
- PM -> evidenziare product discovery e arbitraggi tra priorità
- LLMOps -> evidenziare metriche, evals e hardening in produzione
- Agentic -> evidenziare orchestrazione, gestione degli errori e cicli HITL
- Transformation -> evidenziare adozione dell'IA e change management su persone e processi

Includere anche:
- 1 case study raccomandato (quale progetto presentare e con quale struttura)
- Domande a rischio (red flag) e come rispondere (es. "Perché ha venduto la sua azienda?", "Aveva un team sotto di sé?", "Come mai ha cambiato dopo poco tempo?")

---

## Post-valutazione

Eseguire **SEMPRE** dopo i blocchi A-F:

### 1. Salvare il report .md

Salvare la valutazione completa in `reports/{###}-{company-slug}-{YYYY-MM-DD}.md`.

- `{###}` = prossimo numero sequenziale a 3 cifre, zero-padded. Allocarlo in modo atomico eseguendo `node reserve-report-num.mjs` (restituisce `{###}` su stdout), scrivere il report, poi eseguire `node reserve-report-num.mjs --release {###}` per liberare la prenotazione.
- `{company-slug}` = nome dell'azienda in minuscolo senza spazi (usare i trattini)
- `{YYYY-MM-DD}` = data odierna

**Formato del report:**

```markdown
# Valutazione: {Azienda} -- {Ruolo}

**Data:** {YYYY-MM-DD}
**Archetipo:** {rilevato}
**Punteggio:** {X/5}
**URL:** {URL dell'annuncio}
**PDF:** {percorso del file o in attesa}

---

## A) Riepilogo del ruolo
(contenuto completo del blocco A)

## B) Corrispondenza con il CV
(contenuto completo del blocco B)

## C) Inquadramento e strategia
(contenuto completo del blocco C)

## D) Retribuzione e mercato
(contenuto completo del blocco D)

## E) Piano di personalizzazione
(contenuto completo del blocco E)

## F) Piano dei colloqui
(contenuto completo del blocco F)

## G) Bozze di risposta per la candidatura
(solo se punteggio >= 4.5 -- risposte pronte per i moduli del portale aziendale)

---

## Parole chiave estratte
(15-20 parole chiave estratte dall'annuncio per il superamento dei filtri ATS)
```

### 2. Registrare nel tracker

Registrare **SEMPRE** la valutazione in `data/applications.md`:
- Prossimo numero sequenziale
- Data odierna
- Azienda
- Ruolo
- Punteggio: media del match (da 1 a 5)
- Stato: `Evaluated`
- PDF: no (o sì se l'auto-pipeline ha generato il PDF direttamente)
- Report: link relativo al file del report (es: `[001](reports/001-azienda-2026-01-01.md)`)

**Formato del tracker:**

```markdown
| # | Data | Azienda | Ruolo | Punteggio | Stato | PDF | Report |
```
