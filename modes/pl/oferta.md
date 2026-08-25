# Tryb: oferta -- Pełna ocena A-F

Gdy kandydat wkleja ofertę (tekst lub URL), ZAWSZE dostarcz wszystkie 6 bloków.

## Krok 0 -- Wykrycie archetypu

Sklasyfikuj ofertę do jednego z 6 archetypów (zobacz `_shared.md`). Jeśli hybrydowa, wskaż 2 najbliższe. To determinuje:
- Które proof points priorytetyzować w bloku B
- Jak przepisać summary w bloku E
- Które historie STAR przygotować w bloku F

## Blok A -- Podsumowanie roli

Tabela z:
- Wykrytym archetypem
- Domeną (Platform / Agentic / LLMOps / ML / Enterprise)
- Funkcją (Build / Doradztwo / Zarządzanie / Deploy)
- Poziomem seniority
- Remote (Full remote / Hybryda / Na miejscu)
- Wielkością zespołu (jeśli podana)
- TL;DR w 1 zdaniu

## Blok B -- Dopasowanie do CV

Przeczytaj `cv.md`. Stwórz tabelę, w której każde wymaganie z oferty jest zmapowane na dokładne wiersze z CV.

**Dostosowane do archetypu:**
- FDE -> priorytetyzuj proof points szybkiego dostarczania i bliskości klienta
- SA -> priorytetyzuj projektowanie systemów i integracje
- PM -> priorytetyzuj product discovery i metryki
- LLMOps -> priorytetyzuj evals, observability, pipelines
- Agentic -> priorytetyzuj multi-agent, HITL, orkiestrację
- Transformation -> priorytetyzuj zarządzanie zmianą, adopcję, skalowanie

Sekcja **Luki (Gaps)** ze strategią mitygacji dla każdej. Dla każdej luki:
1. Czy to twardy bloker czy nice-to-have?
2. Czy kandydat może wykazać sąsiednie doświadczenie?
3. Czy istnieje projekt portfolio, który pokrywa tę lukę?
4. Konkretny plan mitygacji (zdanie do listu motywacyjnego, szybki mini-projekt itp.)

## Blok C -- Poziom i strategia

1. **Wykryty poziom** w ofercie vs **naturalny poziom kandydata dla tego archetypu**
2. **Plan "sprzedać senior bez kłamstwa"**: konkretne sformułowania dostosowane do archetypu, konkretne osiągnięcia do podkreślenia, jak pozycjonować doświadczenie założycielskie jako atut
3. **Plan "jeśli dostanę downlevel"**: zaakceptować, jeśli wynagrodzenie jest sprawiedliwe, wynegocjować przegląd po 6 miesiącach, jasne kryteria awansu

## Blok D -- Wynagrodzenie i popyt

Użyj WebSearch dla:
- Aktualnych wynagrodzeń dla roli (Glassdoor, Levels.fyi, No Fluff Jobs, Just Join IT, Raport Płacowy Pracuj.pl)
- Reputacji wynagrodzeniowej firmy (Glassdoor, GoWork)
- Trendu popytu na rolę na polskim rynku

Tabela z danymi i cytowanymi źródłami. Jeśli brak danych, powiedz to jasno -- nic nie wymyślaj.

**Polski rynek -- Obowiązkowe weryfikacje:**
- Czy widełki są netto czy brutto? Ustal to zawsze -- to fundament porównania.
- Umowa o pracę (UoP) czy B2B? Jeśli B2B: stawka dzienna/miesięczna, ryzyko fikcyjnego samozatrudnienia, kwestia VAT.
- Część zmienna (premia, prowizja, ESOP / stock options)?
- Trzynastka / premia roczna wspomniana? Uwzględnij w przeliczeniu rocznym.
- ZUS i PPK -- po czyjej stronie składki (zwłaszcza przy B2B)?
- Benefity (prywatna opieka medyczna, karta sportowa) wspomniane? Wlicz w wartość pakietu.

## Blok E -- Plan personalizacji

| # | Sekcja | Stan obecny | Proponowana zmiana | Uzasadnienie |
|---|---------|-------------|--------------------|----- ---------|
| 1 | Summary | ... | ... | ... |
| ... | ... | ... | ... | ... |

Top 5 zmian w CV + Top 5 zmian na LinkedIn, aby zmaksymalizować dopasowanie.

## Blok F -- Plan rozmów kwalifikacyjnych

6-10 historii STAR+R zmapowanych na wymagania oferty (STAR + **Reflection**):

| # | Wymaganie z oferty | Historia STAR+R | S | T | A | R | Reflection |
|---|---------------------|--------------|---|---|---|---|------------|

Kolumna **Reflection** ujmuje, czego się nauczono lub co zrobiono by inaczej. To sygnalizuje seniority -- juniorzy opisują, co się wydarzyło, seniorzy wyciągają z tego wnioski.

**Story Bank:** Jeśli `interview-prep/story-bank.md` istnieje, sprawdź, czy te historie już tam są. Jeśli nie, dodaj nowe. Z czasem buduje to wielokrotnego użytku bank 5-10 historii master, które można dopasować do każdego pytania na rozmowie.

**Wyselekcjonowane i sformowane według archetypu:**
- FDE -> podkreśl szybkość dostarczania i bliskość klienta
- SA -> podkreśl decyzje architektoniczne
- PM -> podkreśl discovery i kompromisy
- LLMOps -> podkreśl metryki, evals, hardening na produkcji
- Agentic -> podkreśl orkiestrację, obsługę błędów, HITL
- Transformation -> podkreśl adopcję i zmianę organizacyjną

Dołącz także:
- 1 rekomendowane case study (który projekt zaprezentować i jak)
- Pytania red-flag i jak na nie odpowiadać (np. "Dlaczego sprzedał Pan swoją firmę?", "Czy miał Pan zespół pod sobą?", "Dlaczego zmiana po tak krótkim czasie?")

---

## Po ocenie

**ZAWSZE** wykonaj po blokach A-F:

### 1. Zapisz report .md

Zapisz pełną ocenę w `reports/{###}-{company-slug}-{YYYY-MM-DD}.md`.

- `{###}` = następny kolejny numer (3 cyfry, dopełnione zerami). Aby przydzielić go atomowo i uniknąć race conditions, musisz uruchomić `node reserve-report-num.mjs`, by zarezerwować numer (stdout zwraca `{###}`), zapisać report, a następnie uruchomić `node reserve-report-num.mjs --release {###}`, by zwolnić sentinel.
- `{company-slug}` = nazwa firmy małymi literami, bez spacji (użyj myślników)
- `{YYYY-MM-DD}` = dzisiejsza data

**Format reportu:**

```markdown
# Ocena: {Firma} -- {Rola}

**Data:** {YYYY-MM-DD}
**Archetyp:** {wykryty}
**Score:** {X/5}
**URL:** {URL oferty}
**PDF:** {ścieżka lub w toku}

---

## A) Podsumowanie roli
(pełna zawartość bloku A)

## B) Dopasowanie do CV
(pełna zawartość bloku B)

## C) Poziom i strategia
(pełna zawartość bloku C)

## D) Wynagrodzenie i popyt
(pełna zawartość bloku D)

## E) Plan personalizacji
(pełna zawartość bloku E)

## F) Plan rozmów kwalifikacyjnych
(pełna zawartość bloku F)

## G) Szkice odpowiedzi do aplikacji
(tylko jeśli score >= 4.5 -- szkice odpowiedzi do formularza aplikacyjnego)

---

## Wyekstrahowane słowa kluczowe
(lista 15-20 słów kluczowych z oferty do optymalizacji ATS)
```

### 2. Zapisz w trackerze

**ZAWSZE** zapisz w `data/applications.md`:
- Następny kolejny numer
- Dzisiejsza data
- Firma
- Rola
- Score: średnia dopasowania (1-5)
- Status: `Evaluated`
- PDF: nie (lub tak, jeśli auto-pipeline wygenerował PDF)
- Report: względny link do pliku reportu (np. `[001](reports/001-company-2026-01-01.md)`)

**Format trackera:**

```markdown
| # | Data | Firma | Rola | Score | Status | PDF | Report |
```
