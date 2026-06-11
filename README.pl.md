# Career-Ops

[English](README.md) | [Español](README.es.md) | [Français](README.fr.md) | [Português (Brasil)](README.pt-BR.md) | [한국어](README.ko-KR.md) | [日本語](README.ja.md) | [简体中文](README.cn.md) | [繁體中文](README.zh-TW.md) | [Українська](README.ua.md) | [Русский](README.ru.md) | [Polski](README.pl.md) | [العربية](README.ar.md)

<p align="center">
  <a href="https://x.com/santifer"><img src="docs/hero-banner.jpg" alt="Career-Ops — Wieloagentowy system poszukiwania pracy" width="800"></a>
</p>

<p align="center">
  <em>Przez miesiące szukałem pracy po staremu. Więc zbudowałem system, który chciałem mieć od początku.</em><br>
  Firmy używają AI do filtrowania kandydatów. <strong>Ja dałem kandydatom AI, żeby mogli <em>wybierać</em> firmy.</strong><br>
  <em>Teraz jest open source.</em>
</p>

<p align="center">
  <a href="https://trendshift.io/repositories/25195" target="_blank"><img src="https://trendshift.io/api/badge/repositories/25195" alt="santifer%2Fcareer-ops | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
</p>

<p align="center"><sub>OBECNY W MEDIACH</sub></p>

<p align="center">
  <a href="https://wired.com.gr/article/to-ai-ergaleio-pou-fernei-epanastasi-ston-tropo-pou-psachnoume-douleia/" rel="noopener noreferrer nofollow"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/press/wired-dark.svg"><img src="docs/press/wired.svg" alt="WIRED" height="32"></picture></a>
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <a href="https://www.businessinsider.com/how-i-built-tool-filter-job-listings-landed-head-ai-2026-4" rel="noopener noreferrer nofollow"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/press/business-insider-dark.svg"><img src="docs/press/business-insider.svg" alt="Business Insider" height="32"></picture></a>
</p>

---

<p align="center">
  <img src="docs/demo.gif" alt="Career-Ops Demo" width="800">
</p>

<p align="center"><strong>740+ ocenionych ofert · 100+ spersonalizowanych CV · 1 wymarzona rola zdobyta</strong></p>

<p align="center"><a href="https://discord.gg/8pRpHETxa4"><img src="https://img.shields.io/badge/Dołącz_do_społeczności-Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord"></a></p>

<p align="center">
  <sub>Zbudowane z</sub><br>
  <img src="https://img.shields.io/badge/Claude_Code-000?style=flat&logo=anthropic&logoColor=white" alt="Claude Code">
  <img src="https://img.shields.io/badge/OpenCode-111827?style=flat&logo=terminal&logoColor=white" alt="OpenCode">
  <img src="https://img.shields.io/badge/Gemini_CLI-4285F4?style=flat&logo=google&logoColor=white" alt="Gemini CLI">
  <img src="https://img.shields.io/badge/Codex-412991?style=flat&logo=openai&logoColor=white" alt="Codex">
  <img src="https://img.shields.io/badge/Qwen-615CED?style=flat" alt="Qwen">
  <img src="https://img.shields.io/badge/GitHub_Copilot-000?style=flat&logo=githubcopilot&logoColor=white" alt="GitHub Copilot">
  <br>
  <img src="https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/Go-00ADD8?style=flat&logo=go&logoColor=white" alt="Go">
  <img src="https://img.shields.io/badge/Playwright-2EAD33?style=flat&logo=playwright&logoColor=white" alt="Playwright">
  <img src="https://img.shields.io/badge/Bubble_Tea-FF75B5?style=flat&logo=go&logoColor=white" alt="Bubble Tea">
  <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT">
  <a href="TRADEMARK.md"><img src="https://img.shields.io/badge/Trademark-Policy-blue.svg" alt="Trademark Policy"></a>
</p>

## Co to jest

Career-Ops ([career-ops.org](https://career-ops.org), znany też jako **careerops**) zamienia dowolne AI CLI w pełne centrum dowodzenia poszukiwaniem pracy. Zamiast ręcznego śledzenia aplikacji w arkuszu kalkulacyjnym, dostajesz pipeline zasilany AI, który:

- **Ocenia oferty** przy pomocy strukturyzowanego systemu A–F (10 ważonych wymiarów)
- **Generuje spersonalizowane PDF** — CV zoptymalizowane pod ATS, dostosowane do każdej oferty
- **Skanuje portale** automatycznie (Greenhouse, Ashby, Lever, strony firm)
- **Przetwarza wsadowo** — ocena 10+ ofert równolegle przez sub-agentów
- **Śledzi wszystko** w jednym źródle prawdy z weryfikacją spójności danych

> **Ważne: to NIE jest narzędzie do masowego wysyłania aplikacji.** Career-ops to filtr — pomaga znaleźć te kilka ofert wartych twojego czasu spośród setek. System stanowczo odradza aplikowanie na oferty z oceną poniżej 4.0/5. Twój czas jest cenny, podobnie jak czas rekrutera. Zawsze sprawdzaj przed wysłaniem.

Career-ops działa agentowo: Claude Code nawiguje po stronach kariery z Playwright, ocenia dopasowanie rozumując nad twoim CV kontra opis stanowiska (nie przez dopasowanie słów kluczowych) i dostosowuje CV do każdego ogłoszenia.

> **Uwaga: pierwsze oceny nie będą idealne.** System jeszcze cię nie zna. Dostarcz mu kontekstu — swoje CV, historię kariery, przykłady osiągnięć, preferencje, mocne strony, czego chcesz unikać. Im więcej mu dasz, tym lepiej działa. Traktuj to jak wdrożenie nowego rekrutera: w pierwszym tygodniu musi się nauczyć, kim jesteś — potem staje się nieoceniony.

Zbudowany przez kogoś, kto użył go do oceny 740+ ofert pracy, wygenerowania 100+ spersonalizowanych CV i zdobycia roli Head of Applied AI. [Przeczytaj pełne case study](https://santifer.io/career-ops-system).

## Funkcje

| Funkcja                        | Opis                                                                                                                                            |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Auto-Pipeline**              | Wklej URL → pełna ocena + PDF + wpis w trackerze                                                                                                |
| **Ocena 6-blokowa**            | Podsumowanie roli, dopasowanie CV, strategia poziomu, badanie wynagrodzenia, personalizacja, przygotowanie do rozmowy (STAR+R)                  |
| **Bank historii do rozmów**    | Gromadzi historie STAR+Reflection — 5–10 historii mistrzowskich odpowiadających na każde pytanie behawioralne                                   |
| **Skrypty negocjacyjne**       | Frameworki negocjacji wynagrodzenia, odparcie dyskonta geograficznego, wykorzystanie konkurencyjnych ofert                                      |
| **Generowanie PDF pod ATS**    | CV z wstrzyknięciem słów kluczowych, design Space Grotesk + DM Sans                                                                            |
| **Skaner portali**             | 45+ firm skonfigurowanych (Anthropic, OpenAI, ElevenLabs, Retool, n8n…) + zapytania przez Ashby, Greenhouse, Lever, Wellfound                  |
| **Przetwarzanie wsadowe**      | Równoległa ocena przez workery `claude -p`                                                                                                      |
| **Dashboard TUI**              | Terminalowy UI do przeglądania, filtrowania i sortowania pipeline'u                                                                             |
| **Human-in-the-Loop**          | AI ocenia i rekomenduje, ty decydujesz i działasz. System nigdy nie wysyła aplikacji — ostatnie słowo zawsze należy do ciebie                  |
| **Integralność pipeline'u**    | Automatyczny merge, deduplikacja, normalizacja statusów, sprawdzenia zdrowia danych                                                             |

## Szybki start

**Najszybszy sposób — jedno polecenie:**

```bash
npx @santifer/career-ops init
```

> 💡 `npx` jest dołączone do [Node.js](https://nodejs.org) — uruchamia instalator jednorazowo, bez instalowania czegokolwiek globalnie. Nie masz jeszcze Node.js? Najpierw go zainstaluj.
> (Używasz już Claude Code / Gemini / Codex CLI? To już go masz.)

To sklonuje najnowszą wersję do `./career-ops` i zainstaluje zależności. Następnie:

```bash
cd career-ops
claude   # lub gemini / codex / qwen / opencode — otwórz tutaj swój AI CLI
```

**Przy pierwszym uruchomieniu career-ops przeprowadza Cię przez konfigurację — CV, profil i docelowe stanowiska — wyłącznie przez rozmowę. Nic nie trzeba edytować ręcznie.**

<details>
<summary><b>Wolisz skonfigurować ręcznie? (git clone)</b></summary>

```bash
git clone https://github.com/santifer/career-ops.git
cd career-ops && npm install
npx playwright install chromium   # wymagane tylko do generowania PDF
claude   # otwórz swój AI CLI — przy pierwszym uruchomieniu przeprowadzi Cię przez onboarding
```

</details>

> **System jest zaprojektowany tak, żeby Claude go dostosowywał.** Tryby, archetypy, wagi oceniania, skrypty negocjacyjne — po prostu poproś Claude o zmiany. Czyta te same pliki, których używa, więc wie dokładnie, co edytować.

Pełny przewodnik po konfiguracji: [docs/SETUP.md](docs/SETUP.md).

## Użycie

Career-ops to jedna komenda slash z wieloma trybami:

```text
/career-ops                    → Pokaż wszystkie dostępne komendy
/career-ops {wklej ofertę}     → Pełny auto-pipeline (ocena + PDF + tracker)
/career-ops scan               → Skanuj portale w poszukiwaniu nowych ofert
/career-ops pdf                → Generuj CV zoptymalizowane pod ATS
/career-ops batch              → Wsadowa ocena wielu ofert
/career-ops tracker            → Podgląd statusu aplikacji
/career-ops apply              → Wypełnianie formularzy aplikacyjnych z AI
/career-ops pipeline           → Przetwarzanie kolejki URL
/career-ops contacto           → Wiadomość na LinkedIn
/career-ops deep               → Szczegółowe badanie firmy
/career-ops training           → Ocena kursu/certyfikatu
/career-ops project            → Ocena projektu portfolio
```

Możesz też po prostu wkleić URL oferty lub jej treść — career-ops automatycznie to wykryje i uruchomi pełny pipeline.

## Jak to działa

```diagram
Wklejasz URL oferty lub jej opis
        │
        ▼
┌──────────────────┐
│  Wykrywanie      │  Klasyfikacja: Frontend / Backend / DevOps / PM / SA / ML
│  archetypu       │
└────────┬─────────┘
         │
┌────────▼─────────┐
│  Ocena A–F       │  Dopasowanie, luki, badanie wynagrodzenia, historie STAR
│  (czyta cv.md)   │
└────────┬─────────┘
         │
    ┌────┼────┐
    ▼    ▼    ▼
 Raport  PDF  Tracker
  .md   .pdf   .tsv
```

## 🇵🇱 Polskie portale z ofertami pracy

Career-ops obsługuje główne polskie portale IT. Dwa z nich — JustJoin.it i NoFluffJobs — mają publiczne API i mogą być zintegrowane jako źródła Level 0 (zero tokenów, brak WebSearch, świeże dane w czasie skanowania). Pozostałe portale wymagają weryfikacji ręcznej lub przez Playwright.

| Portal              | URL                                          | API        | Uwagi                                                                 |
| ------------------- | -------------------------------------------- | ---------- | --------------------------------------------------------------------- |
| **JustJoin.it**     | [justjoin.it](https://justjoin.it)           | Publiczne  | Największy portal IT w Polsce. JSON API z pełnymi danymi ofert        |
| **NoFluffJobs**     | [nofluffjobs.com](https://nofluffjobs.com)   | Publiczne  | Obowiązkowe widełki wynagrodzenia. Skierowany do seniorów             |
| **pracuj.pl**       | [pracuj.pl](https://pracuj.pl)               | Brak       | Największy ogólny portal. Blokuje boty (403) — weryfikacja ręczna     |
| **BulldogJob**      | [bulldogjob.pl](https://bulldogjob.pl)       | Brak       | IT-focused, oferty z widełkami                                        |
| **inhire.io**       | [inhire.io](https://inhire.io)               | Brak       | Headhunting IT, często oferty nieujawnione publicznie                 |
| **theprotocol.io**  | [theprotocol.io](https://theprotocol.io)     | Brak       | Dawny Rocket Jobs. Transparentne wynagrodzenia                        |
| **solid.jobs**      | [solid.jobs](https://solid.jobs)             | Brak       | Oferty z weryfikacją przez społeczność                                |

### Polskie realia rynku pracy w ocenach

Career-ops uwzględnia specyfikę polskiego rynku pracy przy ocenianiu ofert:

- **Forma zatrudnienia**: UoP (Umowa o pracę) vs B2B (Faktura VAT) vs UZ (Umowa zlecenie) — różnice w kwocie netto, bezpieczeństwie, urlopie i ZUS mają wpływ na ocenę stabilności
- **Wynagrodzenie**: brutto (przed podatkiem i ZUS) kontra netto (na rękę). Różnica bywa znaczna — system uwzględnia ją przy porównywaniu ofert
- **Benefity**: prywatna opieka medyczna (Medicover, LuxMed, Enel-Med), karta sportowa (MultiSport, OK System), Edenred / karta lunchowa, PPK
- **Urlop**: 20 dni przy stażu poniżej 10 lat, 26 dni przy stażu 10 lat i więcej (Kodeks pracy)
- **Praca zdalna**: pełny remote, hybryd (np. 2 dni/tydzień), model biurowy — system ocenia to w kontekście preferencji kandydata
- **Okres próbny**: do 3 miesięcy (6 miesięcy dla stanowisk kierowniczych zgodnie z KP)

## Skonfigurowane portale

Skaner zawiera **45+ firm** gotowych do skanowania i **19 zapytań** przez główne portale z ofertami. Skopiuj `templates/portals.example.yml` do `portals.yml` i dodaj swoje:

**AI Labs:** Anthropic, OpenAI, Mistral, Cohere, LangChain, Pinecone
**Voice AI:** ElevenLabs, PolyAI, Parloa, Hume AI, Deepgram, Vapi, Bland AI
**AI Platforms:** Retool, Airtable, Vercel, Temporal, Glean, Arize AI
**Contact Center:** Ada, LivePerson, Sierra, Decagon, Talkdesk, Genesys
**Enterprise:** Salesforce, Twilio, Gong, Dialpad
**LLMOps:** Langfuse, Weights & Biases, Lindy, Cognigy, Speechmatics
**Automation:** n8n, Zapier, Make.com
**European:** Factorial, Attio, Tinybird, Clarity AI, Travelperk

**Przeszukiwane portale:** Ashby, Greenhouse, Lever, Wellfound, Workable, RemoteFront

Domyślnie `node scan.mjs` (`npm run scan`) ufa temu, co zwraca każdy feed ATS. Niektóre firmy zostawiają nieaktualne ogłoszenia nawet po zamknięciu rekrutacji. Przekaż `--verify`, żeby uruchomić Playwright po fazie API i odfiltrować wygasłe oferty przed dodaniem do pipeline'u:

```bash
node scan.mjs --verify          # zero-tokenowe wyszukiwanie + weryfikacja liveness przez Playwright
```

Weryfikacja jest sekwencyjna i dotyczy tylko nowych ofert (po deduplikacji), więc koszt jest ograniczony.

## Dashboard TUI

Wbudowany terminal dashboard do wizualnego przeglądania pipeline'u:

```bash
cd dashboard
go build -o career-dashboard .
./career-dashboard --path ..
```

Funkcje: 6 zakładek filtrowania, 4 tryby sortowania, widok grupowany/płaski, leniwe ładowanie podglądów, zmiana statusów inline.

## Struktura projektu

```text
career-ops/
├── AGENTS.md                    # Kanoniczne instrukcje dla agenta (wszystkie CLI)
├── CLAUDE.md                    # Wrapper Claude Code (importuje AGENTS.md)
├── cv.md                        # Twoje CV (utwórz ten plik)
├── article-digest.md            # Twoje dowody osiągnięć (opcjonalne)
├── config/
│   └── profile.example.yml      # Szablon profilu
├── modes/                       # 14 trybów skill
│   ├── _shared.md               # Wspólny kontekst (dostosuj ten plik)
│   ├── oferta.md                # Ocena jednej oferty
│   ├── pdf.md                   # Generowanie PDF
│   ├── scan.md                  # Skaner portali
│   ├── batch.md                 # Przetwarzanie wsadowe
│   └── ...
├── templates/
│   ├── cv-template.html         # Szablon CV zoptymalizowany pod ATS
│   ├── portals.example.yml      # Szablon konfiguracji skanera
│   └── states.yml               # Kanoniczne statusy
├── batch/
│   ├── batch-prompt.md          # Samodzielny prompt workera
│   └── batch-runner.sh          # Skrypt orkiestratora
├── dashboard/                   # Go TUI viewer pipeline'u
├── data/                        # Twoje dane śledzenia (gitignored)
├── reports/                     # Raporty ocen (gitignored)
├── output/                      # Wygenerowane PDF (gitignored)
├── fonts/                       # Space Grotesk + DM Sans
├── docs/                        # Dokumentacja setup, customizacji, architektury
└── examples/                    # Przykładowe CV, raport, proof points
```

## Stack technologiczny

![Claude Code](https://img.shields.io/badge/Claude_Code-000?style=flat&logo=anthropic&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-2EAD33?style=flat&logo=playwright&logoColor=white)
![Go](https://img.shields.io/badge/Go-00ADD8?style=flat&logo=go&logoColor=white)
![Bubble Tea](https://img.shields.io/badge/Bubble_Tea-FF75B5?style=flat&logo=go&logoColor=white)

- **Agent**: Claude Code z niestandardowymi skillami i trybami
- **PDF**: Playwright/Puppeteer + szablon HTML
- **Skaner**: Playwright + Greenhouse API + WebSearch
- **Dashboard**: Go + Bubble Tea + Lipgloss (motyw Catppuccin Mocha)
- **Dane**: tabele Markdown + konfiguracja YAML + pliki TSV dla wsadów

## Również open source

- **[cv-santiago](https://github.com/santifer/cv-santiago)** — Strona portfolio (santifer.io) z chatbotem AI, dashboardem LLMOps i case studies. Jeśli potrzebujesz portfolio do swojego poszukiwania pracy, sforkuj i dostosuj do siebie.

## O autorze

Jestem Santiago — Head of Applied AI, były founder (zbudowałem i sprzedałem firmę, która nadal działa z moim nazwiskiem). Zbudowałem career-ops do zarządzania własnym poszukiwaniem pracy. Zadziałało: użyłem go do zdobycia swojej obecnej roli.

Moje portfolio i inne projekty open source → [santifer.io](https://santifer.io)

## Historia gwiazdek

<a href="https://www.star-history.com/?repos=santifer%2Fcareer-ops&type=timeline&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=santifer/career-ops&type=timeline&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=santifer/career-ops&type=timeline&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=santifer/career-ops&type=timeline&legend=top-left" />
 </picture>
</a>

## Zastrzeżenie prawne

**career-ops to lokalne narzędzie open source, NIE usługa hostingowa.** Korzystając z tego oprogramowania, potwierdzasz:

1. **Kontrolujesz swoje dane.** Twoje CV, dane kontaktowe i dane osobowe pozostają na twoim komputerze i są wysyłane bezpośrednio do wybranego dostawcy AI (Anthropic, OpenAI itd.). Nie zbieramy, nie przechowujemy ani nie mamy dostępu do twoich danych.
2. **Kontrolujesz AI.** Domyślne prompty instruują AI, żeby nie wysyłało aplikacji automatycznie, ale modele AI mogą zachowywać się nieprzewidywalnie. Modyfikujesz prompty na własne ryzyko. **Zawsze sprawdzaj treści wygenerowane przez AI przed wysłaniem.**
3. **Przestrzegasz regulaminów portali.** Korzystaj z narzędzia zgodnie z warunkami korzystania z serwisów, z którymi wchodzisz w interakcję (Greenhouse, Lever, pracuj.pl, LinkedIn itd.). Nie używaj go do spamowania pracodawców.
4. **Brak gwarancji.** Oceny to rekomendacje, nie prawda. Modele AI mogą halucynować. Autorzy nie ponoszą odpowiedzialności za wyniki rekrutacji, odrzucone aplikacje, ograniczenia konta ani żadne inne konsekwencje.

Szczegóły: [LEGAL_DISCLAIMER.md](LEGAL_DISCLAIMER.md). Oprogramowanie jest udostępniane na [licencji MIT](LICENSE) „tak jak jest", bez jakichkolwiek gwarancji.

## Współtwórcy

<a href="https://github.com/santifer/career-ops/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=santifer/career-ops" alt="Współtwórcy" />
</a>

Znalazłeś pracę dzięki career-ops? [Podziel się swoją historią!](https://github.com/santifer/career-ops/issues/new?template=i-got-hired.yml)

## Licencja i znak towarowy

Kod jest licencjonowany na [MIT](LICENSE). Nazwa i marka „career-ops" są regulowane przez [Politykę Znaków Towarowych](TRADEMARK.md) — dozwolone dla użytku społecznościowego, zastrzeżone dla komercyjnego nazewnictwa produktów i endorsementu.

## Bądźmy w kontakcie

[![Website](https://img.shields.io/badge/santifer.io-000?style=for-the-badge&logo=safari&logoColor=white)](https://santifer.io)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white)](https://linkedin.com/in/santifer)
[![X](https://img.shields.io/badge/X-000?style=for-the-badge&logo=x&logoColor=white)](https://x.com/santifer)
[![Discord](https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/8pRpHETxa4)
[![Email](https://img.shields.io/badge/Email-EA4335?style=for-the-badge&logo=gmail&logoColor=white)](mailto:hi@santifer.io)
