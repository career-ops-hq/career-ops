# Mode: interview/debrief — Nachbereitung nach dem Interview

Erfasse nach einem echten Interview, was gefragt wurde, bewerte, was gesessen hat und was nicht, schließe Lücken vor der nächsten Runde und aktualisiere die Question Bank.

---

## When to Run This Skill

- Unmittelbar nach einem echten Interview (solange die Erinnerung frisch ist)
- Nach einem Recruiter-Call, der neue Informationen über den Prozess zutage gefördert hat
- Wenn der Kandidat das Format der nächsten Runde und den Interviewer erfährt

---

## Inputs

1. **Debrief des Kandidaten** — welche Fragen gestellt wurden, wie er geantwortet hat, was sich stark oder schwach anfühlte
2. **Name und Rolle des Interviewers** — informiert die Prognose der nächsten Runde
3. **Ausgang der Runde** (falls bekannt) — weiter / abgelehnt / offen
4. **Details zur nächsten Runde** (falls bekannt) — Format, Interviewer, Zeitplan
5. **Question Bank** unter `interview-prep/question-bank.md` — mit echten Daten aktualisieren
6. **Story Bank** unter `interview-prep/story-bank.md` — neue Stories ergänzen, falls welche auftauchen
7. **Lebenslauf** unter `cv.md` + `article-digest.md` (falls vorhanden) — um vorgeschlagene Antworten in echter Erfahrung zu verankern
8. **Retracted Claims** unter `interview-prep/retracted-claims.md` (falls vorhanden) — hartes Gate; verwende eine zurückgezogene Aussage nie in einer vorgeschlagenen Antwort, selbst wenn der Kandidat sie im Interview gesagt hat
9. **Rollenspezifische Prep-Datei** — Debrief-Notizen anhängen

---

## Step 1 — Capture What Was Asked

Bitte den Kandidaten, jede Frage aufzulisten, an die er sich erinnert, möglichst in Reihenfolge. Prime nicht mit Optionen — lass ihn zuerst frei erinnern.

Für jede erfasste Frage:
- Was hat er gesagt?
- Wie hat der Interviewer reagiert (positives Signal, neutral, hat nachgehakt, schnell weitergegangen)?
- Fühlte er sich sicher oder unsicher?

Ist die Erinnerung unvollständig, stelle gezielte Nachfragen:
- "Gab es Fragen, die dich überrascht haben?"
- "Gab es etwas, das du gern anders beantwortet hättest?"
- "Hat der Interviewer bei etwas nachgehakt — das bedeutet meist, dass er mehr wollte?"

---

## Step 2 — Honest Assessment Per Question

Erstelle für jede Frage:

```markdown
**Q: [Frage]**
- What was said: [Zusammenfassung ihrer Antwort]
- What landed: [was gut war — sei konkret]
- What was missing: [Lücke — präziser Fachbegriff, fehlendes Ergebnis, keine Reflection etc.]
- Correct/complete answer: [was die vollständige Antwort enthalten sollte]
- Status: ✅ Strong / 🟡 Solid / 🔴 Gap
```

Sei direkt. Wenn sie das Kernkonzept verfehlt haben, das die Frage geprüft hat, sag es. War eine Antwort wirklich stark, sag auch das. Der Debrief ist der wertvollste Lernmoment — Vagheit verschwendet ihn.

---

## Step 3 — Update Question Bank

Aktualisiere für jede besprochene Frage `interview-prep/question-bank.md`:
- Ändere den Status auf ✅ / 🟡 / 🔴 basierend auf der realen Performance
- Ergänze Lückennotizen aus dem Debrief
- Ergänze alle neuen Fragen, die auftauchten und noch nicht in der Bank waren

Existiert die Question Bank nicht, erstelle sie mit den Fragen aus diesem Interview als Ausgangsbasis.

---

## Step 4 — Close the Gaps

Für jede identifizierte 🔴-Lücke:

1. **Erkläre die korrekte Antwort** — klar, prägnant, mit einem durchgearbeiteten Beispiel (Code, Berechnung, Diagramm), wo es hilft
2. **Verknüpfe mit einer echten Story**, falls möglich — "du hast das tatsächlich in deiner [vorhandenen Story aus der Story Bank] — so verwendest du sie"
3. **Ergänze in der rollenspezifischen Prep-Datei** unter einem Abschnitt "Gaps to Close Before Round N"
4. **Ergänze in `interview-prep/interview-prep-guide.md`** (falls der Kandidat eine pflegt), wenn es ein wiederverwendbares Prinzip ist, das über diese Rolle hinaus gilt

---

## Step 5 — Extract New Stories

Manchmal fördert ein echtes Interview eine Story zutage, die der Kandidat nicht vorbereitet hatte. Hat der Kandidat eine Erfahrung beschrieben, die er nicht formalisiert hatte:

> "Du hast [X] in deiner Antwort erwähnt — das klingt, als könnte daraus eine richtige STAR+R-Story werden. Willst du sie jetzt ausarbeiten, solange sie frisch ist?"

Falls ja, arbeite sie als STAR+R-Story aus (Situation, Task, Action, Result, Reflection) und hänge sie an `interview-prep/story-bank.md` an.

---

## Step 6 — Next Round Intelligence

Wenn der Kandidat das Format der nächsten Runde kennt:

1. **Prognostiziere wahrscheinliche Fragen** basierend auf:
   - Rolle des nächsten Interviewers (z. B. Senior Practitioner → Tiefe im Kern-Skill, Design; funktionsübergreifender Peer → Zusammenarbeit, Domänengrenzen; Executive → Strategie, Business Impact)
   - Was in dieser Runde abgedeckt wurde (die nächste Runde geht üblicherweise tiefer, nicht breiter)
   - Woran der Interviewer dieser Runde am meisten interessiert schien

   Kennzeichne jede Prognose mit `[inferred]` — präsentiere eine prognostizierte Frage nie so, als stamme sie von echten Kandidaten oder Insidern.

2. **Erstelle eine Prioritätenliste** für die Vorbereitung der nächsten Runde — geordnet nach Lückenschwere und Wahrscheinlichkeit, geprüft zu werden

3. **Schlage vor**, `interview/plan` mit den Details der nächsten Runde laufen zu lassen, um einen vollständigen Vorbereitungsplan zu erstellen

---

## Step 7 — Probability Assessment (Optional)

Wenn der Kandidat um eine ehrliche Einschätzung seiner Chancen bittet:

Bewerte basierend auf:
- Anzahl und Schwere der Lücken (🔴 bei Grundlagen = höheres Risiko als 🔴 bei fortgeschrittenen Themen)
- Signalen des Interviewers (konkrete Details zur nächsten Runde gegeben = positiv; vage = neutral; kurzer Call = Risiko)
- Rollen-Fit (Jahre an Erfahrung, Domänen-Match, Standort)
- Differenziatoren (Dinge, die der Kandidat gesagt hat, die die meisten Kandidaten nicht sagen würden)

Sei ehrlich. Eine Wahrscheinlichkeitsspanne mit klarer Begründung ist nützlicher als falsche Zuversicht.

---

## Step 8 — Save Debrief

Hänge an `interview-prep/{company-slug}-{role-slug}.md` an:

```markdown
## Round [N] Debrief — [YYYY-MM-DD]

**Interviewer:** [Name, Rolle]
**Round type:** [screening / technical / design-case-study / behavioral]
**Outcome:** [pending / moved forward / rejected]

### Questions Asked
[Liste]

### Gaps Identified
[Liste mit korrekten Antworten]

### Next Round
**Format:** [falls bekannt]
**Interviewers:** [falls bekannt]
**Priority prep:** [Top 3 Themen, die vor der nächsten Runde zu schließen sind]

### Process Intel (recruiter / HM screens — omit if not applicable)
**Comp discussed:** [ja / nein — falls ja, was gesagt und worauf geankert wurde]
**Timeline:** [genannte Termine oder Deadlines]
**Other candidates:** [falls offengelegt]
**Next steps:** [was der Interviewer als nächsten Schritt genannt hat und bis wann]
```

---

## Step 9 — Write Session Transcript

Schreibe nach dem Debrief außerdem ein maschinenlesbares Session-Transkript nach `interview-prep/sessions/{company-slug}-{role-slug}-{round}-{YYYY-MM-DD}.md`. Dies ist eine strukturierte Aufzeichnung der Runde für nachgelagerte Analysemodi; die mit Sprecher gekennzeichneten Turns lassen einen Konsumenten jede Seite lesen, ohne neu ableiten zu müssen, wer gesprochen hat. Der vollständige Contract liegt in `interview-prep/sessions/README.md`.

Format:

```markdown
---
company: [Unternehmen]
role: [Rolle]
round: [screen | hiring-manager | technical | system-design | behavioral | onsite | final]
date: YYYY-MM-DD
interviewer_role: [Rolle, falls bekannt]
source: debrief
---

## Q1
**Interviewer:** [Frage wie gestellt]
<!-- competency: tag[, tag...] -->
**Candidate:** [Antwort wie gegeben / in diesem Debrief rekonstruiert]

## Q2
...
```

Regeln für das Transkript:

- **Ordne die Rundenart dem Enum** oben zu (z. B. Recruiter Screen → `screen`, HM Screen → `hiring-manager`, technischer Deep-Dive → `technical`, Design/Case Study → `system-design`).
- **Tagge jede Antwort.** In der Zeile direkt über jeder `**Candidate:**`-Zeile gib `<!-- competency: tag[, tag...] -->` aus — lowercase-kebab-case, kommagetrennt bei Antworten mit mehreren Kompetenzen (z. B. `system-design`, `people-leadership`, `incident-response`). Du hast jede Antwort in Step 2 bereits bewertet, also tagge aus dieser Bewertung, statt neu zu lesen. Tags sind frei wählbar; wähle die Kompetenz, die die Frage tatsächlich geprüft hat.
- **Rekonstruiere den Turn des Kandidaten getreu.** Verwende, was der Kandidat in Step 1 als seine Aussage berichtet hat, nicht eine idealisierte Antwort. Die "correct/complete answer" aus Step 2 gehört in die Debrief-Datei, nie ins Transkript — das Transkript hält fest, was passiert ist.
- **`source: debrief`.**
- Die Session-Datei landet in einem gitignorierten Verzeichnis (echte Namen/Unternehmen gelangen nie in die Versionskontrolle); schreibe sie ohne Schwärzung.

---

## Rules

- **Debriefe sofort.** Die Erinnerung an Interviewdetails verblasst schnell — innerhalb von Stunden sind konkrete Fragen und Reaktionen vergessen. Führe dieses Skill am selben Tag aus.
- **Beschönige Lücken nicht.** Eine 🔴-Lücke, die aus Freundlichkeit 🟡 genannt wird, taucht in der nächsten Runde wieder auf.
- **Leg dem Kandidaten nie erfundene Aussagen in den Mund.** Korrekte/vollständige Antworten dürfen auf allgemeinem Fachwissen beruhen, aber jede vorgeschlagene persönliche Aussage oder Kennzahl muss aus dem stammen, was der Kandidat gesagt hat, aus `cv.md`, `article-digest.md` oder der Story Bank.
- **Retracted Claims sind ein hartes Gate.** Wenn eine Aussage in `interview-prep/retracted-claims.md` steht, schlage dem Kandidaten nie vor, sie zu verwenden — selbst wenn er sie im echten Interview gesagt hat. Kennzeichne sie: "Diese Aussage steht auf deiner Retracted-Liste — sie ist unter Druck nicht vertretbar. Hier eine Version, die nicht davon abhängt."
- **Halte neue Retractions fest.** Fördert der Debrief eine Aussage zutage, die der Kandidat im echten Interview verwendet hat und die er nun als nicht vertretbar einräumt, biete an, sie an `interview-prep/retracted-claims.md` anzuhängen: `**"[claim]"** ([context]). Reason: [einzeiliger Grund + korrektes Framing, falls zutreffend].`
- **Extrahiere Vokabellücken ausdrücklich.** Hat der Kandidat einen unpräzisen Begriff verwendet, wo ein präziser existiert, ergänze ihn in `interview-prep/interview-prep-guide.md` im Vokabular-Abschnitt (falls der Kandidat einen pflegt).
- **Eine Lücke = ein Fix.** Überfordere nicht mit einem vollständigen Lernplan für jede Lücke. Priorisiere die 1–2, die in der nächsten Runde am wahrscheinlichsten geprüft werden.
- **Feiere, was funktioniert hat.** Beim Debrief geht es nicht nur um Lücken. Benenne, was stark war — das verstärkt das richtige Verhalten und baut Selbstvertrauen für die nächste Runde auf.
