# Modalità: interview/plan — Pianificatore di Preparazione al Colloquio

Data una descrizione del lavoro (JD) e la data/ora del colloquio, costruisci un piano di preparazione strutturato per blocchi di tempo e personalizzato sulle lacune specifiche del candidato.

---

## Input

1. **Descrizione del lavoro** (obbligatorio) — incollata o tramite URL
2. **Data e ora del colloquio** (obbligatorio) — per calcolare le ore disponibili
3. **Nome e ruolo dell'intervistatore** (se noto) — dà forma alla profondità e al tono della preparazione. Spesso i round successivi (panel / onsite) indicano più intervistatori contemporaneamente — forniti direttamente dall'utente o copiati da un invito a calendario / un'email di programmazione. Quando è nominato più di un panelist, vedi la nota Intel Panel al Passo 2.
4. **Tipo di round** (se noto) — conoscitivo, tecnico/specifico di dominio, design/studio di un caso, comportamentale (panel)
5. **CV** in `cv.md` + `article-digest.md` (se presente) — per leggere l'esperienza, le competenze, i punti di prova
6. **Profilo** in `config/profile.yml` + `modes/_profile.md` — per leggere la narrativa, gli archetipi e gli obiettivi
7. **Banca delle storie** in `interview-prep/story-bank.md` — storie STAR+R esistenti
8. **Banca delle domande** in `interview-prep/question-bank.md` — lacune esistenti (se il file esiste)
9. **Compenso dichiarato in precedenza** — se il tracker# è noto, esegui `node salary-gap.mjs --stated-for <tracker#>` (zero token). Qualsiasi precedente osservazione in `stated` è una cifra per la quale il candidato si è già impegnato in un round precedente con un intervistatore specifico — inseriscilo nel riferimento rapido del Passo 4, affinché il candidato sia coerente invece di rinegoziare accidentalmente.

---

## Passo 1 — Valutazione della Compatibilità

Leggi il CV e la JD. Produci una valutazione a due colonne:

**Punti di forza su cui fare leva:** esperienza, titoli di lavoro, dominio, punti di prova che corrispondono direttamente alla JD.

**Lacune da colmare:** competenze, strumenti, o esperienza citati nella JD che sono assenti o deboli nel CV. Classificali in base alla probabilità che vengano testati in questo specifico tipo di round.

Sii onesto. Una lacuna è una lacuna — segnalala chiaramente affinché il tempo di preparazione sia speso nel posto giusto.

---

## Passo 2 — Informazioni sul Round

Identifica cosa questo round sta effettivamente valutando basandoti su:
- Ruolo dell'intervistatore (manager = comunicazione + passione + fondamenti; tecnico (practitioner) = profondità + giudizio)
- Etichetta del round (conoscitivo, tecnico/dominio, design/studio di un caso, round finale)
- Segnali dalla JD (su cosa pongono maggiore enfasi)

**Round conoscitivo con Recruiter (Recruiter screen):**
- Check di base: compatibilità, allineamento salariale, logistica, comunicazione
- Non è un test tecnico — le domande approfondite arriveranno con l'Hiring Manager e nei round successivi
- Probabili domande: presentazione di sé, "perché noi/perché questo ruolo", aspettativa salariale, tempistiche, una domanda di natura logistica
- Tratta questo passo come un punto di controllo semplice; usa il tempo di preparazione per costruire le basi di ciò che verrà dopo

**Round con l'Hiring-manager:**
- Comunicazione, passione, compatibilità — oltre a filosofia di leadership e capacità di giudizio
- Fondamenti della competenza principale indicata nella JD — non approfondimenti eccessivamente tecnici
- 1–2 storie comportamentali
- Probabili domande: background, "perché noi", un concetto cardine della JD, una storia di leadership, una domanda su scenari futuri

**Approfondimento Tecnico / di dominio con un esperto (practitioner):**
- Profondità nella competenza cardine della JD (es. dettagli del runtime per ingegneria, scelte di modellazione per i dati, metodi di valutazione per la finanza)
- Scenari applicati relativi al lavoro di tutti i giorni per il ruolo
- Possibile esercizio dal vivo o dimostrazione su un lavoro svolto
- Le storie sono usate come prove a supporto, non sono il tema principale

**Panel di Design / studio di un caso:**
- Soluzione completa — vincoli, componenti, compromessi, modalità di guasto
- Dimensioni qualitative che la JD enfatizza (es. scalabilità, conformità legale, misurabilità)
- Per ruoli senior: fissare i vincoli, fare domande per chiarimenti, guidare la conversazione

Calibra il piano per il tipo di round in programma. Prepararsi eccessivamente per approfondimenti in un round conoscitivo fa sprecare tempo e crea un'impostazione mentale errata.

**Intel Panel (quando i nomi dei membri del panel sono noti).** Se per questo round vengono nominati due o più intervistatori — dall'utente in modo diretto, o tramite l'incollare di inviti a calendario/email di schedulazione — costruisci la tabella Panel Intel prima di passare al Passo 3. Vedi `modes/interview-prep.md` § "Tabella Panel Intel" (sotto Passo 4 → `panel-mixed`) per il formato completo della tabella e i tre sotto-comportamenti (peso per il processo decisionale in relazione alle linee di riporto della JD, lettura dei segnali sul percorso di carriera, chiusura mirata della domanda per panelist) — applica qui la stessa logica, per poi usare i tag di pubblico per dimensionare i blocchi del Passo 3 per ciascun panelist invece di preparare un generico pacchetto unico. Un singolo intervistatore nominato non necessita della tabella; vai direttamente al Passo 3 calibrato su quel round specifico visto sopra.

---

## Passo 3 — Costruisci il Piano a Blocchi di Tempo

Calcola le ore a disposizione da adesso all'orario del colloquio. Dividi il tempo in blocchi:

Prima di dimensionare i blocchi, controlla `interview-prep/question-bank.md` (se esiste). Ogni domanda contrassegnata 🔴 proveniente da un round precedente è una lacuna comprovata — le viene assegnato un blocco dedicato indipendentemente dalla classifica dell'analisi del CV contro la JD. I dati reali di prestazione sono superiori al rischio presunto.

**Controllo della ricerca — prima di redigere il Blocco 4.** Il Blocco 4 associa le storie alle "probabili tipologie di domande", ma non farlo affidandoti a intuizioni, dal momento che domande reali riportate possono trovarsi ad un click di distanza:

1. **Prima controlla se esistono ricerche con fonti già eseguite.** Se `interview-prep/{company-slug}-{role-slug}.md` esiste già (da un'esecuzione passata di `interview-prep`), leggi le domande con fonti riportate dal Passo 1/Passo 3 e riutilizzale direttamente — non ripetere mai ricerche per lavori che sono già stati compiuti e citati.
2. **Se non esiste alcun file di ricerca precedente, esegui direttamente `interview-prep.md` e le sue query WebSearch per il "Passo 1 — Ricerca"**, circoscritte al pubblico di questo round specifico (recruiter/HR, hiring manager, oppure panel peer/tecnico — vedi il Passo 2 sopra) invece di eseguire la ricerca estensiva per tutta l'azienda.
3. **Usa la medesima disciplina di tagging di `interview-prep.md`:** le domande citano la loro fonte; ciò che non viene trovato si classifica come `[dedotto dalla JD]` — non inventare una terza etichetta o un formato di citazione diverso (vedi "Convenzioni sui tag" in `interview-prep.md`).
4. **Se la ricerca davvero non produce alcun risultato** (azienda poco nota, nessun resoconto pubblico di colloqui), indicalo esplicitamente nell'output del piano e procedi con l'inferenza di pattern da JD/profilo — questo è lo stesso principio "parziale-ma-onesto" applicato già in `interview-prep.md` per scarse informazioni (non si usa la mentalità del "tutto o niente").

Questa è la controparte proattiva per la via di ricerca reattiva già usata a metà sessione in `modes/interview/practice.md` (vedi il suo "Quando le informazioni sull'azienda sono scarse a metà sessione") — la fase di ricerca è la stessa, ma qui viene invocata prima della stesura del piano anziché quando un candidato incorre in esitazioni in diretta.

**Template (modula le dimensioni dei blocchi a seconda delle ore totali a disposizione):**

```text
Blocco 1 — Fissa la tua narrativa (sempre come primissima cosa)
  - Metti per iscritto esplicitamente la cronologia della tua esperienza lavorativa
  - Prepara "perché questa azienda" trovando un legame specifico alla tua storia
  - Prepara la storia relativa al tuo punto di prova più forte (versione da 30 secondi)
  - Tempo: ~15% delle ore disponibili

Blocco 2 — Argomento di dominio prioritario (prima le lacune a rischio più elevato)
  - Un argomento per blocco — non mescolarli
  - Per ciascuno: concetto → collegamento (hook) della tua storia → probabili domande successive
  - Tempo: ~25% delle ore disponibili

Blocco 3 — Argomento di dominio secondario
  - La seconda lacuna per livello di rischio
  - Tempo: ~20% delle ore disponibili

Blocco 4 — Storie comportamentali
  - Associa storie esistenti alle tipologie di domande probabili — per prime quelle reperite dal Controllo della ricerca visto prima, poi inserisci quelle `[dedotto dalla JD]` dove ci sono ancora lacune
  - Prova ad alta voce la versione orale da 2 minuti per ciascuna di esse
  - Prepara la Riflessione per ognuna di esse — il fattore distintivo del candidato senior
  - Tempo: ~15% delle ore disponibili

Blocco 5 — Ricerca aziendale
  - Pagine prodotto attinenti al ruolo
  - Collegamento fra la tua storia e il loro specifico campo/dominio lavorativo
  - 3–4 domande affilate da porre loro
  - Tempo: ~10% delle ore disponibili

Blocco 6 — Simulazione del colloquio (se il tempo lo consente)
  - Una domanda per ciascuno degli argomenti probabili — ad alta voce, con tempistica
  - Tempo: ~10% delle ore disponibili

Blocco 7 — Cuscinetto + riposo
  - Fermati nello studio 60–90 minuti prima del colloquio
  - Tentare di imparare forzatamente durante l'ultima ora aggiunge interferenza, non segnali utili
  - Tempo: rimanente
```

Adegua la dimensione dei blocchi al grado di severità delle lacune e al tipo di round. Se è un colloquio conoscitivo, il Blocco 4 (comportamentale) e il Blocco 5 (ricerca aziendale) risultano ben più importanti dei blocchi sull'approfondimento di dominio.

---

## Passo 4 — Riferimento Rapido (Quick-Reference) per le Priorità

Alla fine del piano, realizza un riferimento rapido di una pagina che il candidato possa scorrere 15 minuti prima del colloquio:

```markdown
## Ripasso a 15 Minuti dal Colloquio

**La tua frase àncora:** [una frase che racchiuda il perché tu sei perfetto per questo ruolo]

**Le prime 3 cose da tenere a mente:**
1. [il messaggio più importante da far arrivare all'intervistatore]
2. [la domanda in assoluto più probabile, assieme alla prima frase della tua risposta]
3. [il legame tra la tua storia ed il loro dominio/settore lavorativo]

**Compenso — precedentemente discusso:** [solo se `--stated-for` restituisce osservazioni antecedenti] "Hai dichiarato {amount} {currency} con {interviewer} il {date} al round {round}. Rimani coerente su questo a meno che non sia cambiato qualcosa di materiale." Ometti completamente questo blocco se non vi sono osservazioni `stated` in precedenza per questo numero di tracker — non inventare una cifra qualora non sia mai stata discussa.

**Le tue domande da fare:**
1. [domanda 1]
2. [domanda 2]
3. [domanda 3]
```

---

## Passo 5 — Salvataggio Output

Salva il piano su `interview-prep/{company-slug}-{role-slug}.md`. Se il file non esiste, crealo (includendo l'intestazione `## Prep Plan`). Se il file esiste già, inserisci il nuovo piano immediatamente sotto l'intestazione `## Prep Plan` preesistente, assicurandoti che rimanga all'interno di quella sezione e non venga accodato indiscriminatamente alla fine del documento.

---

## Regole

- **Calibra in base al round.** Il piano di preparazione per un colloquio conoscitivo ha un aspetto totalmente differente rispetto al piano previsto in un round panel di design. Non impostare la massima profondità come default per ogni colloquio.
- **Le lacune per prime.** Il tempo è limitato. I punti di forza del candidato non necessitano preparazione — al contrario delle lacune.
- **Le lacune 🔴 della banca delle domande hanno la precedenza su quelle desunte analiticamente.** La prestazione verificata in base ai dati reali vince sull'analisi di CV verso JD. Qualora il candidato sappia che in passato si è trovato in difficoltà su una determinata tematica, questo non va tralasciato.
- **Un argomento per ogni blocco.** Mescolare più materie nello stesso lasso di tempo abbassa i livelli di assimilazione.
- **Prevedi sempre pause per il riposo.** Un candidato riposato supererà di gran lunga nelle performance un candidato che tenta di studiare in extremis.
- **Non inventare mai informazioni sull'azienda.** Se non si possiede una ricerca documentata, dichiaralo palesemente — senza mai inventarsi claims legati alla cultura o dettagli tecnici concernenti l'azienda.
- **Effettua un controllo in presenza di domande reali documentate precedentemente al Blocco 4.** Riutilizza `interview-prep/{company-slug}-{role-slug}.md` qualora già esista; altrimenti, esegui il Passo 1 di `interview-prep.md` che esegue le query per circoscrivere l'oggetto per il round in corso. Mantieni un'adeguata disciplina di tagging così come specificato nel documento di origine `interview-prep.md` — le medesime diciture vanno usate per fonti con-citazione o mediante inserimenti con classificazione come `[dedotto dalla JD]` qualora le risposte non producessero concreti riscontri documentati. Questa si qualifica quindi quale l'equivalente controparte proattiva di quanto indicato in precedenza come: "Non inventare mai informazioni sull'azienda": verificare dati reali disponibili anziché fare ricorso al meccanismo basato sull'inferenza deduttiva.
- **Non generare mai pretese che il candidato non ha.** La frase "ancora" così come gli spunti di riflessione prima di arrivare alla sessione previsti dal Quick-Reference (Passo 4) dovranno basarsi scrupolosamente attorno a quelle che si dimostrano le informazioni effettive attinenti alle competenze in mano al candidato, in `cv.md`, `article-digest.md`, oppure nel catalogo della story bank. Non costruire narrazioni che farebbero appello a misurazioni od esperienze in ambiti laddove non si riscontrano credenziali adeguate. Se si trovasse un attributo contenuto in `interview-prep/retracted-claims.md`, l'istruzione impone il vincolo che esclude nel modo più perentorio qualsiasi tipo di inserimento nei testi.
