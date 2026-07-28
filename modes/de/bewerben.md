# Modus: bewerben — Live-Assistent fürs Bewerbungsformular

Interaktiver Modus für den Moment, in dem der Kandidat in Chrome ein Bewerbungsformular ausfüllt. Liest, was auf dem Bildschirm steht, lädt den Kontext der vorherigen Bewertung der Stellenanzeige und erzeugt passgenaue Antworten für jede Frage des Formulars.

## Voraussetzungen

- **Empfohlen mit sichtbarem Playwright**: Im sichtbaren Modus sieht der Kandidat den Browser, und Claude kann mit der Seite interagieren.
- **Ohne Playwright**: Der Kandidat teilt einen Screenshot oder fügt die Fragen manuell ein.

## Workflow

```
1. ERKENNEN     → aktiven Chrome-Tab lesen (Screenshot / URL / Titel)
2. IDENTIFIZIEREN → Firma + Rolle aus der Seite extrahieren
3. SUCHEN       → mit bestehenden Reports unter reports/ abgleichen
4. LADEN        → vollständigen Report lesen + Block G (falls vorhanden)
5. VERGLEICHEN  → Stimmt die Rolle auf dem Bildschirm mit der bewerteten überein? Wenn sie sich geändert hat → warnen
6. ANALYSIEREN  → ALLE sichtbaren Fragen des Formulars identifizieren
7. ERZEUGEN     → Für jede Frage eine passgenaue Antwort generieren
8. PRÄSENTIEREN → Antworten formatiert zum Copy-Paste ausgeben
```

## Schritt 1 — Stellenanzeige erkennen

**Mit Playwright:** Snapshot der aktiven Seite. Titel, URL und sichtbaren Inhalt lesen.

**Ohne Playwright:** Den Kandidaten bitten, eines der folgenden zu tun:
- Einen Screenshot des Formulars teilen (das Read-Tool kann Bilder lesen)
- Die Fragen des Formulars als Text einfügen
- Firma + Rolle nennen, damit wir den Kontext suchen können

## Schritt 2 — Identifizieren und Kontext laden

1. Firmennamen und Rollentitel von der Seite extrahieren
2. In `reports/` per Grep (case-insensitive) nach dem Firmennamen suchen
3. Bei Treffer → vollständigen Report laden
4. Wenn Block G vorhanden ist → die früheren Draft-Antworten als Basis laden
5. Wenn KEIN Treffer → den Kandidaten warnen und eine schnelle Auto-Pipeline anbieten

## Schritt 3 — Änderungen an der Rolle erkennen

Wenn die Rolle auf dem Bildschirm von der bewerteten abweicht:
- **Den Kandidaten warnen**: "Die Rolle hat sich von [X] zu [Y] geändert. Soll ich neu bewerten oder die Antworten an den neuen Titel anpassen?"
- **Wenn anpassen**: Antworten ohne Neu-Bewertung an den neuen Titel angleichen
- **Wenn neu bewerten**: vollständige A-F-Bewertung durchführen, Report aktualisieren, Block G neu erzeugen
- **Tracker aktualisieren**: in `applications.md` den Rollentitel anpassen, falls nötig

## Schritt 4 — Fragen des Formulars analysieren

ALLE sichtbaren Fragen identifizieren:
- Freitextfelder (Anschreiben, "Warum diese Rolle", Motivation, etc.)
- Dropdowns (Wie haben Sie von uns erfahren, Arbeitserlaubnis, etc.)
- Ja/Nein (Umzug, Visum, Verfügbarkeit, etc.)
- Gehaltsfelder (Spanne, Gehaltsvorstellung — in Brutto-Jahresgehalt für DE)
- Upload-Felder (Lebenslauf, Anschreiben als PDF, Zeugnisse)

Jede Frage klassifizieren:
- **Bereits in Block G beantwortet** → bestehende Antwort übernehmen
- **Neue Frage** → Antwort aus dem Report + `cv.md` generieren

## Schritt 5 — Antworten erzeugen

Für jede Frage die Antwort nach folgendem Schema bauen:

1. **Kontext aus dem Report**: Proof Points aus Block B, STAR-Stories aus Block F nutzen
2. **Vorheriger Block G**: Wenn ein Draft existiert, als Basis nehmen und nachschärfen
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
1. Status mit dem kanonischen CLI auf "Applied" setzen: `node set-status.mjs <report#> Applied` (die Tabelle in `applications.md` nie von Hand editieren)
2. Block G im Report mit den finalen Antworten aktualisieren
3. Nächsten Schritt vorschlagen: `/career-ops contacto` für LinkedIn-Outreach an den Personalleiter / Hiring Manager

## Scroll-Handling

Wenn das Formular mehr Fragen hat als sichtbar:
- Den Kandidaten bitten, zu scrollen und einen weiteren Screenshot zu teilen
- Oder die restlichen Fragen einzufügen
- In Iterationen verarbeiten, bis das ganze Formular abgedeckt ist
