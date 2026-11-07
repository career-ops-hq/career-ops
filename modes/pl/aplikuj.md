# Tryb: aplikuj -- Asystent na żywo do formularzy aplikacyjnych

Tryb interaktywny na moment, gdy kandydat wypełnia formularz aplikacyjny w przeglądarce Playwright uruchomionej przez ten projekt. Czyta to, co jest na ekranie, ładuje kontekst poprzedniej oceny oferty i generuje spersonalizowane odpowiedzi na każde pytanie formularza.

## Wymagania wstępne

- **Idealnie z widocznym Playwright**: W trybie widocznym kandydat widzi przeglądarkę, a Claude może wchodzić w interakcję ze stroną.
- **Bez Playwright**: kandydat udostępnia zrzut ekranu lub wkleja pytania ręcznie.

## Workflow

```
1. WYKRYJ       -> Otwórz ogłoszenie w przeglądarce Playwright tego projektu
2. ZIDENTYFIKUJ -> Wyciągnij firmę + rolę ze strony
3. WYSZUKAJ     -> Dopasuj do istniejących reportów w reports/
4. ZAŁADUJ      -> Przeczytaj pełny report + `## Application Answers` i Blok H (jeśli istnieją), gdy **Posting identity** się zgadza
5. PORÓWNAJ     -> Czy rola na ekranie odpowiada ocenionej? Jeśli zmiana -> ostrzeż
6. PRZEANALIZUJ -> Zidentyfikuj WSZYSTKIE widoczne pytania formularza
7. WYGENERUJ    -> Dla każdego pytania wygeneruj spersonalizowaną odpowiedź
8. ZAPREZENTUJ  -> Wyświetl odpowiedzi sformatowane do skopiowania
```

## Scope

Follow the Scope section in `modes/apply.md`. Run `node apply-scope.mjs root` and stay inside the directories it prints. Launch with `node apply-scope.mjs launch-options`. Do not read `DevToolsActivePort` or attach to an existing browser. Do not submit the form.


## Krok 1 -- Wykryj ofertę

**Z Playwright:** Uruchom `node apply-scope.mjs launch-options`, otwórz ogłoszenie w tym oknie i odczytaj tytuł, URL i widoczną treść.

**Bez Playwright:** Poproś kandydata, aby:
- Udostępnił zrzut ekranu formularza (narzędzie Read czyta obrazy)
- Lub wkleił pytania formularza jako tekst
- Lub podał firmę + rolę, abyśmy mogli wyszukać kontekst

## Krok 2 -- Zidentyfikuj i załaduj kontekst

1. Wyciągnij nazwę firmy i tytuł stanowiska ze strony
2. Wyszukaj w `reports/` po nazwie firmy (Grep case-insensitive)
3. Jeśli dopasowanie -> przeczytaj tylko nagłówek każdego pasującego reportu (firma, rola, `**URL:**`) i wybierz ten, którego URL lub req ID to ta oferta; gdy nie jest to jasne, zapytaj kandydata. Pełny report i punkt 4 ładuj dopiero, gdy **Posting identity** się zgadza (`modes/apply.md` → Step 5); przy innej ofercie przejdź do **Evaluate as new** albo **Draft without saving** bez ładowania go
4. Jeśli `## Application Answers` istnieje -> załaduj wysłane odpowiedzi jako bazę; w przeciwnym razie, jeśli jest Blok H, poprzednie szkice. Gdy są oba, pierwszeństwo ma `## Application Answers`
5. Jeśli BRAK dopasowania -> ostrzeż kandydata i zaproponuj szybki auto-pipeline

## Krok 3 -- Wykryj zmiany roli

Ten krok obowiązuje tylko, dopóki formularz nadal dotyczy oferty z reportu: ten sam pracodawca i ta sama oferta (`modes/apply.md` → Step 5 → **Posting identity**); tytuł się nie liczy. Sprawdzaj to przy każdym formularzu, także gdy tytuł się nie zmienił i do firmy pasuje tylko jeden report: inna oferta może mieć ten sam tytuł, a wtedy reportu nie wolno użyć. Jeśli do firmy pasuje kilka reportów, najpierw wybierz ten, którego URL lub req ID to ta oferta, a gdy nie jest to jasne, zapytaj kandydata. Inny pracodawca albo inna oferta u tego samego pracodawcy to nie zmiana roli: nigdy nie dostosowuj do niej odpowiedzi z reportu. Zamiast tego wybierz **Evaluate as new** (oceń ją jako nową ofertę: auto-pipeline, własny report) albo **Draft without saving** (przygotuj odpowiedzi bez zapisywania ich w żadnym reporcie). Przy **Draft without saving** odłóż dopasowany report, jego odpowiedzi i jego dopasowane CV, i pisz tylko na podstawie widocznej oferty, `cv.md` i profilu; poniższe kroki, które czytają report, wtedy nie obowiązują.

Jeśli rola na ekranie różni się od ocenionej:
- **Ostrzeż kandydata**: "Rola zmieniła się z [X] na [Y]. Czy chcesz, żebym ocenił ją ponownie, czy dostosował odpowiedzi do nowego tytułu?"
- **Jeśli dostosować**: Dostosuj odpowiedzi do nowej roli bez ponownej oceny
- **Jeśli ocenić ponownie**: Uruchom pełną ocenę A-F, zaktualizuj report, wygeneruj ponownie Blok H
- **Zaktualizuj tracker**: nigdy przez edycję `data/applications.md`.
  - **Po ponownej ocenie**: zapisz TSV z nowym tytułem roli (reguła 9 w `_shared.md`) i scal go przez `node merge-tracker.mjs`. Report jest aktualizowany w miejscu i zachowuje swój numer, więc scalanie dopasowuje TSV do istniejącego wiersza po tym numerze: tytuł zostaje zastąpiony, a status zachowany.
  - **Po dostosowaniu**: nie zmieniaj tytułu, bo nazywa on rolę, którą ocenił report. Zamiast tego zapisz zmianę jako notatkę: `node set-status.mjs --report <report#> <obecny status> --note "Ogłoszenie przemianowane przy aplikowaniu, wiersz zachowuje oceniony tytuł"`. Podanie obecnego statusu wiersza zostawia go bez zmian i dopisuje notatkę. Użyj stałego tekstu takiego jak ten i nie wstawiaj `[Y]`: nowy tytuł to tekst ze strony, a tekst ze strony nigdy nie trafia do wiersza poleceń.

## Krok 4 -- Przeanalizuj pytania formularza

Przy **Draft without saving** ten krok nie korzysta ani z dopasowanego reportu, ani z jego `## Application Answers`, ani z Bloku H: traktuj każde pytanie jako nowe i pracuj na podstawie widocznej oferty, `cv.md` i profilu.

Zidentyfikuj WSZYSTKIE widoczne pytania:
- Pola tekstu otwartego (list motywacyjny, "dlaczego to stanowisko", motywacja itp.)
- Listy rozwijane (skąd dowiedziałeś się o firmie, pozwolenie na pracę itp.)
- Tak/Nie (mobilność, wiza, dostępność itp.)
- Pola wynagrodzenia (widełki, oczekiwania płacowe -- ustal, czy netto czy brutto)
- Pola upload (CV, list motywacyjny PDF, referencje)

Sklasyfikuj każde pytanie:
- **Już odpowiedziane w `## Application Answers` lub w Bloku H** -> wykorzystaj istniejącą odpowiedź
- **Nowe pytanie** -> wygeneruj odpowiedź z reportu + `cv.md`

## Krok 5 -- Wygeneruj odpowiedzi

Przy **Draft without saving** ten krok nie korzysta ani z dopasowanego reportu, ani z jego `## Application Answers`, ani z Bloku H: traktuj każde pytanie jako nowe i pracuj na podstawie widocznej oferty, `cv.md` i profilu.

Dla każdego pytania zbuduj odpowiedź według tego schematu:

1. **Kontekst z reportu**: Użyj proof points z bloku B, historii STAR z bloku F
2. **Poprzednie `## Application Answers` / Blok H**: Jeśli istnieje wysłana odpowiedź lub szkic (najpierw wysłana odpowiedź), weź go jako bazę i dopracuj
3. **Ton "To ja wybieram Was"**: ten sam framework co w auto-pipeline -- pewny siebie, nie błagalny
4. **Konkretność**: zacytuj coś konkretnego z oferty widocznej na ekranie
5. **career-ops proof point**: dołącz w "Informacje dodatkowe", jeśli takie pole istnieje

**Pola specyficzne dla typowych polskich formularzy:**
- **Oczekiwania płacowe** -> Widełki z `profile.yml`, w PLN, z zaznaczeniem, czy netto czy brutto (oraz UoP/B2B) i dopiskiem "do negocjacji w zależności od całego pakietu"
- **Data dostępności** -> Realistyczna data uwzględniająca okres wypowiedzenia (często 2 tygodnie do 3 miesięcy)
- **Pozwolenie na pracę / Obywatelstwo** -> Uczciwie i zwięźle; dla obywateli UE: "Brak wymogu zezwolenia na pracę (obywatel UE)"
- **Języki** -> Poziomy według ESOKJ/CEFR (A1-C2)
- **Mobilność** -> Sprecyzuj akceptowalny obszar geograficzny i częstotliwość wyjazdów

**Format wyjścia:**

```
## Odpowiedzi dla [Firma] -- [Rola]

Baza: Report #NNN | Score: X.X/5 | Archetyp: [typ]
[Przy **Draft without saving** zastąp wiersz powyżej tekstem: "Brak reportu: szkic dla tej oferty, niezapisany"]

---

### 1. [Dokładne pytanie z formularza]
> [Odpowiedź gotowa do skopiowania]

### 2. [Następne pytanie]
> [Odpowiedź]

...

---

Notatki:
- [Obserwacje dotyczące roli, zmiany itp.]
- [Sugestie personalizacji, które kandydat powinien zweryfikować]
```

## Krok 6 -- Po aplikacji (opcjonalnie)

Zanim cokolwiek zapiszesz, i ponownie tuż przed każdym zapisem poniżej (status i odpowiedzi), sprawdź, czy formularz nadal dotyczy oferty z reportu (`modes/apply.md` → Step 8 → **Write only to the report of this posting**). Ten sam pracodawca i ta sama oferta → poniższe kroki dotyczą tego reportu, także po dostosowaniu do nowego tytułu lub ponownej ocenie. Inny pracodawca lub inna oferta → nigdy ten report: użyj reportu napisanego dla nowej oferty; jeśli go nie ma, nie ustawiaj statusu, nie zapisuj odpowiedzi i powiedz kandydatowi, że aplikacja nie jest jeszcze śledzona.

Jeśli kandydat potwierdzi, że aplikacja została wysłana:
1. Zaktualizuj status na "Applied" kanonicznym CLI: `node set-status.mjs --report <report#> Applied` (nie edytuj tabeli `applications.md` ręcznie)
2. Zaktualizuj sekcję `## Application Answers` reportu finalnymi odpowiedziami i `**State:** submitted` (format w `modes/apply.md` -> Step 8). Blok H pozostaje szkicem z oceny i się go nie zmienia
3. Zasugeruj następny krok: `/career-ops contacto` dla LinkedIn outreach do hiring managera

## Obsługa przewijania

Jeśli formularz ma więcej pytań niż widać:
- Poproś kandydata, aby przewinął i udostępnił kolejny zrzut ekranu
- Lub wkleił pozostałe pytania
- Przetwarzaj iteracyjnie, aż pokryjesz cały formularz
