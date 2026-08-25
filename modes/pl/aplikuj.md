# Tryb: aplikuj -- Asystent na żywo do formularzy aplikacyjnych

Tryb interaktywny na moment, gdy kandydat wypełnia formularz aplikacyjny w Chrome. Czyta to, co jest na ekranie, ładuje kontekst poprzedniej oceny oferty i generuje spersonalizowane odpowiedzi na każde pytanie formularza.

## Wymagania wstępne

- **Idealnie z widocznym Playwright**: W trybie widocznym kandydat widzi przeglądarkę, a Claude może wchodzić w interakcję ze stroną.
- **Bez Playwright**: kandydat udostępnia zrzut ekranu lub wkleja pytania ręcznie.

## Workflow

```
1. WYKRYJ       -> Przeczytaj aktywną kartę Chrome (zrzut/URL/tytuł)
2. ZIDENTYFIKUJ -> Wyciągnij firmę + rolę ze strony
3. WYSZUKAJ     -> Dopasuj do istniejących reportów w reports/
4. ZAŁADUJ      -> Przeczytaj pełny report + Blok G (jeśli istnieje)
5. PORÓWNAJ     -> Czy rola na ekranie odpowiada ocenionej? Jeśli zmiana -> ostrzeż
6. PRZEANALIZUJ -> Zidentyfikuj WSZYSTKIE widoczne pytania formularza
7. WYGENERUJ    -> Dla każdego pytania wygeneruj spersonalizowaną odpowiedź
8. ZAPREZENTUJ  -> Wyświetl odpowiedzi sformatowane do skopiowania
```

## Krok 1 -- Wykryj ofertę

**Z Playwright:** Snapshot aktywnej strony. Przeczytaj tytuł, URL i widoczną treść.

**Bez Playwright:** Poproś kandydata, aby:
- Udostępnił zrzut ekranu formularza (narzędzie Read czyta obrazy)
- Lub wkleił pytania formularza jako tekst
- Lub podał firmę + rolę, abyśmy mogli wyszukać kontekst

## Krok 2 -- Zidentyfikuj i załaduj kontekst

1. Wyciągnij nazwę firmy i tytuł stanowiska ze strony
2. Wyszukaj w `reports/` po nazwie firmy (Grep case-insensitive)
3. Jeśli dopasowanie -> załaduj pełny report
4. Jeśli Blok G obecny -> załaduj poprzednie szkice odpowiedzi jako bazę
5. Jeśli BRAK dopasowania -> ostrzeż kandydata i zaproponuj szybki auto-pipeline

## Krok 3 -- Wykryj zmiany roli

Jeśli rola na ekranie różni się od ocenionej:
- **Ostrzeż kandydata**: "Rola zmieniła się z [X] na [Y]. Czy chcesz, żebym ocenił ją ponownie, czy dostosował odpowiedzi do nowego tytułu?"
- **Jeśli dostosować**: Dostosuj odpowiedzi do nowej roli bez ponownej oceny
- **Jeśli ocenić ponownie**: Uruchom pełną ocenę A-F, zaktualizuj report, wygeneruj ponownie Blok G
- **Zaktualizuj tracker**: Zmień tytuł roli w applications.md, jeśli to konieczne

## Krok 4 -- Przeanalizuj pytania formularza

Zidentyfikuj WSZYSTKIE widoczne pytania:
- Pola tekstu otwartego (list motywacyjny, "dlaczego to stanowisko", motywacja itp.)
- Listy rozwijane (skąd dowiedziałeś się o firmie, pozwolenie na pracę itp.)
- Tak/Nie (mobilność, wiza, dostępność itp.)
- Pola wynagrodzenia (widełki, oczekiwania płacowe -- ustal, czy netto czy brutto)
- Pola upload (CV, list motywacyjny PDF, referencje)

Sklasyfikuj każde pytanie:
- **Już odpowiedziane w Bloku G** -> wykorzystaj istniejącą odpowiedź
- **Nowe pytanie** -> wygeneruj odpowiedź z reportu + `cv.md`

## Krok 5 -- Wygeneruj odpowiedzi

Dla każdego pytania zbuduj odpowiedź według tego schematu:

1. **Kontekst z reportu**: Użyj proof points z bloku B, historii STAR z bloku F
2. **Poprzedni Blok G**: Jeśli szkic istnieje, weź go jako bazę i dopracuj
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

Jeśli kandydat potwierdzi, że aplikacja została wysłana:
1. Zaktualizuj status na "Applied" kanonicznym CLI: `node set-status.mjs <report#> Applied` (nie edytuj tabeli `applications.md` ręcznie)
2. Zaktualizuj Blok G reportu finalnymi odpowiedziami
3. Zasugeruj następny krok: `/career-ops contacto` dla LinkedIn outreach do hiring managera

## Obsługa przewijania

Jeśli formularz ma więcej pytań niż widać:
- Poproś kandydata, aby przewinął i udostępnił kolejny zrzut ekranu
- Lub wkleił pozostałe pytania
- Przetwarzaj iteracyjnie, aż pokryjesz cały formularz
