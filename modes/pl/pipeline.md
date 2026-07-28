# Tryb: pipeline -- Inbox URL-i (Second Brain)

Przetwarza URL-e ofert nagromadzone w `data/pipeline.md`. Kandydat dodaje URL-e, kiedy chce, a potem uruchamia `/career-ops pipeline`, by przetworzyć je wszystkie naraz.

## Workflow

1. **Przeczytaj** `data/pipeline.md` -> znajdź itemy `- [ ]` w sekcji "Oczekujące" / "Pending" / "Pendientes"
2. **Dla każdego oczekującego URL-a**:
   a. Zarezerwuj następny kolejny `REPORT_NUM` atomowo, uruchamiając `node reserve-report-num.mjs` (i zwolnij sentinel, uruchamiając `node reserve-report-num.mjs --release <num>`, gdy report zostanie zapisany)
   b. **Wyciągnij ofertę** za pomocą Playwright (`browser_navigate` + `browser_snapshot`) -> WebFetch -> WebSearch
   c. Jeśli URL jest niedostępny -> oznacz jako `- [!]` z notatką i kontynuuj
   d. **Wykonaj pełny auto-pipeline**: Ocena A-F -> Report .md -> PDF (jeśli score >= 3.0) -> Tracker
   e. **Przenieś z "Oczekujące" do "Przetworzone"**: `- [x] #NNN | URL | Firma | Rola | Score/5 | PDF tak/nie`
3. **Jeśli 3+ oczekujących URL-i**, uruchom agentów równolegle (Agent tool z `run_in_background`), aby zmaksymalizować szybkość.
4. **Na końcu** wyświetl tabelę podsumowującą:

```
| # | Firma | Rola | Score | PDF | Rekomendowana akcja |
```

## Format pipeline.md

```markdown
## Oczekujące
- [ ] https://jobs.example.com/posting/123
- [ ] https://boards.greenhouse.io/company/jobs/456 | Company Sp. z o.o. | Senior PM
- [!] https://private.url/job -- Błąd: wymagane logowanie

## Przetworzone
- [x] #143 | https://jobs.example.com/posting/789 | Acme Sp. z o.o. | AI PM | 4.2/5 | PDF tak
- [x] #144 | https://boards.greenhouse.io/xyz/jobs/012 | BigCo | SA | 2.1/5 | PDF nie
```

> Uwaga: Nagłówki sekcji mogą być w EN ("Pending"/"Processed"), ES ("Pendientes"/"Procesadas"), DE ("Offen"/"Verarbeitet") lub PL ("Oczekujące"/"Przetworzone"). Bądź elastyczny przy czytaniu, wierny istniejącemu stylowi przy pisaniu.

## Inteligentne wykrywanie oferty z URL-a

1. **Playwright (preferowane):** `browser_navigate` + `browser_snapshot`. Działa ze wszystkimi SPA.
   - **Opcjonalnie — ekstraktor CLI (`scan.extractor: cli` w `config/profile.yml`):** zamiast tego uruchom `node browser-extract.mjs <url>` (`--mode jd`) — zwięzłe `{ "url", "title", "text" }`, mniej tokenów (zależnie od portalu). **Cichy powrót** do `browser_navigate` + `browser_snapshot` przy błędzie lub braku.
2. **WebFetch (fallback):** Dla stron statycznych lub gdy Playwright jest niedostępny.
3. **WebSearch (ostateczność):** Szukaj na portalach drugorzędnych, które indeksują ofertę.

**Przypadki szczególne:**
- **LinkedIn**: Może wymagać logowania -> oznacz `[!]` i poproś kandydata o wklejenie tekstu
- **PDF**: Jeśli URL wskazuje na PDF, przeczytaj go bezpośrednio narzędziem Read
- **Prefiks `local:`**: Przeczytaj plik lokalny. Przykład: `local:jds/linkedin-pm-ai.md` -> przeczytaj `jds/linkedin-pm-ai.md`
- **Pracuj.pl / No Fluff Jobs / Just Join IT**: Popularne polskie portale. Playwright dobrze radzi sobie z bannerami cookie
- **Bulldogjob / LinkedIn PL**: Oferty ustrukturyzowane, dobrze czytelne maszynowo. WebFetch zwykle wystarcza

## Automatyczna numeracja

1. Uruchom `node reserve-report-num.mjs`, aby zarezerwować następny kolejny numer atomowo (stdout zwraca `{###}`).
2. Zapisz report z tym numerem.
3. Zwolnij sentinel, uruchamiając `node reserve-report-num.mjs --release {###}`, gdy report zostanie zapisany.

## Synchronizacja źródeł

Przed przetworzeniem URL-a sprawdź synchronizację:

```bash
node cv-sync-check.mjs
```

W razie desynchronizacji ostrzeż kandydata przed kontynuowaniem.
