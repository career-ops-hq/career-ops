<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/wordmark-dark.svg"><img src="docs/wordmark-light.svg" alt="career-ops" width="250" height="56"></picture></p>

<p align="center">
  <em>Przez miesiące szukałem pracy po staremu. Więc zbudowałem system, który chciałem mieć od początku.</em><br>
  Firmy używają AI do filtrowania kandydatów. <strong>Ja dałem kandydatom AI, żeby mogli <em>wybierać</em> firmy.</strong><br>
  Ocenia, szereguje i pisze szkice. <strong>Nigdy nie wysyła: wysyłasz ty.</strong> Open source, lokalnie, twoje.
</p>

<p align="center">
  <a href="https://x.com/santifer/status/2041403685696053741"><img src="docs/demo.gif" alt="pipeline career-ops: oferty z ocenami, 219 oznaczonych jako nie aplikować, potem jedna pełna ocena" width="800"></a>
</p>

<p align="center"><sub>Migawka w trakcie poszukiwań: pipeline, potem jedna oferta otwarta i oceniona od początku do końca.</sub></p>

<p align="center"><strong>Z 740 ofert na aplikację zasługiwało 68. 12 rozmów. 1 oferta.</strong></p>
<p align="center"><sub>Jedno poszukiwanie, autora, 2026. Liczy się odsiew, nie liczba. Wszystkie liczby w <a href="https://santifer.io/career-ops-system">case study</a>.</sub></p>

<p align="center"><sub>Nigdy nie wysyła, nie pisze maili, nie dzwoni do domu: <a href="#czego-career-ops-nie-robi">czego nie robi</a> · działa w AI CLI, którego już używasz, <a href="docs/RUNNING_ON_A_BUDGET.md">także z darmowymi i lokalnymi modelami</a>.</sub></p>

<details>
<summary>Czytaj w 17 językach</summary>
<div align="center">

[English](README.md) | [Español](README.es.md) | [Deutsch](README.de.md) | [Français](README.fr.md) | [Português (Brasil)](README.pt-BR.md) | [한국어](README.ko-KR.md) | [日本語](README.ja.md) | [简体中文](README.cn.md) | [繁體中文](README.zh-TW.md) | [Українська](README.ua.md) | [Русский](README.ru.md) | [Polski](README.pl.md) | [Dansk](README.da.md) | [தமிழ்](README.ta.md) | [العربية](README.ar.md) | [हिन्दी](README.hi.md) | [Türkçe](README.tr.md)

</div>
</details>

<hr>

<p align="center">
  <a href="HIRED.md"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fsantifer%2Fcareer-ops%2Fmain%2Fdocs%2Fhired-count.json&query=%24.count&label=%F0%9F%8E%89%20HIRED%20WITH%20CAREER-OPS&suffix=%20verified&color=2ea44f&style=for-the-badge&labelColor=2b3137" alt="Zatrudnieni z career-ops: zweryfikowana liczba"></a>
</p>

<p align="center"><sub>Masz swoją pracę? <a href="https://github.com/career-ops-hq/career-ops/issues/new?template=i-got-hired.yml">Podziel się →</a> · twoja karta pokaże komuś w trakcie poszukiwań, że wyjście istnieje.</sub></p>

<p align="center">
  <a href="HIRED.md"><img src="docs/hired-wall.svg" alt="Trzy najnowsze historie zatrudnienia" width="800"></a>
</p>

<p align="center"><sub>Każda liczba to publiczna historia, którą możesz <a href="HIRED.md">sprawdzić →</a> · każda z nich zaczęła się tam, gdzie ty jesteś teraz.</sub></p>

<p align="center"><sub>PISALI O NAS</sub></p>

<p align="center">
  <a href="https://wired.com.gr/article/to-ai-ergaleio-pou-fernei-epanastasi-ston-tropo-pou-psachnoume-douleia/" rel="noopener noreferrer nofollow"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/press/wired-dark.svg"><img src="docs/press/wired.svg" alt="WIRED" height="32"></picture></a>
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <a href="https://www.businessinsider.com/how-i-built-tool-filter-job-listings-landed-head-ai-2026-4" rel="noopener noreferrer nofollow"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/press/business-insider-dark.svg"><img src="docs/press/business-insider.svg" alt="Business Insider" height="32"></picture></a>
</p>

<p align="center">
  <a href="https://www.producthunt.com/products/santifer-io?utm_source=badge-featured&utm_medium=badge" target="_blank" rel="noopener noreferrer"><img src="docs/press/producthunt.svg" alt="career-ops on Claude | Product Hunt" style="width: 206px; height: 54px; vertical-align: middle;" width="206" height="54"/></a>
  &nbsp;&nbsp;
  <a href="https://trendshift.io/repositories/25195" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/repositories/25195" alt="santifer%2Fcareer-ops | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
</p>

<p align="center"><sub>Stworzył i utrzymuje <a href="https://santifer.io">Santiago Fernández de Valderrama Aparicio</a> (<a href="https://github.com/santifer">@santifer</a>)</sub></p>

## Co to jest

career-ops ([career-ops.org](https://career-ops.org), znany też jako **careerops**) to open source'owe wyszukiwanie pracy z AI, które działa lokalnie w dowolnym AI CLI do kodowania: ocenia oferty, dopasowuje twoje CV i śledzi każdą aplikację, a ostatnie słowo zawsze należy do ciebie. Zamiast ręcznie śledzić aplikacje w arkuszu, dostajesz pipeline napędzany AI, który:

- **Ocenia oferty** w ustrukturyzowanym raporcie: bloki od A do H, z globalną oceną 1-5 wynikającą z całościowego osądu w pięciu wymiarach, a nie z formuły arytmetycznej. Kolumna ważności każdego wymagania w bloku B i ocena wiarygodności ogłoszenia w bloku G to osobne sygnały, neutralne dla oceny, które nigdy na nią nie wpływają; blok H powstaje tylko od 4.5 wzwyż
- **Generuje dopasowane PDF-y**: CV zoptymalizowane pod ATS, dostosowane do każdego opisu stanowiska
- **Skanuje portale** automatycznie (Greenhouse, Ashby, Lever, strony firm)
- **Przetwarza wsadowo**: ocenia 10+ ofert równolegle z pomocą subagentów
- **Śledzi wszystko** w jednym źródle prawdy z kontrolami integralności
- **Bada firmy i znajduje właściwą osobę do kontaktu**: aplikacja ustawia cię w kolejce; research daje ci rozmowę

> **Ważne: to NIE jest narzędzie do masowego aplikowania.** career-ops to filtr: pomaga znaleźć spośród setek ofert te kilka, które są warte twojego czasu. System zdecydowanie odradza aplikowanie na cokolwiek z oceną poniżej 4.0/5. Twój czas jest cenny, tak samo jak czas rekrutera. Zawsze sprawdź przed wysłaniem.

career-ops jest agentowy: wybrane przez ciebie AI CLI porusza się po stronach karier za pomocą Playwrighta, ocenia dopasowanie, rozumując o twoim CV względem opisu stanowiska (a nie dopasowując słowa kluczowe), i dostosowuje twoje CV do każdej oferty.

> **Uwaga: pierwsze oceny nie będą świetne.** System jeszcze cię nie zna. Daj mu kontekst: swoje CV, historię kariery, dowody osiągnięć, preferencje, w czym jesteś dobry, czego chcesz unikać. Im więcej mu dasz, tym lepiej działa. Traktuj to jak wdrażanie nowego rekrutera: w pierwszym tygodniu musi cię poznać, potem staje się nieoceniony.

Zbudował to ktoś, kto ocenił nim 740 ofert, zaaplikował na 68 i dostał stanowisko Head of Applied AI. [Przeczytaj pełne case study](https://santifer.io/career-ops-system).

## Czego career-ops nie robi

- **Nie wysyła aplikacji.** Przygotowuje odpowiedzi; ty otwierasz formularz i klikasz Wyślij. Skrypt nigdy nie robi POST (`prepare-application.mjs`).
- **Nie wysyła maili.** Tylko szkice. W całym kodzie nie ma żadnego transportu poczty.
- **Nie dzwoni do domu.** Bez telemetrii, bez naszego backendu. Twoje CV idzie z twojej maszyny do wybranego przez ciebie dostawcy AI i nigdzie indziej. Jedyny publiczny rejestr to to repozytorium: `HIRED.md` i jego issues.
- **Nie namawia do aplikowania poniżej 4.0/5.** Powie, żeby tego nie robić. Możesz to zignorować, a on to powie.

Przeredagowuje twoje CV; nigdy nie wolno mu go zmyślać. Dziś ta zasada żyje w promptach, jeszcze nie w wymuszającej kontroli w kodzie. Czytaj każde CV przed wysłaniem. Szczegóły w [FAQ](#faq).

## Manifest CareerOps

career-ops to pierwsza referencyjna implementacja [Manifestu CareerOps](https://career-ops.org/manifesto?utm_source=readme). przeczytaj go. jeśli mówi to, w co wierzysz, podpisz go. twój podpis staje się commitem.

## Funkcje

| Funkcja                  | Opis                                                                                                                                     |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Auto-Pipeline**        | Wklej URL, dostań pełną ocenę + PDF + wpis w trackerze                                                                                   |
| **Ocena A-H**            | Podsumowanie roli, dopasowanie CV (z wagą każdego wymagania dla tego ogłoszenia i informacją, czy waga pochodzi z treści opisu, jego struktury czy z szacunku; oznaczone per wymaganie, a szacunek nigdy nie może być w najwyższym paśmie), strategia poziomu, research wynagrodzeń, personalizacja, przygotowanie do rozmowy (STAR+R), plus kontrola wiarygodności ogłoszenia w bloku G, która oznacza oszustwa i martwe oferty, oraz sygnał pozwolenia na pracę, który oznacza opis z wyraźnym brakiem sponsoringu wizy jako twardy bloker |
| **Bank historii na rozmowy** | Gromadzi historie STAR+Refleksja między ocenami: 5-10 głównych historii, które odpowiadają na każde pytanie behawioralne               |
| **Skrypty negocjacyjne** | Frameworki negocjacji wynagrodzenia, odpowiedź na obniżkę geograficzną, wykorzystanie konkurencyjnych ofert                              |
| **Generowanie PDF pod ATS** | CV z wstrzykniętymi słowami kluczowymi w designie Space Grotesk + DM Sans                                                             |
| **Generator listów motywacyjnych** | Listy oparte na researchu z odbiciem słów kluczowych, czterema interaktywnymi pytaniami o kąt (dlaczego/problemy/podejście/ton), zatwierdzaniem szkicu w czacie i PDF A4 przez ten sam pipeline HTML + Playwright co CV. Tworzy szkic przy każdej ocenie; dokończ i wygeneruj na żądanie przez `/career-ops cover` |
| **Szkice maili aplikacyjnych** | Formalne maile do rekrutera, z polecenia lub na zimno z raportu albo wklejonego opisu, z tematem, checklistą załączników, udokumentowanymi punktami dopasowania i blokiem kontaktowym z profilu. Tylko szkice: career-ops nigdy nie wysyła, nie składa i nie klika niczego. |
| **Skaner portali**       | 100+ wstępnie skonfigurowanych firm (Anthropic, OpenAI, ElevenLabs, Retool, n8n...) + własne zapytania po Ashby, Greenhouse, Lever, Wellfound |
| **Odkrywanie firm po finansowaniu** | Komenda `company:funded` (najpierw przegląd) pokazuje firmy z niedawnym finansowaniem i diagnostykę źródeł z ustrukturyzowanych publicznych feedów, bez edytowania twoich danych |
| **Przetwarzanie wsadowe** | Równoległa ocena przez headless workery CLI (`claude -p` / `opencode run`)                                                             |
| **Dashboard TUI**        | Interfejs terminalowy do przeglądania, filtrowania i sortowania pipeline'u                                                               |
| **Human-in-the-Loop**    | AI ocenia i rekomenduje, ty decydujesz i działasz. System nigdy nie wysyła aplikacji: ostatnie słowo zawsze należy do ciebie <!-- hitl: absolute guarantee. Do not add "automatically", "by itself", "without your permission" or any other hedge when translating this row. -->               |
| **Integralność pipeline'u** | Automatyczne scalanie, deduplikacja, normalizacja statusów, kontrole stanu                                                            |
| **Zestaw do rozmów**     | Plany przygotowań w blokach czasowych, sesje ćwiczeniowe z feedbackiem, podsumowania po rozmowie ([`interview/`](modes/interview/README.md)) i detektor sygnałów ostrzegawczych firmy ([`interview-redflag`](modes/interview-redflag.md)) |
| **Etap oferty**          | Towarzysz czytania umowy: przejście po klauzulach plus lista pytań do prawnika ([`offer-prep`](modes/offer-prep.md)), i analizator luki między wynagrodzeniem oczekiwanym, ogłoszonym i rzeczywistym (`salary-gap.mjs`) |
| **Follow-upy i odpowiedzi** | Kalkulator rytmu follow-upów i przygotowane przypomnienia (`followup-cadence.mjs`, `followup-seed.mjs`); klasyfikacja odpowiedzi pracodawcy na aktualizacje trackera ([`reply-watch`](modes/reply-watch.md)) |
| **Analiza wzorców**      | Wzorce odrzuceń i wskaźniki przejścia per kanał ATS (`analyze-patterns.mjs`), statystyki lejka z całego poszukiwania (`stats.mjs`), wykrywanie ponownych publikacji i martwych ofert (`detect-reposts.mjs`) |
| **System wtyczek**       | Opcjonalne integracje (Gmail, Notion, Apify + rejestr społeczności), domyślnie wyłączone; zobacz [docs/PLUGINS.md](docs/PLUGINS.md)       |
| **Poza CV**              | Research firmy ([`deep`](modes/deep.md)) odsłania strategię AI, ostatnie ruchy, kulturę inżynierską i kąt, jaki powinien przyjąć twój profil. Wyszukiwanie kontaktów ([`contacto`](modes/contacto.md)) wskazuje hiring managera, rekrutera lub członka zespołu, do którego warto napisać, i tworzy szkic wiadomości na LinkedIn do 300 znaków dopasowanej do typu kontaktu. Szkice formalnych maili aplikacyjnych ([`email`](modes/email.md)) zamieniają oceniony raport lub wklejony opis w temat, treść i checklistę załączników bez wysyłania, składania ani klikania czegokolwiek. Aplikacja ustawia cię w kolejce; research daje ci rozmowę. |

## Szybki start

**Najszybsza droga: jedna komenda:**

```bash
npx @santifer/career-ops init
```

> 💡 `npx` jest dostarczany z [Node.js](https://nodejs.org): uruchamia instalator raz,
> nie instalując niczego globalnie. Nie masz jeszcze Node? Zainstaluj go najpierw.
> (Używasz już CLI Claude Code / Gemini / Codex? To już go masz.)

To klonuje najnowsze wydanie do `./career-ops` i instaluje zależności. Potem:

```bash
cd career-ops
claude   # or codex / qwen / opencode / agy / grok — open your AI CLI here
```

**Przy pierwszym uruchomieniu career-ops przeprowadza cię przez konfigurację (twoje CV, profil i docelowe role) po prostu w rozmowie. Nic do edytowania ręcznie.**

<details>
<summary><b>Wolisz skonfigurować ręcznie? (git clone)</b></summary>

```bash
git clone https://github.com/career-ops-hq/career-ops.git
cd career-ops && npm install
npx playwright install chromium   # only needed for PDF generation

# 2. Check setup
npm run doctor                     # Validates all prerequisites

# 3. Configure
cp config/profile.example.yml config/profile.yml  # Edit with your details
cp templates/portals.example.yml portals.yml       # Customize companies

# 4. Add your CV
# Create cv.md in the project root with your CV in markdown

# 5. Open your AI CLI in this directory
claude   # or codex / opencode / qwen / agy / grok

# Then ask your CLI to adapt the system to you:
# "Change the archetypes to backend engineering roles"
# "Translate the modes to English"
# "Add these 5 companies to portals.yml"
# "Update my profile with this CV I'm pasting"

# 6. Start using
# Paste a job URL or JD text to trigger auto-pipeline
# If your CLI supports slash commands, use /career-ops (or its CLI-specific alias)
# In Codex, ask for the same mode in plain language, e.g.:
# "Run the career-ops scan mode"
# "Run the career-ops pipeline mode for data/pipeline.md"
# "Run the career-ops pdf mode for the latest evaluated role"
# "Run the career-ops tracker mode and summarize the current statuses"
```

</details>

### Instalacja globalna

```bash
npm i -g @santifer/career-ops
```

To instaluje binarkę `career-ops` globalnie, więc możesz ją uruchamiać bezpośrednio zamiast przez `npx`. W odróżnieniu od `npx @santifer/career-ops init` (który tworzy katalog projektu), instalacja globalna daje ci stałą komendę `career-ops` dostępną wszędzie w terminalu.

**Której użyć?**
- `npx @santifer/career-ops init`: najlepsza na pierwszy raz; tworzy dedykowany folder projektu.
- `npm i -g @santifer/career-ops`: najlepsza, gdy masz już folder projektu i chcesz uruchamiać komendy career-ops bezpośrednio.

> **System jest zaprojektowany tak, by dostosowywało go samo twoje AI CLI.** Tryby, archetypy, wagi oceny, skrypty negocjacyjne: po prostu poproś, żeby je zmieniło. Czyta te same pliki, których używa, więc wie dokładnie, co edytować.

Zobacz [docs/SETUP.md](docs/SETUP.md) po pełny przewodnik konfiguracji, [docs/RUNNING_ON_A_BUDGET.md](docs/RUNNING_ON_A_BUDGET.md) po instrukcje taniego uruchamiania career-ops na własnych lub lokalnych modelach (i [docs/FREE_TIER.md](docs/FREE_TIER.md), by uruchomić go za darmo na darmowym planie Antigravity CLI), [docs/AUTOMATION.md](docs/AUTOMATION.md) po harmonogram cyklicznych skanów i przepis na selekcję do shortlisty bez tokenów, [docs/APPLY_AUTOFILL.md](docs/APPLY_AUTOFILL.md) po szczegóły autouzupełniania formularzy ATS, [docs/LINKEDIN_JOIN.md](docs/LINKEDIN_JOIN.md) po porównanie eksportu kontaktów z LinkedIn z firmami w twoim lejku, oraz [docs/FAQ.md](docs/FAQ.md) po odpowiedzi na częste pytania o konfigurację, w tym [jak pochodzenie historii zapobiega zmyślonym liczbom](docs/FAQ.md#why-does-career-ops-refuse-to-use-a-number-from-my-story-bank). Zasady projektowe są w [ARCHITECTURE.md](ARCHITECTURE.md); przepływy runtime w [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Integracja z Antigravity CLI

career-ops wspiera Antigravity CLI natywnie, tak samo jak Claude Code i OpenCode. Wszystkie komendy slash są dostępne przez wspólny punkt wejścia skilla, z tą samą logiką oceny z `modes/*.md`.

Google przeniósł konsumencki dostęp do Gemini CLI na Antigravity CLI. `GEMINI.md` jest teraz nieaktywną osłoną zgodności, żeby Antigravity nie duplikował pełnych instrukcji projektu, gdy czyta zarówno `AGENTS.md`, jak i `GEMINI.md`.

### Natywne Antigravity CLI

```bash
# 1. Run in the career-ops directory
cd career-ops
agy

# 2. Use the unified /career-ops command with subcommands:
/career-ops "Senior AI Engineer at Anthropic..."
/career-ops pipeline
/career-ops scan
/career-ops pdf
/career-ops tracker
```

Skill jest zdefiniowany według otwartego standardu w `.agents/skills/career-ops/SKILL.md` i podlinkowany lub wskazany dla każdego wspieranego CLI (np. `.claude/`, `.cursor/`, `.qwen/`, `.antigravitycli/`, `.grok/`).

## Integracja z Codex

career-ops wspiera Codex przez ten sam wspólny router, ale model wywołania różni się od CLI, które automatycznie rejestrują komendy slash. Pełny przewodnik: [docs/CODEX.md](docs/CODEX.md).

### Interaktywny Codex

```bash
cd career-ops
codex
```

Komendy slash nie są gwarantowane w Codex. Jeśli `/career-ops` jest niedostępne, poproś Codex o uruchomienie trybu bezpośrednio, prostym językiem:

```text
Evaluate this JD with career-ops auto-pipeline: https://company.com/jobs/123
Run the career-ops scan mode and summarize new matches.
Run the career-ops pipeline mode for data/pipeline.md.
Run the career-ops pdf mode for the latest evaluated role.
Run the career-ops tracker mode and summarize the current statuses.
```

### Codex jednorazowo (`codex exec`)

```bash
codex exec "Evaluate this JD with career-ops auto-pipeline: https://company.com/jobs/123"
codex exec "Run career-ops scan mode in this repo and summarize new matches."
codex exec "Run career-ops pipeline mode for data/pipeline.md."
codex exec "Run career-ops pdf mode for the latest evaluated role."
codex exec "Run career-ops tracker mode and summarize the current statuses."
```

## Integracja z Grok Build CLI

career-ops wspiera Grok Build CLI natywnie, tak samo jak Claude Code i OpenCode. `AGENTS.md` jest ładowany automatycznie jako reguły projektu, a wszystkie komendy slash są dostępne przez wspólny punkt wejścia skilla.

### Natywne Grok Build CLI

```bash
# 1. Run in the career-ops directory
cd career-ops
grok

# 2. Use the unified /career-ops command with subcommands:
/career-ops "Senior AI Engineer at Anthropic..."
/career-ops pipeline
/career-ops scan
/career-ops pdf
/career-ops tracker
```

Do headless workerów wsadowych użyj `grok -p "prompt"` (dodaj `--yolo`, by automatycznie zatwierdzać wykonania narzędzi).

### Samodzielny skrypt Gemini API (bez instalacji CLI)

```bash
# 1. Get a free API key at https://aistudio.google.com/apikey
cp .env.example .env
# Edit .env, set GEMINI_API_KEY=your_key_here

# 2. Install dependencies
npm install

# 3. Evaluate a job description
node gemini-eval.mjs "We are looking for a Senior AI Engineer..."
node gemini-eval.mjs --file ./jds/my-job.txt
node agent-inbox.mjs add "..."   # queue a request for the next session
npm run gemini:eval -- "JD text here"
```

> **Darmowy plan:** obie opcje działają bez rozliczeń. Natywne CLI używa Google OAuth; skrypt API używa `gemini-3.6-flash` (limity zapytań zależą od modelu i planu; aktualne kwoty w dokumentacji Google AI).

## Użycie

career-ops używa wspólnego routera komend. W CLI, które rejestrują komendy slash, wygląda to tak:

```
/career-ops           → Pokaż wszystkie dostępne komendy
/career-ops {JD}      → AUTO-PIPELINE: ocena + raport + PDF + tracker (wklej tekst lub URL)
/career-ops pipeline  → Przetwórz oczekujące URL-e ze skrzynki (data/pipeline.md)
/career-ops oferta    → Sama ocena, bloki A–G (bez automatycznego PDF)
/career-ops ofertas   → Porównaj i uszereguj wiele ofert
/career-ops contacto  → Mocny ruch na LinkedIn: znajdź kontakty + napisz szkic wiadomości
/career-ops deep      → Prompt do głębokiego researchu firmy
/career-ops interview-prep → Wygeneruj dokument przygotowania do rozmowy pod konkretną firmę
/career-ops interview    → Interaktywny wywiad wdrożeniowy o profilu i CV
/career-ops eu-swe    → Skalibruj europejską aplikację SWE przed CV, aplikacją lub rozmową
/career-ops eu-fintech → Przeskanuj 21 europejskich portali fintech pod role Product Managera (bez tokenów)
/career-ops interview/plan → Plan przygotowań w blokach czasowych na nadchodzącą rozmowę
/career-ops interview/practice → Rozmowa ćwiczeniowa, jedno pytanie na raz z feedbackiem
/career-ops interview/debrief → Podsumowanie po rozmowie: zamknij luki, przewidź następną rundę
/career-ops interview-redflag → Przeanalizuj sygnały ostrzegawcze pracodawcy przed dołączeniem do firmy
/career-ops pdf       → Tylko PDF, CV zoptymalizowane pod ATS
/career-ops text      → Dopasowane CV w markdown (odzwierciedla cv.md, bez PDF)
/career-ops latex     → Eksportuj CV jako LaTeX/Overleaf .tex
/career-ops latex-tex → Dopasuj własny resume.tex w miejscu (opt-in; cv.md pozostaje domyślne)
/career-ops cover     → List motywacyjny: samodzielnie wklejony opis lub /career-ops cover {slug}
/career-ops email     → Szkic formalnego maila aplikacyjnego (tylko szkic; nigdy nie wysyła, nie składa ani nie klika)
/career-ops add       → Dodaj projekt/publikację/rolę do CV (pobierz + podgląd + potwierdź)
/career-ops expand    → Automatycznie odkryj i dodaj brakujące kompetencje z linków w profilu
/career-ops training  → Oceń kurs/certyfikat względem North Star
/career-ops project   → Oceń pomysł na projekt do portfolio
/career-ops tracker   → Przegląd statusów aplikacji
/career-ops agent-inbox → Kolejkuj/opróżnij żądania na następną sesję (data/agent-inbox.md)
/career-ops apply     → Asystent aplikowania na żywo (czyta formularz + generuje odpowiedzi)
/career-ops scan      → Skanuj portale i odkrywaj nowe oferty
/career-ops discover  → Zamień listę firm na skanowalne tablice ATS + dopisz do portals.yml (bez tokenów)
/career-ops batch     → Przetwarzanie wsadowe z równoległymi workerami
/career-ops patterns  → Analizuj wzorce odrzuceń i popraw celowanie
/career-ops offer-prep → Przeczytaj otrzymaną ofertę/umowę z kandydatem: przejście po klauzulach + pytania do prawnika (to nie porada prawna)
/career-ops titles    → Zaproponuj pokrewne tytuły stanowisk z twojego CV, by poszerzyć poszukiwania
/career-ops upskill   → Zbiorcza analiza luk kompetencyjnych z ocenionych raportów
/career-ops followup  → Tracker rytmu follow-upów: oznacz zaległe, wygeneruj szkice
/career-ops reply-watch → Klasyfikuj odpowiedzi pracodawców i sugeruj aktualizacje trackera
/career-ops outcome   → Zapisz wynik aplikacji i zarchiwizuj artefakty
/career-ops calibrate → Raport doradczy: czy twoje oceny przewidują prawdziwe wyniki? Czyta dane /outcome; nigdy nie zmienia oceniania
/career-ops update    → Zaktualizuj pliki systemowe career-ops z podglądem diff + kontrolą zgodności
```

Albo po prostu wklej URL lub opis oferty: career-ops wykryje go automatycznie i uruchomi pełny pipeline.

W Codex komendy slash nie są gwarantowane. Użyj zamiast tego tych samych nazw trybów w promptcie albo wywołaj je z `codex exec`.

## Jak to działa

```
You paste a job URL or description
        │
        ▼
┌──────────────────┐
│  Archetype       │  Classifies: LLMOps / Agentic / PM / SA / FDE / Transformation
│  Detection       │
└────────┬─────────┘
         │
┌────────▼─────────┐
│  A-H Evaluation  │  Match, gaps, comp research, STAR stories, legitimacy
│  (reads cv.md)   │
└────────┬─────────┘
         │
    ┌────┼────┐
    ▼    ▼    ▼
 Report  PDF  Tracker
  .md   .pdf  entry
```

## Skonfigurowane portale

Skaner ma **100+ firm** gotowych do skanowania i **45+ zapytań wyszukiwania** po głównych portalach z ofertami. Skopiuj `templates/portals.example.yml` do `portals.yml` i dodaj własne:

**Laboratoria AI:** Anthropic, OpenAI, Mistral, Cohere, LangChain, Pinecone
**Voice AI:** ElevenLabs, PolyAI, Parloa, Hume AI, Deepgram, Vapi, Bland AI
**Platformy AI:** Retool, Airtable, Vercel, Temporal, Glean, Arize AI
**Contact center:** Ada, LivePerson, Sierra, Decagon, Talkdesk, Genesys
**Enterprise:** Salesforce, Twilio, Gong, Dialpad
**LLMOps:** Langfuse, Weights & Biases, Lindy, Cognigy, Speechmatics
**Automatyzacja:** n8n, Zapier, Make.com
**Europa:** Factorial, Attio, Tinybird, Clarity AI, Travelperk

**Przeszukiwane portale:** 55+ modułów dostawców obejmuje API ATS, feedy całych portali, feedy XML/RSS, feedy markdown i lokalne parsery. Pełna tabela: [Obsługiwane portale](docs/SUPPORTED_JOB_BOARDS.md).

Domyślnie `node scan.mjs` (czyli `npm run scan`) ufa temu, co zwraca każdy feed ATS. Niektóre firmy zostawiają nieaktualne ogłoszenia w publicznym API nawet po zamknięciu rekrutacji, więc te wygasłe wpisy mogą przeciec do `pipeline.md`. Przekaż `--verify`, by po przejściu API uruchomić Playwrighta i odrzucić wygasłe ogłoszenia, zanim trafią do pipeline'u:

```bash
node scan.mjs --verify          # zero-token discovery + Playwright liveness check
```

Weryfikacja jest sekwencyjna i dotyczy tylko nowych ofert (po deduplikacji), więc koszt pozostaje ograniczony.

### 🇵🇱 Polskie portale z ofertami pracy

career-ops obsługuje główne polskie portale IT. Dwa z nich — JustJoin.it i NoFluffJobs — mają publiczne API i mogą być zintegrowane jako źródła Level 0 (zero tokenów, brak WebSearch, świeże dane w czasie skanowania). Pozostałe portale wymagają weryfikacji ręcznej lub przez Playwright.

| Portal              | URL                                          | API        | Uwagi                                                                 |
| ------------------- | -------------------------------------------- | ---------- | --------------------------------------------------------------------- |
| **JustJoin.it**     | [justjoin.it](https://justjoin.it)           | Publiczne  | Największy portal IT w Polsce. JSON API z pełnymi danymi ofert        |
| **NoFluffJobs**     | [nofluffjobs.com](https://nofluffjobs.com)   | Publiczne  | Obowiązkowe widełki wynagrodzenia. Skierowany do seniorów             |
| **pracuj.pl**       | [pracuj.pl](https://pracuj.pl)               | Brak       | Największy ogólny portal. Blokuje boty (403) — weryfikacja ręczna     |
| **BulldogJob**      | [bulldogjob.pl](https://bulldogjob.pl)       | Brak       | IT-focused, oferty z widełkami                                        |
| **inhire.io**       | [inhire.io](https://inhire.io)               | Brak       | Headhunting IT, często oferty nieujawnione publicznie                 |
| **theprotocol.io**  | [theprotocol.io](https://theprotocol.io)     | Brak       | Dawny Rocket Jobs. Transparentne wynagrodzenia                        |
| **solid.jobs**      | [solid.jobs](https://solid.jobs)             | Brak       | Oferty z weryfikacją przez społeczność                                |

#### Polskie realia rynku pracy w ocenach

career-ops uwzględnia specyfikę polskiego rynku pracy przy ocenianiu ofert:

- **Forma zatrudnienia**: UoP (Umowa o pracę) vs B2B (Faktura VAT) vs UZ (Umowa zlecenie) — różnice w kwocie netto, bezpieczeństwie, urlopie i ZUS mają wpływ na ocenę stabilności
- **Wynagrodzenie**: brutto (przed podatkiem i ZUS) kontra netto (na rękę). Różnica bywa znaczna — system uwzględnia ją przy porównywaniu ofert
- **Benefity**: prywatna opieka medyczna (Medicover, LuxMed, Enel-Med), karta sportowa (MultiSport, OK System), Edenred / karta lunchowa, PPK
- **Urlop**: 20 dni przy stażu poniżej 10 lat, 26 dni przy stażu 10 lat i więcej (Kodeks pracy)
- **Praca zdalna**: pełny remote, hybryd (np. 2 dni/tydzień), model biurowy — system ocenia to w kontekście preferencji kandydata
- **Okres próbny**: do 3 miesięcy (6 miesięcy dla stanowisk kierowniczych zgodnie z KP)

## Dashboard TUI

Wbudowany dashboard terminalowy pozwala przeglądać pipeline wizualnie:

```bash
npm run serve:dashboard   # launch the TUI
npm run build:dashboard   # optional: build the standalone binary
```

Funkcje: 6 zakładek filtrów, 4 tryby sortowania, widok zgrupowany/płaski, podglądy ładowane leniwie, zmiany statusu w linii.

Jest też **eksperymentalny interfejs webowy** (alpha, opt-in: nic nie działa, dopóki go nie uruchomisz): zobacz [`web/README.md`](web/README.md).

## Struktura projektu

```
career-ops/
├── AGENTS.md                    # Canonical agent instructions (all CLIs)
├── CLAUDE.md                    # Claude Code wrapper (imports AGENTS.md)
├── CODEX.md                     # Codex wrapper (imports AGENTS.md)
├── OPENCODE.md                  # OpenCode wrapper (imports AGENTS.md)
├── GEMINI.md                    # Legacy no-op guard to avoid Antigravity duplicate context
├── cv.md                        # Your CV (create this)
├── article-digest.md            # Your proof points (optional)
├── config/
│   └── profile.example.yml      # Template for your profile
├── modes/                       # Skill modes
│   ├── _shared.md               # Shared context (customize this)
│   ├── oferta.md                # Single evaluation
│   ├── pdf.md                   # PDF generation
│   ├── cover.md                 # Cover letter generation
│   ├── email.md                 # Formal application email drafts
│   ├── scan.md                  # Portal scanner
│   ├── batch.md                 # Batch processing
│   └── ...
├── templates/
│   ├── cv-template.html         # ATS-optimized CV template
│   ├── portals.example.yml      # Scanner config template
│   └── states.yml               # Canonical statuses
├── batch/
│   ├── batch-prompt.md          # Self-contained worker prompt
│   └── batch-runner.sh          # Orchestrator script
├── dashboard/                   # Go TUI pipeline viewer
├── data/                        # Your tracking data (gitignored)
├── reports/                     # Evaluation reports (gitignored)
├── output/                      # Generated PDFs (gitignored)
├── fonts/                       # Space Grotesk + DM Sans
├── docs/                        # Setup, customization, budget guide, architecture
└── examples/                    # Sample CV, report, proof points
```

## Zewnętrzny katalog danych (opcjonalnie)

Domyślnie dane warstwy użytkownika (takie jak `cv.md`, `portals.yml` oraz foldery `data/`, `reports/`, `output/`) żyją w folderze głównym projektu.

Aby oddzielić dane osobiste od kodu (łatwiej przełączać gałęzie, pobierać aktualizacje lub testować kilka profili), możesz skonfigurować zewnętrzny katalog danych według następującego pierwszeństwa:

1. **Zmienne środowiskowe:** ustaw zmienną `CAREER_OPS_ROOT` lub `CAREER_OPS_DATA_DIR`:
   ```bash
   export CAREER_OPS_ROOT=~/my-career-data
   ```
2. **Plik znacznika:** utwórz plik `.career-ops-data` w katalogu głównym repozytorium ze ścieżką do katalogu danych.
3. **Domyślnie:** katalog główny repozytorium.

Po rozwiązaniu wszystkie pliki użytkownika są rozwiązywane i zapisywane względem tego folderu, a pliki promptów i skrypty nadal względem repozytorium.

- **Nadpisanie trackera:** możesz też ustawić `CAREER_OPS_TRACKER`, by bezpośrednio wskazać ścieżkę pliku trackera aplikacji.
- **Zapisy:** wszystkie operacje zapisu (np. scalanie) kanonicznie trafiają do `{DATA_ROOT}/data/applications.md`.

Dashboard TUI w Go, skrypty Node.js i tryby agenta AI automatycznie respektują tę hierarchię.


## Stack technologiczny

![Claude Code](https://img.shields.io/badge/Claude_Code-000?style=flat&logo=anthropic&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-2EAD33?style=flat&logo=playwright&logoColor=white)
![Go](https://img.shields.io/badge/Go-00ADD8?style=flat&logo=go&logoColor=white)
![Bubble Tea](https://img.shields.io/badge/Bubble_Tea-FF75B5?style=flat&logo=go&logoColor=white)

- **Agent**: AI CLI do kodowania ze wspólnymi skillami i trybami (`AGENTS.md` + wrapper dla CLI)
- **PDF**: Playwright + szablon HTML
- **Listy motywacyjne**: szablon HTML + Playwright (PDF A4, ten sam pipeline co CV)
- **Skaner**: Playwright + Greenhouse API + WebSearch
- **Dashboard**: Go + Bubble Tea + Lipgloss (motyw Catppuccin Mocha)
- **Dane**: tabele Markdown + konfiguracja YAML + pliki wsadowe TSV

## Również open source

- **[cv-santiago](https://github.com/santifer/cv-santiago)**: strona portfolio (santifer.io) z chatbotem AI, dashboardem LLMOps i case studies. Jeśli potrzebujesz portfolio do pokazania przy poszukiwaniu pracy, zforkuj je i zrób swoim.

## FAQ

**Czym jest career-ops?**
career-ops to open source'owe wyszukiwanie pracy z AI, które działa lokalnie w twoim AI CLI (Claude Code, Codex, OpenCode i inne) i zostawia każdą decyzję tobie. Ocenia oferty względem twojego CV, generuje PDF-y dopasowane pod ATS, znajduje właściwą osobę do kontaktu i śledzi wszystko w jednym miejscu: ostatnie słowo zawsze należy do ciebie. To pierwsza referencyjna implementacja Manifestu CareerOps. Więcej na [career-ops.org](https://career-ops.org).

**Czy dopasowane CV może coś zmyślić?**
Nie wolno mu, i prompty to mówią: przeredagować, nigdy nie zmyślać. Ta zasada nie jest jeszcze wymuszana kontrolą w kodzie. Śledzą to dwa otwarte issues: [#2677](https://github.com/career-ops-hq/career-ops/issues/2677) (nazwy stanowisk muszą zgadzać się z cv.md) i [#1411](https://github.com/career-ops-hq/career-ops/issues/1411) (kontrola wierności blokująca przy niezgodności). Dopóki nie zostaną zmergowane, czytaj każde CV przed wysłaniem. [Zastrzeżenie prawne](LEGAL_DISCLAIMER.md) mówi to samo dłużej.

**Czy mogę uruchamiać career-ops za darmo albo na tańszym / lokalnym modelu?**
Tak. career-ops jest niezależny od CLI i działa na darmowych i lokalnych modelach (darmowe modele OpenRouter, Ollama lub dowolny endpoint zgodny z OpenAI), więc nie jesteś przywiązany do płatnej subskrypcji. Pełna konfiguracja: [docs/RUNNING_ON_A_BUDGET.md](docs/RUNNING_ON_A_BUDGET.md).

**Płacę za Claude Pro/Max, ale career-ops zużywa kredyty API. Dlaczego?**
Bo `ANTHROPIC_API_KEY` w twoim środowisku ma pierwszeństwo przed zalogowaną subskrypcją: CLI używa klucza i rozlicza per token. Uruchom `echo $ANTHROPIC_API_KEY`, a jeśli coś wypisze, usuń go z profilu powłoki, zrestartuj terminal i uruchom `/login`. Tryb wsadowy jest wyjątkiem, bo workery `claude -p` nie używają interaktywnego logowania: uruchom raz `claude setup-token` i wyeksportuj wynik jako `CLAUDE_CODE_OAUTH_TOKEN`. Pełna instrukcja w [docs/RUNNING_ON_A_BUDGET.md](docs/RUNNING_ON_A_BUDGET.md#2b-already-paying-for-a-subscription-make-sure-you-are-using-it).

**Z jakimi AI CLI działa career-ops?**
career-ops działa z każdym głównym AI CLI do kodowania (Claude Code, Codex, Gemini / Antigravity, OpenCode, Grok, Qwen i inne) przez otwarty Agent Skill Standard, więc nigdy nie jest przywiązany do jednego dostawcy. Użyj CLI, które już masz.

**Jak zainstalować career-ops na Windows?**
career-ops działa na Windows. Konfiguracja specyficzna dla platformy i znane pułapki (wykrywanie Git Bash, końce linii, Harmonogram zadań) są w [docs/WINDOWS.md](docs/WINDOWS.md). Jeśli skille nie ładują się z błędem symlinka podczas instalacji, rozwiązanie jest w [docs/FAQ.md](docs/FAQ.md). Pełne kroki w [docs/SETUP.md](docs/SETUP.md).

**Czy career-ops aplikuje na oferty za mnie?**
Nie. career-ops to filtr, a nie narzędzie do masowego automatycznego aplikowania. AI ocenia, szereguje i pisze szkice; ty sprawdzasz i decydujesz. Nigdy nie składa, nie wysyła ani nie klika niczego: ostatnie słowo zawsze należy do ciebie. Właśnie o to chodzi w projekcie z człowiekiem w pętli.

**Czy career-ops jest darmowy i open source?**
Tak. career-ops jest darmowy i open source, i dla kandydata zawsze taki będzie: to pierwsza referencyjna implementacja [Manifestu CareerOps](https://career-ops.org/manifesto). Przeczytaj go, a jeśli mówi to, w co wierzysz, podpisz.

## O autorze

Jestem [Santiago Fernández de Valderrama Aparicio](https://santifer.io/about) (santifer): Head of Applied AI, były założyciel (zbudowałem i sprzedałem firmę, która nadal działa pod moim nazwiskiem). Zbudowałem career-ops, żeby zarządzać własnym poszukiwaniem pracy. Zadziałało: użyłem go, by dostać swoje obecne stanowisko.

Ciekawi cię, jak to repozytorium jest utrzymywane w około 4 godziny tygodniowo? Przeczytaj [Agentic maintenance: how career-ops is run by a fleet of AI agents](https://santifer.io/ai-agent-fleet).

Moje portfolio i inne projekty open source → [santifer.io](https://santifer.io)

Wikidata: [Santiago Fernández de Valderrama Aparicio](https://www.wikidata.org/wiki/Q138710224) · [career-ops](https://www.wikidata.org/wiki/Q139007988).

## Zastrzeżenie prawne

**career-ops to lokalne narzędzie open source, NIE usługa hostowana.** Używając tego oprogramowania, przyjmujesz do wiadomości, że:

1. **Ty kontrolujesz swoje dane.** Twoje CV, dane kontaktowe i dane osobowe zostają na twojej maszynie i są wysyłane bezpośrednio do wybranego przez ciebie dostawcy AI (Anthropic, OpenAI itd.). Nie zbieramy, nie przechowujemy ani nie mamy dostępu do żadnych twoich danych.
2. **Ty kontrolujesz AI.** Domyślne prompty instruują AI, by nie wysyłało aplikacji automatycznie, ale modele AI mogą zachowywać się nieprzewidywalnie. Jeśli modyfikujesz prompty lub używasz innych modeli, robisz to na własne ryzyko. **Zawsze sprawdzaj poprawność treści wygenerowanych przez AI przed wysłaniem.**
3. **Ty przestrzegasz regulaminów stron trzecich.** Musisz używać tego narzędzia zgodnie z regulaminami portali kariery, z którymi wchodzisz w interakcję (Greenhouse, Lever, Workday, LinkedIn itd.). Nie używaj tego narzędzia do spamowania pracodawców ani przeciążania systemów ATS.
4. **Brak gwarancji.** Oceny to rekomendacje, nie prawda. Modele AI mogą halucynować umiejętności lub doświadczenie. Autorzy nie ponoszą odpowiedzialności za wyniki zatrudnienia, odrzucone aplikacje, ograniczenia kont ani żadne inne konsekwencje.

Zobacz [LEGAL_DISCLAIMER.md](LEGAL_DISCLAIMER.md) po pełne szczegóły. To oprogramowanie jest dostarczane na [licencji MIT](LICENSE) „tak jak jest", bez jakiejkolwiek gwarancji.

## Współtwórcy

<a href="https://github.com/career-ops-hq/career-ops/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=career-ops-hq/career-ops" />
</a>

Każda osoba, która dostarczyła kod, dokumentację, tłumaczenia lub testy, jest wymieniona w
[CONTRIBUTORS.md](CONTRIBUTORS.md), łącznie z wkładem niekodowym, którego
powyższy graf nie może pokazać.

Dostałeś pracę dzięki career-ops? [Podziel się swoją historią!](https://github.com/career-ops-hq/career-ops/issues/new?template=i-got-hired.yml)

## Licencja i znak towarowy

Kod jest na licencji [MIT](LICENSE). Nazwa i marka
„career-ops" podlegają [Polityce znaku towarowego](TRADEMARK.md): liberalnej
dla użytku społeczności, zastrzeżonej dla nazewnictwa produktów komercyjnych
i rekomendacji.

## Wyróżnienia

<p align="center">
  <a href="https://warpchart.dev/hq">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://warpchart.dev/api/chart?theme=dark&v=3">
      <img alt="Live star telemetry of career-ops-hq/career-ops" src="https://warpchart.dev/api/chart?theme=light&v=3" loading="lazy">
    </picture>
  </a>
</p>

<p align="center">
  <a href="https://discord.gg/8pRpHETxa4"><img src="https://img.shields.io/badge/Join_the_community-Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord"></a>
</p>

<p align="center">
  <a href="https://github.com/career-ops-hq/career-ops/releases/latest"><img src="https://img.shields.io/npm/v/%40santifer%2Fcareer-ops?style=for-the-badge&labelColor=2b3137&color=2ea44f&label=release" alt="Latest release"></a>
</p>

<p align="center">
  <a href="https://claude.com/claude-code"><img src="https://img.shields.io/badge/Built_with-Claude_Code-000?style=for-the-badge&logo=anthropic&logoColor=white" alt="Built with Claude Code"></a>
</p>

<p align="center">
  <sub>Działa też w każdym CLI zgodnym ze standardem agent-skill. Zobacz <a href="docs/SUPPORTED_CLIS.md">Obsługiwane CLI</a>.</sub><br>
  <img src="https://img.shields.io/badge/Claude_Code-000?style=flat&logo=anthropic&logoColor=white" alt="Claude Code">
  <img src="https://img.shields.io/badge/OpenCode-111827?style=flat&logo=terminal&logoColor=white" alt="OpenCode">
  <img src="https://img.shields.io/badge/Antigravity_CLI-4285F4?style=flat&logo=google&logoColor=white" alt="Antigravity CLI">
  <img src="https://img.shields.io/badge/Codex-412991?style=flat&logo=openai&logoColor=white" alt="Codex">
  <img src="https://img.shields.io/badge/Qwen-615CED?style=flat" alt="Qwen">
  <img src="https://img.shields.io/badge/Kimi-FF4B4B?style=flat" alt="Kimi">
  <img src="https://img.shields.io/badge/GitHub_Copilot-000?style=flat&logo=githubcopilot&logoColor=white" alt="GitHub Copilot">
  <img src="https://img.shields.io/badge/Grok_Build_CLI-000?style=flat&logo=x&logoColor=white" alt="Grok Build CLI">
  <br>
  <img src="https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/Go-00ADD8?style=flat&logo=go&logoColor=white" alt="Go">
  <img src="https://img.shields.io/badge/Playwright-2EAD33?style=flat&logo=playwright&logoColor=white" alt="Playwright">
  <img src="https://img.shields.io/badge/Bubble_Tea-FF75B5?style=flat&logo=go&logoColor=white" alt="Bubble Tea">
  <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT">
  <a href="TRADEMARK.md"><img src="https://img.shields.io/badge/Trademark-Policy-blue.svg" alt="Trademark Policy"></a>
</p>

## Bądźmy w kontakcie

[![Website](https://img.shields.io/badge/santifer.io-000?style=for-the-badge&logo=safari&logoColor=white)](https://santifer.io)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white)](https://linkedin.com/in/santifer)
[![X](https://img.shields.io/badge/X-000?style=for-the-badge&logo=x&logoColor=white)](https://x.com/santifer)
[![Discord](https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/8pRpHETxa4)
[![Email](https://img.shields.io/badge/Email-EA4335?style=for-the-badge&logo=gmail&logoColor=white)](mailto:hi@santifer.io)
