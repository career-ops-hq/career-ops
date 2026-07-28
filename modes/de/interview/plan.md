# Mode: interview/plan — Interview-Vorbereitungsplaner

Erstelle aus einer Stellenanzeige und einem Interviewtermin einen strukturierten, in Zeitblöcke gegliederten Vorbereitungsplan, der auf die konkreten Lücken des Kandidaten zugeschnitten ist.

---

## Inputs

1. **Stellenanzeige** (erforderlich) — inline einfügen oder URL angeben
2. **Datum und Uhrzeit des Interviews** (erforderlich) — um die verfügbaren Stunden zu berechnen
3. **Name und Rolle des Interviewers** (falls bekannt) — bestimmt Tiefe und Ton der Vorbereitung
4. **Art der Runde** (falls bekannt) — Screening, technisch/fachspezifisch, Design/Case Study, Behavioral Panel
5. **Lebenslauf** unter `cv.md` + `article-digest.md` (falls vorhanden) — für Erfahrung, Skills, Proof Points lesen
6. **Profil** unter `config/profile.yml` + `modes/_profile.md` — für Narrativ, Archetypen und Ziele lesen
7. **Story Bank** unter `interview-prep/story-bank.md` — vorhandene STAR+R-Stories
8. **Question Bank** unter `interview-prep/question-bank.md` — bestehende Lücken (falls die Datei existiert)

---

## Step 1 — Fit Assessment

Lies den Lebenslauf und die Stellenanzeige. Erstelle eine Bewertung in zwei Spalten:

**Stärken, an denen man ansetzt:** Erfahrung, Titel, Domäne, Proof Points, die direkt zur Stellenanzeige passen.

**Zu schließende Lücken:** Skills, Tools oder Erfahrungen, die in der Stellenanzeige genannt werden, aber im Lebenslauf fehlen oder schwach sind. Nach der Wahrscheinlichkeit ordnen, dass sie in genau dieser Rundenart geprüft werden.

Sei ehrlich. Eine Lücke ist eine Lücke — kennzeichne sie klar, damit die Vorbereitungszeit an die richtigen Stellen fließt.

---

## Step 2 — Round Intelligence

Bestimme, was diese Runde tatsächlich bewertet, basierend auf:
- Rolle des Interviewers (Manager = Kommunikation + Leidenschaft + Grundlagen; Praktiker = Tiefe + Urteilsvermögen)
- Bezeichnung der Runde (Screening, technisch/Domäne, Design/Case Study, Final)
- Signalen aus der Stellenanzeige (was sie betonen)

**Recruiter Screen:**
- Abhaken: Passung, Gehaltsabgleich, Logistik, Kommunikation
- Kein technischer Test — Tiefenfragen kommen im HM-Gespräch und in späteren Runden
- Wahrscheinlich: Kurzvorstellung des Werdegangs, "Warum wir / warum diese Rolle", Gehaltsvorstellung, Zeitplan, eine logistische Frage
- Behandle dies als den einfachen Checkpoint; nutze die Vorbereitungszeit, um das Fundament für das Folgende zu bauen

**Hiring-Manager Screen:**
- Kommunikation, Leidenschaft, Passung — dazu Führungsphilosophie und Urteilsvermögen
- Grundlagen des Kern-Skills aus der Stellenanzeige — keine tiefen Interna
- 1–2 Behavioral-Stories
- Wahrscheinlich: Werdegang, "Warum wir", ein Kernkonzept aus der Stellenanzeige, eine Führungs-Story, eine vorausschauende Situationsfrage

**Technical / domain deep-dive with a practitioner:**
- Tiefe im Kern-Skill aus der Stellenanzeige (z. B. Runtime-Interna im Engineering, Modellierungsentscheidungen bei Data, Bewertungsmethoden in der Finanzwelt)
- Angewandte Szenarien aus dem Tagesgeschäft der Rolle
- Live-Übung oder durchgearbeitetes Walkthrough möglich
- Stories dienen als Beleg, nicht als Hauptereignis

**Design / case study panel:**
- Vollständige Lösung — Constraints, Komponenten, Trade-offs, Fehlermodi
- Die Qualitätsdimensionen, die die Stellenanzeige betont (z. B. Skalierbarkeit, Compliance, Messbarkeit)
- Senior-Level: Constraints setzen, klärende Fragen stellen, das Gespräch führen

Kalibriere den Plan auf die Runde. Für ein Screening zu viel Tiefe vorzubereiten verschwendet Zeit und erzeugt die falsche Denkhaltung.

---

## Step 3 — Build the Time-Blocked Plan

Berechne die verfügbaren Stunden von jetzt bis zum Interviewzeitpunkt. Teile sie in Blöcke auf:

Bevor du die Blöcke dimensionierst, prüfe `interview-prep/question-bank.md` (falls vorhanden). Jede aus einer früheren Runde mit 🔴 markierte Frage ist eine erwiesene Lücke — sie bekommt einen eigenen Block, unabhängig davon, wie die CV-vs-JD-Analyse sie einordnet. Reale Performance-Daten schlagen abgeleitetes Risiko.

**Vorlage (passe die Blockgrößen an die insgesamt verfügbaren Stunden an):**

```
Block 1 — Lege dein Narrativ fest (immer zuerst)
  - Schreibe die Chronologie deines Werdegangs explizit auf
  - Bereite "Warum dieses Unternehmen" mit einem konkreten Bezug zu deiner Geschichte vor
  - Bereite deine stärkste Proof-Point-Story vor (30-Sekunden-Version)
  - Zeit: ~15% der verfügbaren Stunden

Block 2 — Vorrangiges Fachthema (höchstes Lückenrisiko zuerst)
  - Ein Thema pro Block — nicht vermischen
  - Für jedes: Konzept → dein Story-Anknüpfungspunkt → wahrscheinliche Folgefragen
  - Zeit: ~25% der verfügbaren Stunden

Block 3 — Sekundäres Fachthema
  - Lücke mit dem zweithöchsten Risiko
  - Zeit: ~20% der verfügbaren Stunden

Block 4 — Behavioral-Stories
  - Ordne vorhandene Stories den wahrscheinlichen Fragetypen zu
  - Übe die 2-minütige mündliche Version jeder Story
  - Bereite die Reflection für jede vor — das Unterscheidungsmerkmal des Senior-Kandidaten
  - Zeit: ~15% der verfügbaren Stunden

Block 5 — Unternehmensrecherche
  - Für die Rolle relevante Produktseiten
  - Verbindung zwischen deiner Geschichte und ihrer spezifischen Domäne
  - 3–4 pointierte Fragen, die du ihnen stellst
  - Zeit: ~10% der verfügbaren Stunden

Block 6 — Probelauf (falls die Zeit reicht)
  - Eine Frage pro wahrscheinlichem Thema — laut, auf Zeit
  - Zeit: ~10% der verfügbaren Stunden

Block 7 — Puffer + Erholung
  - Höre 60–90 Minuten vor dem Interview auf zu lernen
  - Pauken in der letzten Stunde bringt Rauschen, kein Signal
  - Zeit: übrige
```

Passe die Blockgrößen an die Schwere der Lücken und die Rundenart an. Bei einem Screening sind Block 4 (Behavioral) und Block 5 (Unternehmensrecherche) wichtiger als tiefe Fachblöcke.

---

## Step 4 — Priority Quick-Reference

Erstelle am Ende des Plans eine einseitige Kurzreferenz, die der Kandidat 15 Minuten vor dem Interview überfliegen kann:

```markdown
## 15-Minute Pre-Interview Review

**Your anchor sentence:** [ein Satz, der erfasst, warum du der Richtige für diese Rolle bist]

**Top 3 things to remember:**
1. [wichtigste Botschaft, die du beim Interviewer hinterlassen willst]
2. [wahrscheinlichste Frage und der erste Satz deiner Antwort]
3. [die Verbindung zwischen deiner Geschichte und ihrer Domäne]

**Your questions to ask:**
1. [Frage 1]
2. [Frage 2]
3. [Frage 3]
```

---

## Step 5 — Save Output

Speichere den Plan unter `interview-prep/{company-slug}-{role-slug}.md`, falls keine Datei existiert, oder hänge einen `## Prep Plan`-Abschnitt an, falls doch.

---

## Rules

- **Kalibriere auf die Runde.** Ein Vorbereitungsplan für ein Screening sieht ganz anders aus als einer für ein Design-Panel. Setze nicht standardmäßig für jedes Interview maximale Tiefe an.
- **Lücken zuerst.** Zeit ist endlich. Die Stärken des Kandidaten brauchen keine Vorbereitung — seine Lücken schon.
- **🔴-Lücken aus der Question Bank haben Vorrang vor abgeleiteten Lücken.** Reale Performance-Daten schlagen die CV-vs-JD-Analyse. Wenn der Kandidat bereits weiß, dass er sich mit einem Thema schwertut, vergrabe es nicht.
- **Ein Thema pro Block.** Themen in einem einzigen Block zu mischen senkt die Behaltensleistung.
- **Plane immer Erholungszeit ein.** Ein ausgeruhter Kandidat schneidet besser ab als einer, der bis zuletzt paukt.
- **Erfinde niemals falsche Unternehmensinfos.** Wenn du keine Recherche hast, sag es — erfinde keine Kulturaussagen oder technischen Details über das Unternehmen.
- **Erfinde niemals Aussagen für den Kandidaten.** Der Anchor Sentence und die Talking Points vor dem Interview in der Kurzreferenz (Step 4) müssen auf dem beruhen, was der Kandidat tatsächlich hat — `cv.md`, `article-digest.md` oder die Story Bank. Formuliere keine Aussagen, die von Erfahrung oder Kennzahlen abhängen, die der Kandidat nicht hat. Wenn eine Aussage in `interview-prep/retracted-claims.md` steht, nimm sie niemals auf.
