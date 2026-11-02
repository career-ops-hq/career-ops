# Modus: bewerben — Live-Assistent fürs Bewerbungsformular

Interaktiver Modus für den Moment, in dem der Kandidat ein Bewerbungsformular in dem Playwright-Browser ausfüllt, den dieses Projekt startet. Liest, was auf dem Bildschirm steht, lädt den Kontext der vorherigen Bewertung der Stellenanzeige und erzeugt passgenaue Antworten für jede Frage des Formulars.

## Voraussetzungen

- **Empfohlen mit sichtbarem Playwright**: Im sichtbaren Modus sieht der Kandidat den Browser, und Claude kann mit der Seite interagieren.
- **Ohne Playwright**: Der Kandidat teilt einen Screenshot oder fügt die Fragen manuell ein.

## Workflow

```
1. ERKENNEN     → Stellenanzeige in der Playwright-Sitzung dieses Projekts öffnen
2. IDENTIFIZIEREN → Firma + Rolle aus der Seite extrahieren
3. SUCHEN       → mit bestehenden Reports unter reports/ abgleichen
4. LADEN        → vollständigen Report lesen + `## Application Answers` und Block H (falls vorhanden)
5. VERGLEICHEN  → Stimmt die Rolle auf dem Bildschirm mit der bewerteten überein? Wenn sie sich geändert hat → warnen
6. ANALYSIEREN  → ALLE sichtbaren Fragen des Formulars identifizieren
7. ERZEUGEN     → Für jede Frage eine passgenaue Antwort generieren
8. PRÄSENTIEREN → Antworten formatiert zum Copy-Paste ausgeben
```

## Scope

Follow the Scope section in `modes/apply.md`. Run `node apply-scope.mjs root` and stay inside the directories it prints. Launch with `node apply-scope.mjs launch-options`. Do not read `DevToolsActivePort` or attach to an existing browser. Do not submit the form.


## Schritt 1 — Stellenanzeige erkennen

**Mit Playwright:** `node apply-scope.mjs launch-options` ausführen, die Stellenanzeige in diesem Fenster öffnen und Titel, URL und sichtbaren Inhalt lesen.

**Ohne Playwright:** Den Kandidaten bitten, eines der folgenden zu tun:
- Einen Screenshot des Formulars teilen (das Read-Tool kann Bilder lesen)
- Die Fragen des Formulars als Text einfügen
- Firma + Rolle nennen, damit wir den Kontext suchen können

## Schritt 2 — Identifizieren und Kontext laden

1. Firmennamen und Rollentitel von der Seite extrahieren
2. In `reports/` per Grep (case-insensitive) nach dem Firmennamen suchen
3. Bei Treffer → vollständigen Report laden
4. Wenn `## Application Answers` vorhanden ist → die abgeschickten Antworten als Basis laden; sonst, wenn Block H vorhanden ist, die früheren Draft-Antworten. Gibt es beide, hat `## Application Answers` Vorrang
5. Wenn KEIN Treffer → den Kandidaten warnen und eine schnelle Auto-Pipeline anbieten

## Schritt 3 — Änderungen an der Rolle erkennen

Wenn die Rolle auf dem Bildschirm von der bewerteten abweicht:
- **Den Kandidaten warnen**: "Die Rolle hat sich von [X] zu [Y] geändert. Soll ich neu bewerten oder die Antworten an den neuen Titel anpassen?"
- **Wenn anpassen**: Antworten ohne Neu-Bewertung an den neuen Titel angleichen
- **Wenn neu bewerten**: vollständige A-F-Bewertung durchführen, Report aktualisieren, Block H neu erzeugen
- **Tracker aktualisieren**: nie durch Editieren von `data/applications.md`.
  - **Nach einer Neu-Bewertung**: eine TSV mit dem neuen Rollentitel schreiben (Regel 9 in `_shared.md`) und mit `node merge-tracker.mjs` zusammenführen. Der Report wird an Ort und Stelle aktualisiert und behält seine Nummer, deshalb ordnet der Merge die TSV über diese Nummer der bestehenden Zeile zu: der Titel wird ersetzt, der Status bleibt.
  - **Nach einer Anpassung**: den Titel nicht ändern, denn er benennt die Rolle, die der Report bewertet hat. Die Umbenennung stattdessen als Notiz festhalten: `node set-status.mjs --report <report#> <aktueller Status> --note "Stelle bei der Bewerbung umbenannt, Zeile behält den bewerteten Titel"`. Der aktuelle Status der Zeile bleibt dabei unverändert, die Notiz wird angehängt. Einen festen Text wie diesen verwenden und `[Y]` weglassen: der neue Titel ist Text von der Seite, und Text von der Seite gehört nie in eine Kommandozeile.

## Schritt 4 — Fragen des Formulars analysieren

ALLE sichtbaren Fragen identifizieren:
- Freitextfelder (Anschreiben, "Warum diese Rolle", Motivation, etc.)
- Dropdowns (Wie haben Sie von uns erfahren, Arbeitserlaubnis, etc.)
- Ja/Nein (Umzug, Visum, Verfügbarkeit, etc.)
- Gehaltsfelder (Spanne, Gehaltsvorstellung — in Brutto-Jahresgehalt für DE)
- Upload-Felder (Lebenslauf, Anschreiben als PDF, Zeugnisse)

Jede Frage klassifizieren:
- **Bereits in `## Application Answers` oder Block H beantwortet** → bestehende Antwort übernehmen
- **Neue Frage** → Antwort aus dem Report + `cv.md` generieren

## Schritt 5 — Antworten erzeugen

Für jede Frage die Antwort nach folgendem Schema bauen:

1. **Kontext aus dem Report**: Proof Points aus Block B, STAR-Stories aus Block F nutzen
2. **Vorherige `## Application Answers` / Block H**: Wenn eine abgeschickte Antwort oder ein Draft existiert (abgeschickte Antwort zuerst), als Basis nehmen und nachschärfen
3. **Ton "Ich entscheide mich für euch"**: gleiches Framework wie in der Auto-Pipeline — selbstbewusst, nicht bittend
4. **Spezifität**: etwas Konkretes aus der sichtbaren Stellenanzeige zitieren
5. **career-ops Proof Point**: in "Zusätzliche Informationen" einbauen, falls ein solches Feld existiert

**Spezielle deutsche Formularfelder, die häufig auftauchen:**
- **Gehaltsvorstellung (brutto, jährlich)** → Spanne aus `profile.yml`, in EUR, mit Hinweis "verhandelbar je nach Gesamtpaket"
- **Eintrittsdatum / Verfügbarkeit** → Realistisches Datum unter Berücksichtigung der Kündigungsfrist (oft 1-3 Monate)
- **Arbeitserlaubnis / Aufenthaltsstatus** → ehrlich und knapp; bei EU-Bürgern explizit "Keine Arbeitserlaubnis erforderlich (EU-Bürger:in)"
- **Sprachkenntnisse** → Deutsch / Englisch nach GER-Niveau (A1-C2) angeben
- **Anrede** → bei deutschen Formularen oft Pflichtfeld (Herr / Frau / Divers / Keine)

**Output-Format:**

```
## Antworten für [Firma] — [Rolle]

Basis: Report #NNN | Score: X.X/5 | Archetyp: [Typ]

---

### 1. [Exakte Frage aus dem Formular]
> [Antwort, fertig zum Kopieren]

### 2. [Nächste Frage]
> [Antwort]

...

---

Hinweise:
- [Beobachtungen zur Rolle, Änderungen, etc.]
- [Personalisierungs-Vorschläge, die der Kandidat nochmal prüfen sollte]
```

## Schritt 6 — Nach dem Absenden (optional)

Wenn der Kandidat bestätigt, dass die Bewerbung raus ist:
1. Status mit dem kanonischen CLI auf "Applied" setzen: `node set-status.mjs --report <report#> Applied` (die Tabelle in `applications.md` nie von Hand editieren)
2. Den Abschnitt `## Application Answers` im Report mit den finalen Antworten und `**State:** submitted` aktualisieren (Format in `modes/apply.md` → Step 8). Block H bleibt der Entwurf der Bewertung und wird nicht geändert
3. Nächsten Schritt vorschlagen: `/career-ops contacto` für LinkedIn-Outreach an den Personalleiter / Hiring Manager

## Scroll-Handling

Wenn das Formular mehr Fragen hat als sichtbar:
- Den Kandidaten bitten, zu scrollen und einen weiteren Screenshot zu teilen
- Oder die restlichen Fragen einzufügen
- In Iterationen verarbeiten, bis das ganze Formular abgedeckt ist
