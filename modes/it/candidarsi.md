# Modalità: candidarsi -- Assistente live per i moduli di candidatura

Modalità interattiva per quando il candidato compila un modulo di candidatura (es. su LinkedIn o un portale aziendale). Legge lo schermo, carica il contesto della valutazione precedente dell'annuncio e genera risposte personalizzate per ogni domanda del modulo.

## Prerequisiti

- **Ottimale con Playwright visibile:** il candidato vede il browser e l'agente può interagire direttamente con la pagina.
- **Senza Playwright:** il candidato condivide uno screenshot o incolla le domande manualmente.

## Workflow

```
1. RILEVARE      -> Leggere la scheda attiva del browser (screenshot/URL/titolo)
2. IDENTIFICARE  -> Estrarre azienda + ruolo dalla pagina
3. CERCARE       -> Trovare corrispondenze con i report esistenti in reports/
4. CARICARE      -> Leggere il report completo + Blocco G (se esiste)
5. CONFRONTARE   -> Il ruolo a schermo corrisponde a quello valutato? Se cambia -> avvisare
6. ANALIZZARE    -> Identificare TUTTE le domande visibili nel modulo
7. GENERARE      -> Per ogni domanda, generare una risposta personalizzata
8. PRESENTARE    -> Mostrare le risposte formattate pronte per il copia-incolla
```

## Fase 1 -- Rilevare l'annuncio

**Con Playwright:** Snapshot della pagina attiva. Leggere titolo, URL e contenuto visibile.

**Senza Playwright:** Chiedere al candidato di:
- Condividere uno screenshot del modulo (il Read tool legge il testo dall'immagine)
- Oppure incollare le domande in formato testo
- Oppure indicare azienda e ruolo per cercare il report corrispondente

## Fase 2 -- Identificare e caricare il contesto

1. Estrarre il nome dell'azienda e il titolo del ruolo dalla pagina.
2. Cercare in `reports/` per nome azienda (Grep case-insensitive).
3. Se c'è corrispondenza -> caricare il report completo.
4. Se il Blocco G è presente -> usare le bozze precedenti come base di partenza.
5. Se NON c'è corrispondenza -> avvisare il candidato e proporre un auto-pipeline rapido.

## Fase 3 -- Rilevare variazioni nel ruolo

Se il ruolo a schermo differisce da quello valutato:
- **Avvisare il candidato:** "Il ruolo rilevato è [Y], il report fa riferimento a [X]. Vuoi che riesegua la valutazione o che adatti le risposte al nuovo titolo?"
- **Se adattare:** Aggiornare le risposte al nuovo ruolo senza rieseguire la valutazione completa.
- **Se rivalutare:** Avviare la valutazione completa A-F, aggiornare il report e rigenerare il Blocco G.
- **Aggiornare il tracker:** Modificare il titolo del ruolo in `applications.md` se necessario.

## Fase 4 -- Analizzare le domande del modulo

Identificare tutte le domande visibili a schermo:
- Campi di testo libero (lettera di presentazione, "perché questa posizione", motivazione, ecc.)
- Elenchi a discesa (come hai conosciuto l'azienda, permessi di lavoro, ecc.)
- Domande Sì/No (disponibilità al trasferimento, necessità di visto, disponibilità temporale, ecc.)
- Campi retribuzione (retribuzione desiderata -- indicare la RAL in euro per l'Italia)
- Campi di upload (CV, lettera di presentazione PDF, referenze)

Classificare ogni domanda:
- **Già nel Blocco G:** riprendere la risposta esistente
- **Nuova domanda:** generare la risposta partendo dal report e da `cv.md`

## Fase 5 -- Generare le risposte

Per ogni domanda, costruire la risposta seguendo questo schema:

1. **Contesto del report:** usare i proof point del Blocco B e le storie STAR del Blocco F.
2. **Blocco G precedente:** se esiste una bozza, usarla come base e affinarla.
3. **Tono "Vi scelgo":** sicuro e professionale, non implorante né puramente descrittivo.
4. **Specificità:** citare qualcosa di concreto dell'annuncio visibile a schermo.
5. **career-ops proof point:** includerlo nel campo "Informazioni aggiuntive" se presente nel modulo.

**Campi specifici per i moduli di candidatura italiani:**
- **Retribuzione desiderata (RAL):** fascia definita in `profile.yml` in euro, con l'aggiunta "negoziabile in base al pacchetto complessivo di benefit e welfare".
- **Data di disponibilità:** data realistica tenendo conto del periodo di preavviso (di solito 1-3 mesi).
- **Permesso di lavoro / Cittadinanza:** risposte concise; per i cittadini italiani/UE: "Nessun visto richiesto (cittadino UE)".
- **Lingue:** livelli secondo il Quadro Comune Europeo di Riferimento (QCER, A1-C2).
- **Mobilità:** specificare le aree geografiche accettabili e la frequenza massima delle trasferte (es. "disponibile a trasferte fino al 20% del tempo").

**Formato di output:**

```
## Risposte per [Azienda] -- [Ruolo]

Base: Report #NNN | Punteggio: X.X/5 | Archetipo: [tipo]

---

### 1. [Domanda esatta del modulo]
> [Risposta pronta per il copia-incolla]

### 2. [Domanda successiva]
> [Risposta]

...

---

Note:
- [Osservazioni sul ruolo, variazioni, ecc.]
- [Suggerimenti di personalizzazione che il candidato dovrebbe verificare]
```

## Fase 6 -- Dopo la candidatura (opzionale)

Se il candidato conferma di aver inviato il modulo:
1. Aggiornare lo stato ad "Applied" con la CLI canonica: `node set-status.mjs <report#> Applied` (non modificare la tabella di `applications.md` a mano).
2. Aggiornare il Blocco G del report con le risposte effettivamente inviate.
3. Suggerire il passo successivo: `/career-ops contacto` per avviare il contatto su LinkedIn con il responsabile della selezione.

## Gestione dello scorrimento

Se il modulo contiene più domande rispetto a quelle visibili:
- Chiedere al candidato di scorrere la pagina e condividere un altro screenshot.
- Oppure incollare le domande restanti.
- Procedere per iterazioni fino a coprire l'intero modulo.
