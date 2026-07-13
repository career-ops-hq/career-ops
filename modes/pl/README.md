# career-ops -- Tryby polskie (`modes/pl/`)

Ten folder zawiera polskie tłumaczenia głównych trybów career-ops dla kandydatów celujących w polski rynek pracy (Polska oraz polskojęzyczne zespoły).

## Kiedy używać tych trybów?

Użyj `modes/pl/`, jeśli spełniony jest co najmniej jeden z poniższych warunków:

- Aplikujesz głównie na **ogłoszenia o pracę po polsku** (Pracuj.pl, No Fluff Jobs, Just Join IT, LinkedIn PL, Bulldogjob, strony karierowe firm)
- Twoje **CV jest po polsku** albo przełączasz się między PL i EN w zależności od ogłoszenia
- Potrzebujesz odpowiedzi i listów motywacyjnych w **naturalnym, technicznym języku polskim**, a nie tłumaczonym maszynowo
- Musisz ogarnąć **specyfikę umów na polskim rynku**: umowa o pracę (UoP), B2B, umowa zlecenie, okres próbny, okres wypowiedzenia, prywatna opieka medyczna, karta sportowa, premia, ZUS, PPK

Jeśli większość Twoich ogłoszeń jest po angielsku, zostań przy standardowych trybach w `modes/`. Tryby angielskie działają dla ogłoszeń polskojęzycznych, ale nie znają specyfiki polskiego rynku w szczegółach.

## Jak aktywować?

### Opcja 1 -- Na sesję

Powiedz Claude'owi na początku sesji:

> "Używaj polskich trybów z `modes/pl/`."

Claude będzie wtedy czytał pliki z tego folderu zamiast z `modes/`.

### Opcja 2 -- Na stałe

Dodaj w `config/profile.yml`:

```yaml
language:
  primary: pl
  modes_dir: modes/pl
```

Przypomnij o tym Claude'owi podczas pierwszej sesji ("Zajrzyj do `profile.yml`, ustawiłem `language.modes_dir`"). Claude automatycznie użyje polskich trybów.

## Które tryby są przetłumaczone?

Ta pierwsza iteracja obejmuje cztery tryby o najwyższym wpływie:

| Plik | Przetłumaczony z | Rola |
|---------|----------------|------|
| `_shared.md` | `modes/_shared.md` (EN) | Wspólny kontekst, archetypy, reguły globalne, specyfika polskiego rynku |
| `oferta.md` | `modes/oferta.md` (ES) | Pełna ocena oferty (Bloki A-F) |
| `aplikuj.md` | `modes/apply.md` (EN) | Asystent na żywo do wypełniania formularzy aplikacyjnych |
| `pipeline.md` | `modes/pipeline.md` (ES) | Inbox URL-i / Second Brain dla zebranych ofert |

Pozostałe tryby (`scan`, `batch`, `pdf`, `tracker`, `auto-pipeline`, `deep`, `contacto`, `ofertas`, `project`, `training`) zostają w EN/ES. Ich treść to głównie tooling, ścieżki i komendy -- musi pozostać niezależna od języka.

## Co zostaje po angielsku

Świadomie nieprzetłumaczone, bo to standardowe słownictwo techniczne:

- `cv.md`, `pipeline`, `tracker`, `report`, `score`, `archetype`, `proof point`
- Nazwy narzędzi (`Playwright`, `WebSearch`, `WebFetch`, `Read`, `Write`, `Edit`, `Bash`)
- Wartości statusu w trackerze (`Evaluated`, `Applied`, `Interview`, `Offer`, `Rejected`)
- Fragmenty kodu, ścieżki, komendy

Tryby używają naturalnego, technicznego języka polskiego, takiego, jakim mówi się w zespołach engineeringowych w Warszawie, Krakowie czy Wrocławiu: tekst po polsku, terminy techniczne po angielsku tam, gdzie tak się ich używa. Bez wymuszonego tłumaczenia "Pipeline" na "Potok" ani "Deploy" na "Wdrożenie aplikacyjne".

## Słownik referencyjny

Aby zachować spójny ton, jeśli modyfikujesz lub rozszerzasz tryby:

| Angielski | Polski (w tej codebase) |
|---------|-------------------------------|
| Job posting | Oferta pracy / Ogłoszenie |
| Application | Aplikacja / Kandydatura |
| Cover letter | List motywacyjny |
| Resume / CV | CV |
| Salary | Wynagrodzenie / Pensja |
| Compensation | Wynagrodzenie / Pakiet |
| Skills | Umiejętności / Kompetencje |
| Interview | Rozmowa kwalifikacyjna |
| Hiring manager | Manager rekrutujący / Hiring manager |
| Recruiter | Rekruter (lub Recruiter) |
| AI | AI / SI (Sztuczna Inteligencja) |
| Requirements | Wymagania |
| Career history | Doświadczenie zawodowe / Przebieg kariery |
| Notice period | Okres wypowiedzenia |
| Probation | Okres próbny |
| Vacation | Urlop wypoczynkowy |
| 13th month salary | 13. pensja / Trzynastka |
| Permanent employment | Umowa o pracę na czas nieokreślony (UoP) |
| Fixed-term contract | Umowa o pracę na czas określony |
| Freelance | Freelance / B2B / Samozatrudnienie |
| Mandate contract | Umowa zlecenie |
| Specific-task contract | Umowa o dzieło |
| Profit sharing | Udział w zyskach / Premia |
| Health insurance | Prywatna opieka medyczna |
| Sports card | Karta sportowa (Multisport / Medicover Sport) |
| Social security | ZUS (Zakład Ubezpieczeń Społecznych) |
| Employee pension scheme | PPK (Pracownicze Plany Kapitałowe) |
| Net / Gross | Netto / Brutto |
| Day rate (B2B) | Stawka dzienna |

## Wkład (Contribute)

Aby ulepszyć tłumaczenie lub dodać tryb:

1. Otwórz Issue z propozycją (zobacz `CONTRIBUTING.md`)
2. Trzymaj się powyższego słownika, aby zachować spójny ton
3. Tłumacz idiomatycznie -- bez tłumaczenia słowo w słowo
4. Zachowaj elementy strukturalne (Bloki A-F, tabele, bloki kodu, instrukcje narzędzi) identycznie
5. Przetestuj na prawdziwej polskiej ofercie (Pracuj.pl, No Fluff Jobs, Just Join IT) przed wysłaniem PR-a
