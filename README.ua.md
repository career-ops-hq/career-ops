<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/wordmark-dark.svg"><img src="docs/wordmark-light.svg" alt="career-ops" width="250" height="56"></picture></p>

<p align="center">
  <em>Я провів місяці у пошуках роботи, роблячи все самотужки. Тому я створив систему, яку хотів би мати з самого початку.</em><br>
  Компанії використовують AI для фільтрації кандидатів. <strong>Я дав кандидатам AI, щоб вони могли <em>вибирати</em> компанії.</strong><br>
  Оцінює, ранжує і готує чернетки. <strong>Ніколи не надсилає: надсилаєте ви.</strong> Відкритий код, локально, ваше.
</p>

<p align="center">
  <a href="https://x.com/santifer/status/2041403685696053741"><img src="docs/demo.gif" alt="конвеєр career-ops: вакансії з оцінками, 219 позначено як не подаватися, потім одна повна оцінка" width="800"></a>
</p>

<p align="center"><sub>Знімок посеред пошуку: конвеєр, потім одна вакансія відкрита й оцінена від початку до кінця.</sub></p>

<p align="center"><strong>Із 740 вакансій подаватися було варто на 68. 12 співбесід. 1 офер.</strong></p>
<p align="center"><sub>Один пошук, авторський, 2026. Важлива цифра: відсів, а не кількість. Усі цифри в <a href="https://santifer.io/career-ops-system">кейс-стаді</a>.</sub></p>

<p align="center"><sub>Ніколи не надсилає, не шле листів, не дзвонить додому: <a href="#чого-career-ops-не-робить">чого воно не робить</a> · працює в AI CLI, яким ви вже користуєтеся, <a href="docs/RUNNING_ON_A_BUDGET.md">безкоштовні та локальні моделі теж</a>.</sub></p>

<details>
<summary>Читати 17 мовами</summary>
<div align="center">

[English](README.md) | [Español](README.es.md) | [Deutsch](README.de.md) | [Français](README.fr.md) | [Português (Brasil)](README.pt-BR.md) | [한국어](README.ko-KR.md) | [日本語](README.ja.md) | [简体中文](README.cn.md) | [繁體中文](README.zh-TW.md) | [Українська](README.ua.md) | [Русский](README.ru.md) | [Polski](README.pl.md) | [Dansk](README.da.md) | [தமிழ்](README.ta.md) | [العربية](README.ar.md) | [हिन्दी](README.hi.md) | [Türkçe](README.tr.md)

</div>
</details>

<hr>

<p align="center">
  <a href="HIRED.md"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fsantifer%2Fcareer-ops%2Fmain%2Fdocs%2Fhired-count.json&query=%24.count&label=%F0%9F%8E%89%20HIRED%20WITH%20CAREER-OPS&suffix=%20verified&color=2ea44f&style=for-the-badge&labelColor=2b3137" alt="Найняті з career-ops: перевірена кількість"></a>
</p>

<p align="center"><sub>Отримали свою роботу? <a href="https://github.com/career-ops-hq/career-ops/issues/new?template=i-got-hired.yml">Поділіться →</a> · ваша картка покаже комусь посеред пошуку, що вихід є.</sub></p>

<p align="center">
  <a href="HIRED.md"><img src="docs/hired-wall.svg" alt="Три найновіші історії працевлаштування" width="800"></a>
</p>

<p align="center"><sub>Кожна цифра є публічною історією, яку можна <a href="HIRED.md">перевірити →</a> · кожна з них почалася там, де ви зараз.</sub></p>

<p align="center"><sub>ПРО НАС ПИСАЛИ</sub></p>

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

<p align="center"><sub>Створив і підтримує <a href="https://santifer.io">Santiago Fernández de Valderrama Aparicio</a> (<a href="https://github.com/santifer">@santifer</a>)</sub></p>

## Що це таке

career-ops ([career-ops.org](https://career-ops.org), також відомий як **careerops**) є AI-пошуком роботи з відкритим кодом, який працює локально всередині будь-якого AI-кодинг CLI: він оцінює вакансії, адаптує ваше резюме і відстежує кожну заявку, а останнє слово завжди за вами. Замість ручного відстеження заявок у таблиці ви отримуєте AI-конвеєр, який:

- **Оцінює вакансії** у структурованому звіті: блоки від A до H із загальною оцінкою від 1 до 5, що виводиться цілісним судженням за п'ятьма вимірами, а не арифметичною формулою. Колонка важливості кожної вимоги в блоці B і оцінка легітимності вакансії в блоці G є окремими сигналами, нейтральними до оцінки, і ніколи на неї не впливають; блок H складається лише від 4.5 і вище
- **Генерує персоналізовані PDF**: ATS-оптимізовані резюме під кожен опис вакансії
- **Сканує портали** автоматично (Greenhouse, Ashby, Lever, сторінки компаній)
- **Обробляє пакетно**: оцінка 10+ вакансій паралельно суб-агентами
- **Відстежує все** в єдиному джерелі даних із перевіркою цілісності
- **Досліджує компанії та знаходить потрібну людину для контакту**: заявка ставить вас у чергу, дослідження дає вам розмову

> **Важливо: це НЕ інструмент для масової розсилки.** career-ops є фільтром: він допомагає знайти серед сотень вакансій ті кілька, що варті вашого часу. Система наполегливо рекомендує не подаватися на будь-що з оцінкою нижче 4.0/5. Ваш час цінний, як і час рекрутера. Завжди перевіряйте перед надсиланням.

career-ops працює агентно: обраний вами AI-кодинг CLI переходить на кар'єрні сторінки за допомогою Playwright, оцінює відповідність, аналізуючи ваше резюме відносно опису вакансії (не за ключовими словами), та адаптує ваше резюме під кожну вакансію.

> **Зверніть увагу: перші оцінки будуть не ідеальними.** Система ще не знає вас. Дайте їй контекст: ваше резюме, вашу кар'єрну історію, ваші досягнення, уподобання, сильні сторони, чого хочете уникати. Чим більше ви її наповнюєте, тим краще вона працює. Сприймайте це як онбординг нового рекрутера: першого тижня йому треба вас вивчити, а потім він стає незамінним.

Зробив той, хто оцінив із ним 740 вакансій, подався на 68 і отримав посаду Head of Applied AI. [Читати повне кейс-стаді](https://santifer.io/career-ops-system).

## Чого career-ops не робить

- **Не надсилає заявку.** Готує відповіді; ви відкриваєте форму і натискаєте Надіслати. Скрипт ніколи не робить POST (`prepare-application.mjs`).
- **Не надсилає листи.** Лише чернетки. У всьому коді немає жодного поштового транспорту.
- **Не дзвонить додому.** Без телеметрії, без нашого бекенду. Ваше резюме йде з вашої машини до обраного вами AI-провайдера і більше нікуди. Єдиний публічний реєстр: цей репозиторій, `HIRED.md` та його issues.
- **Не штовхає подаватися нижче 4.0/5.** Скаже не робити цього. Ви можете проігнорувати, і воно про це скаже.

Воно переформульовує ваше резюме; вигадувати не має права ніколи. Сьогодні це правило живе в промптах, ще не в примусовій перевірці в коді. Читайте кожне резюме перед відправкою. Деталі у [FAQ](#faq).

## Маніфест CareerOps

career-ops є першою еталонною реалізацією [Маніфесту CareerOps](https://career-ops.org/manifesto?utm_source=readme). прочитайте його. якщо він каже те, у що ви вірите, підпишіть. ваш підпис стає комітом.

## Що система вміє

| Функція                  | Опис                                                                                                                                     |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Авто-конвеєр**         | Вставте URL і отримайте повну оцінку + PDF + запис у трекері                                                                             |
| **Оцінка A-H**           | Резюме ролі, відповідність резюме (з вагою кожної вимоги для цієї вакансії та позначкою, чи взято вагу з формулювання опису, його структури чи з оцінки; підписано для кожної вимоги, і оцінка ніколи не може бути найвищого рівня), стратегія рівня, дослідження компенсації, персоналізація, підготовка до співбесіди (STAR+R), плюс перевірка легітимності вакансії в блоці G, що позначає шахрайство та фейкові вакансії, і сигнал дозволу на роботу, що позначає опис із явною відмовою у спонсорстві візи як жорсткий блокер |
| **Банк історій для співбесід** | Накопичує історії STAR+Reflection між оцінками: 5-10 головних історій, що відповідають на будь-яке поведінкове питання             |
| **Скрипти переговорів**  | Фреймворки переговорів про зарплату, відповідь на географічну знижку, важіль конкурентних оферів                                          |
| **Генерація ATS PDF**    | Резюме з ключовими словами у дизайні Space Grotesk + DM Sans                                                                              |
| **Генератор супровідних листів** | Супровідні листи на основі дослідження з віддзеркаленням ключових слів, чотирма інтерактивними запитаннями про кут подачі (чому/проблеми/підхід/тон), затвердженням чернетки в чаті та A4 PDF через той самий конвеєр HTML + Playwright, що й для резюме. Готує чернетку при кожній оцінці; завершити й згенерувати на вимогу через `/career-ops cover` |
| **Чернетки листів-заявок** | Формальні листи рекрутеру, за рекомендацією або холодні заявки зі звіту чи вставленого опису, з темою, чеклістом вкладень, обґрунтованими пунктами відповідності та блоком контактів із профілю. Лише чернетки: career-ops ніколи не надсилає, не подає і не клікає нічого. |
| **Сканер порталів**      | 100+ попередньо налаштованих компаній (Anthropic, OpenAI, ElevenLabs, Retool, n8n...) + власні запити по Ashby, Greenhouse, Lever, Wellfound |
| **Пошук профінансованих компаній** | Команда `company:funded` (спершу перегляд) показує компанії з нещодавнім фінансуванням і діагностику джерел зі структурованих публічних стрічок, не змінюючи ваші дані |
| **Пакетна обробка**      | Паралельна оцінка headless CLI-воркерами (`claude -p` / `opencode run`)                                                                 |
| **Dashboard TUI**        | Термінальний інтерфейс для перегляду, фільтрації та сортування вашого конвеєра                                                           |
| **Human-in-the-Loop**    | AI оцінює та рекомендує, ви вирішуєте та дієте. Система ніколи не подає заявку: останнє слово завжди за вами <!-- hitl: absolute guarantee. Do not add "automatically", "by itself", "without your permission" or any other hedge when translating this row. -->               |
| **Цілісність конвеєра**  | Автоматичне злиття, дедуплікація, нормалізація статусів, перевірки стану                                                                 |
| **Набір для співбесід**  | Плани підготовки за часовими блоками, тренувальні сесії зі зворотним зв'язком, розбори після співбесіди ([`interview/`](modes/interview/README.md)) і детектор тривожних ознак компанії ([`interview-redflag`](modes/interview-redflag.md)) |
| **Етап оферу**           | Супровід читання контракту: прохід по пунктах плюс список питань для юриста ([`offer-prep`](modes/offer-prep.md)), і аналізатор розриву між бажаною, заявленою та фактичною зарплатою (`salary-gap.mjs`) |
| **Фоллоу-апи та відповіді** | Калькулятор ритму фоллоу-апів і заготовлені нагадування (`followup-cadence.mjs`, `followup-seed.mjs`); класифікація відповідей роботодавця в оновлення трекера ([`reply-watch`](modes/reply-watch.md)) |
| **Аналіз патернів**      | Патерни відмов і частка проходження по каналах ATS (`analyze-patterns.mjs`), статистика воронки за весь пошук (`stats.mjs`), виявлення перепублікацій і фейкових вакансій (`detect-reposts.mjs`) |
| **Система плагінів**     | Опціональні інтеграції (Gmail, Notion, Apify + реєстр спільноти), вимкнені за замовчуванням; див. [docs/PLUGINS.md](docs/PLUGINS.md)      |
| **Поза межами резюме**   | Дослідження компанії ([`deep`](modes/deep.md)) розкриває AI-стратегію, нещодавні кроки, інженерну культуру та кут, під яким варто подати ваш профіль. Пошук контактів ([`contacto`](modes/contacto.md)) визначає hiring-менеджера, рекрутера або колегу з команди, до кого варто звернутися, і готує повідомлення для LinkedIn до 300 символів під кожен тип контакту. Чернетки формальних листів-заявок ([`email`](modes/email.md)) перетворюють оцінений звіт або вставлений опис на тему, текст і чекліст вкладень, нічого не надсилаючи, не подаючи і не клікаючи. Заявка ставить вас у чергу, дослідження дає вам розмову. |

## Швидкий старт

**Найшвидший шлях: одна команда:**

```bash
npx @santifer/career-ops init
```

> 💡 `npx` іде разом із [Node.js](https://nodejs.org): він запускає інсталятор один раз,
> нічого не встановлюючи глобально. Ще немає Node? Спершу встановіть його.
> (Уже користуєтеся CLI Claude Code / Gemini / Codex? Тоді він у вас уже є.)

Це клонує останній реліз у `./career-ops` і встановлює залежності. Потім:

```bash
cd career-ops
claude   # or codex / qwen / opencode / agy / grok — open your AI CLI here
```

**При першому запуску career-ops проведе вас через налаштування (ваше резюме, профіль і цільові ролі) просто в розмові. Нічого не треба редагувати вручну.**

<details>
<summary><b>Хочете налаштувати вручну? (git clone)</b></summary>

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

### Глобальне встановлення

```bash
npm i -g @santifer/career-ops
```

Це встановлює бінарник `career-ops` глобально, тож ви можете запускати його напряму, а не через `npx`. На відміну від `npx @santifer/career-ops init` (який створює каталог проєкту), глобальне встановлення дає постійну команду `career-ops`, доступну будь-де у вашому терміналі.

**Що обрати?**
- `npx @santifer/career-ops init`: найкраще для першого запуску; створює окрему теку проєкту.
- `npm i -g @santifer/career-ops`: найкраще, коли тека проєкту вже є і ви хочете запускати команди career-ops напряму.

> **Система спроєктована так, щоб її налаштовував сам ваш AI-кодинг CLI.** Режими, архетипи, ваги оцінювання, скрипти переговорів: просто попросіть його змінити їх. Він читає ті самі файли, якими користується, тож точно знає, що редагувати.

Дивіться [docs/SETUP.md](docs/SETUP.md) для повного посібника з налаштування, [docs/RUNNING_ON_A_BUDGET.md](docs/RUNNING_ON_A_BUDGET.md) для дешевого запуску career-ops на власних або локальних моделях (і [docs/FREE_TIER.md](docs/FREE_TIER.md) для запуску без витрат на безкоштовному тарифі Antigravity CLI), [docs/AUTOMATION.md](docs/AUTOMATION.md) для планування регулярних сканувань і рецепту відбору в шортліст без витрат токенів, [docs/APPLY_AUTOFILL.md](docs/APPLY_AUTOFILL.md) для деталей автозаповнення форм ATS, [docs/LINKEDIN_JOIN.md](docs/LINKEDIN_JOIN.md) для звірки експорту ваших контактів LinkedIn з компаніями у вашій воронці, та [docs/FAQ.md](docs/FAQ.md) для відповідей на типові питання з налаштування, зокрема [як походження історій запобігає вигаданим цифрам](docs/FAQ.md#why-does-career-ops-refuse-to-use-a-number-from-my-story-bank). Принципи дизайну в [ARCHITECTURE.md](ARCHITECTURE.md); потоки виконання в [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Інтеграція з Antigravity CLI

career-ops підтримує Antigravity CLI нативно, так само як Claude Code і OpenCode. Усі слеш-команди доступні через спільну точку входу скілу з тією самою логікою оцінювання з `modes/*.md`.

Google перевів доступ споживачів до Gemini CLI на Antigravity CLI. `GEMINI.md` тепер є бездієвим запобіжником сумісності, щоб Antigravity не дублював повні інструкції проєкту, читаючи і `AGENTS.md`, і `GEMINI.md`.

### Нативний Antigravity CLI

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

Скіл визначено за відкритим стандартом у `.agents/skills/career-ops/SKILL.md` і підключено символічним посиланням або посиланням для кожного підтримуваного CLI (наприклад `.claude/`, `.cursor/`, `.qwen/`, `.antigravitycli/`, `.grok/`).

## Інтеграція з Codex

career-ops підтримує Codex через той самий спільний роутер, але модель виклику відрізняється від CLI, які автоматично реєструють слеш-команди. Повний посібник: [docs/CODEX.md](docs/CODEX.md).

### Інтерактивний Codex

```bash
cd career-ops
codex
```

Слеш-команди в Codex не гарантовані. Якщо `/career-ops` недоступна, попросіть Codex запустити режим напряму простою мовою:

```text
Evaluate this JD with career-ops auto-pipeline: https://company.com/jobs/123
Run the career-ops scan mode and summarize new matches.
Run the career-ops pipeline mode for data/pipeline.md.
Run the career-ops pdf mode for the latest evaluated role.
Run the career-ops tracker mode and summarize the current statuses.
```

### Codex одним викликом (`codex exec`)

```bash
codex exec "Evaluate this JD with career-ops auto-pipeline: https://company.com/jobs/123"
codex exec "Run career-ops scan mode in this repo and summarize new matches."
codex exec "Run career-ops pipeline mode for data/pipeline.md."
codex exec "Run career-ops pdf mode for the latest evaluated role."
codex exec "Run career-ops tracker mode and summarize the current statuses."
```

## Інтеграція з Grok Build CLI

career-ops підтримує Grok Build CLI нативно, так само як Claude Code і OpenCode. `AGENTS.md` автоматично завантажується як правила проєкту, а всі слеш-команди доступні через спільну точку входу скілу.

### Нативний Grok Build CLI

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

Для headless пакетних воркерів використовуйте `grok -p "prompt"` (додайте `--yolo`, щоб автоматично схвалювати виконання інструментів).

### Окремий скрипт для Gemini API (без встановлення CLI)

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

> **Безкоштовний тариф:** обидва варіанти працюють без оплати. Нативний CLI використовує Google OAuth; скрипт API використовує `gemini-3.6-flash` (ліміти запитів залежать від моделі та тарифу; актуальні квоти дивіться в документації Google AI).

## Використання

career-ops використовує спільний роутер команд. У CLI, які реєструють слеш-команди, це виглядає так:

```
/career-ops           → Показати всі доступні команди
/career-ops {JD}      → АВТО-КОНВЕЄР: оцінка + звіт + PDF + трекер (вставте текст або URL)
/career-ops pipeline  → Обробити відкладені URL із вхідних (data/pipeline.md)
/career-ops oferta    → Лише оцінка, блоки A–G (без автоматичного PDF)
/career-ops ofertas   → Порівняти й ранжувати кілька вакансій
/career-ops contacto  → Хід конем у LinkedIn: знайти контакти + підготувати повідомлення
/career-ops deep      → Промпт глибокого дослідження компанії
/career-ops interview-prep → Згенерувати документ підготовки до співбесіди під конкретну компанію
/career-ops interview    → Інтерактивне онбординг-інтерв'ю для профілю та резюме
/career-ops eu-swe    → Відкалібрувати європейську заявку SWE перед резюме, поданням або співбесідою
/career-ops eu-fintech → Просканувати 21 європейський фінтех-портал на ролі Product Manager (без токенів)
/career-ops interview/plan → План підготовки за часовими блоками до майбутньої співбесіди
/career-ops interview/practice → Тренувальна співбесіда, по одному питанню зі зворотним зв'язком
/career-ops interview/debrief → Розбір після співбесіди: закрити прогалини, передбачити наступний раунд
/career-ops interview-redflag → Проаналізувати тривожні ознаки роботодавця перед виходом на роботу
/career-ops pdf       → Лише PDF, ATS-оптимізоване резюме
/career-ops text      → Адаптоване резюме в markdown (віддзеркалює cv.md, без PDF)
/career-ops latex     → Експорт резюме в LaTeX/Overleaf .tex
/career-ops latex-tex → Адаптувати власний resume.tex на місці (опційно; cv.md лишається за замовчуванням)
/career-ops cover     → Супровідний лист: окремо вставлений опис або /career-ops cover {slug}
/career-ops email     → Чернетка формального листа-заявки (лише чернетка; ніколи не надсилає, не подає і не клікає)
/career-ops add       → Додати проєкт/статтю/роль до резюме (завантажити + переглянути + підтвердити)
/career-ops expand    → Автоматично знайти й додати відсутні компетенції з посилань профілю
/career-ops training  → Оцінити курс/сертифікат відносно North Star
/career-ops project   → Оцінити ідею проєкту для портфоліо
/career-ops tracker   → Огляд статусів заявок
/career-ops agent-inbox → Поставити в чергу/розібрати запити для наступної сесії (data/agent-inbox.md)
/career-ops apply     → Живий помічник подання (читає форму + генерує відповіді)
/career-ops scan      → Просканувати портали та знайти нові вакансії
/career-ops discover  → Перетворити список компаній на скановані ATS-дошки + додати до portals.yml (без токенів)
/career-ops batch     → Пакетна обробка паралельними воркерами
/career-ops patterns  → Проаналізувати патерни відмов і покращити націлювання
/career-ops offer-prep → Прочитати отриманий офер/контракт разом із кандидатом: прохід по пунктах + питання для юриста (не юридична порада)
/career-ops titles    → Запропонувати суміжні назви посад із вашого резюме, щоб розширити пошук
/career-ops upskill   → Зведений аналіз прогалин у навичках з оцінених звітів
/career-ops followup  → Трекер ритму фоллоу-апів: позначити прострочені, згенерувати чернетки
/career-ops reply-watch → Класифікувати відповіді роботодавців і запропонувати оновлення трекера
/career-ops outcome   → Записати результат заявки та заархівувати артефакти
/career-ops calibrate → Консультативний звіт: чи передбачають ваші оцінки реальні результати? Читає дані /outcome; ніколи не змінює оцінювання
/career-ops update    → Оновити системні файли career-ops із попереднім переглядом diff + перевіркою сумісності
```

Або просто вставте URL чи опис вакансії: career-ops визначить його автоматично й запустить повний конвеєр.

У Codex слеш-команди не гарантовані. Використовуйте ті самі назви режимів у промпті або викликайте їх через `codex exec`.

## Як це працює

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

## Попередньо налаштовані портали

Сканер постачається зі **100+ компаніями**, готовими до сканування, і **45+ пошуковими запитами** по основних дошках вакансій. Скопіюйте `templates/portals.example.yml` у `portals.yml` і додайте свої:

**AI-лабораторії:** Anthropic, OpenAI, Mistral, Cohere, LangChain, Pinecone
**Голосовий AI:** ElevenLabs, PolyAI, Parloa, Hume AI, Deepgram, Vapi, Bland AI
**AI-платформи:** Retool, Airtable, Vercel, Temporal, Glean, Arize AI
**Контакт-центри:** Ada, LivePerson, Sierra, Decagon, Talkdesk, Genesys
**Enterprise:** Salesforce, Twilio, Gong, Dialpad
**LLMOps:** Langfuse, Weights & Biases, Lindy, Cognigy, Speechmatics
**Автоматизація:** n8n, Zapier, Make.com
**Європа:** Factorial, Attio, Tinybird, Clarity AI, Travelperk

**Дошки вакансій, що скануються:** 55+ модулів провайдерів покривають API ATS, стрічки цілих дошок, XML/RSS-стрічки, markdown-стрічки та локальні парсери. Повна таблиця: [Підтримувані дошки вакансій](docs/SUPPORTED_JOB_BOARDS.md).

За замовчуванням `node scan.mjs` (він же `npm run scan`) довіряє тому, що повертає кожна стрічка ATS. Деякі компанії залишають застарілі оголошення у своєму публічному API навіть після закриття вакансії, тож ці прострочені записи можуть потрапити в `pipeline.md`. Передайте `--verify`, щоб після проходу API запустити Playwright і відкинути прострочені оголошення до того, як вони потраплять у конвеєр:

```bash
node scan.mjs --verify          # zero-token discovery + Playwright liveness check
```

Перевірка послідовна і виконується лише для нових вакансій (після дедуплікації), тож вартість лишається обмеженою.

## Дашборд TUI

Вбудований термінальний дашборд дає змогу переглядати ваш конвеєр візуально:

```bash
npm run serve:dashboard   # launch the TUI
npm run build:dashboard   # optional: build the standalone binary
```

Функції: 6 вкладок фільтрів, 4 режими сортування, згрупований/плоский вигляд, ліниве завантаження попереднього перегляду, зміна статусів у рядку.

Є також **експериментальний веб-інтерфейс** (альфа, опційно: нічого не запускається, поки ви його не запустите): дивіться [`web/README.md`](web/README.md).

## Структура проєкту

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

## Зовнішній каталог даних (опційно)

За замовчуванням дані користувацького шару (такі як `cv.md`, `portals.yml` і теки `data/`, `reports/`, `output/`) живуть у кореневій теці проєкту.

Щоб відокремити особисті дані від коду (простіше перемикати гілки, підтягувати оновлення чи тестувати кілька профілів), ви можете налаштувати зовнішній каталог даних із таким пріоритетом:

1. **Змінні середовища:** задайте змінну `CAREER_OPS_ROOT` або `CAREER_OPS_DATA_DIR`:
   ```bash
   export CAREER_OPS_ROOT=~/my-career-data
   ```
2. **Файл-маркер:** створіть у корені репозиторію файл `.career-ops-data` зі шляхом до вашого каталогу даних.
3. **За замовчуванням:** корінь репозиторію.

Після визначення всі користувацькі файли розв'язуються і записуються відносно цієї теки, тоді як файли промптів і скрипти далі розв'язуються відносно репозиторію.

- **Перевизначення трекера:** можна також задати `CAREER_OPS_TRACKER`, щоб напряму вказати шлях до файлу трекера заявок.
- **Записи:** усі операції запису (наприклад, злиття) канонічно спрямовані в `{DATA_ROOT}/data/applications.md`.

Дашборд TUI на Go, скрипти Node.js і режими AI-агента автоматично дотримуються цієї ієрархії.


## Технологічний стек

![Claude Code](https://img.shields.io/badge/Claude_Code-000?style=flat&logo=anthropic&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-2EAD33?style=flat&logo=playwright&logoColor=white)
![Go](https://img.shields.io/badge/Go-00ADD8?style=flat&logo=go&logoColor=white)
![Bubble Tea](https://img.shields.io/badge/Bubble_Tea-FF75B5?style=flat&logo=go&logoColor=white)

- **Агент**: AI-кодинг CLI зі спільними скілами та режимами (`AGENTS.md` + обгортка для CLI)
- **PDF**: Playwright + HTML-шаблон
- **Супровідні листи**: HTML-шаблон + Playwright (A4 PDF, той самий конвеєр, що й для резюме)
- **Сканер**: Playwright + Greenhouse API + WebSearch
- **Дашборд**: Go + Bubble Tea + Lipgloss (тема Catppuccin Mocha)
- **Дані**: таблиці Markdown + конфігурація YAML + пакетні файли TSV

## Також у відкритому коді

- **[cv-santiago](https://github.com/santifer/cv-santiago)**: сайт-портфоліо (santifer.io) з AI-чатботом, дашбордом LLMOps і кейс-стаді. Якщо вам потрібне портфоліо на додачу до пошуку роботи, зробіть форк і зробіть його своїм.

## FAQ

**Що таке career-ops?**
career-ops є AI-пошуком роботи з відкритим кодом, який працює локально у вашому AI-кодинг CLI (Claude Code, Codex, OpenCode та інших) і залишає кожне рішення за вами. Він оцінює вакансії відносно вашого резюме, генерує ATS-адаптовані PDF, знаходить потрібну людину для контакту і відстежує все в одному місці: останнє слово завжди за вами. Це перша еталонна реалізація Маніфесту CareerOps. Більше на [career-ops.org](https://career-ops.org).

**Чи може адаптоване резюме щось вигадати?**
Не має права, і промпти це кажуть: переформульовувати, ніколи не вигадувати. Але це правило ще не забезпечене перевіркою в коді. Його відстежують два відкриті issue: [#2677](https://github.com/career-ops-hq/career-ops/issues/2677) (назви посад мають збігатися з cv.md) і [#1411](https://github.com/career-ops-hq/career-ops/issues/1411) (перевірка достовірності, що блокує в разі невідповідності). Поки їх не змерджено, читайте кожне резюме перед відправкою. [Юридичне застереження](LEGAL_DISCLAIMER.md) каже те саме довше.

**Чи можу я запускати career-ops безкоштовно або на дешевшій / локальній моделі?**
Так. career-ops не залежить від CLI і працює на безкоштовних та локальних моделях (безкоштовні моделі OpenRouter, Ollama або будь-який OpenAI-сумісний ендпоінт), тож ви не прив'язані до платної підписки. Повне налаштування: [docs/RUNNING_ON_A_BUDGET.md](docs/RUNNING_ON_A_BUDGET.md).

**Я плачу за Claude Pro/Max, але career-ops спалює API-кредити. Чому?**
Бо `ANTHROPIC_API_KEY` у вашому середовищі має пріоритет над підпискою, в яку ви увійшли: CLI використовує ключ і тарифікує за токен. Виконайте `echo $ANTHROPIC_API_KEY`, і якщо щось виводиться, приберіть його з профілю оболонки, перезапустіть термінал і виконайте `/login`. Пакетний режим є винятком, бо воркери `claude -p` не використовують інтерактивний вхід: один раз виконайте `claude setup-token` і експортуйте результат як `CLAUDE_CODE_OAUTH_TOKEN`. Повний покроковий опис: [docs/RUNNING_ON_A_BUDGET.md](docs/RUNNING_ON_A_BUDGET.md#2b-already-paying-for-a-subscription-make-sure-you-are-using-it).

**З якими AI CLI працює career-ops?**
career-ops працює з будь-яким основним AI-кодинг CLI (Claude Code, Codex, Gemini / Antigravity, OpenCode, Grok, Qwen та іншими) через відкритий Agent Skill Standard, тож ніколи не прив'язаний до одного вендора. Використовуйте той CLI, що у вас уже є.

**Як встановити career-ops на Windows?**
career-ops працює на Windows. Специфічне для платформи налаштування і відомі гострі кути (пошук Git Bash, кінці рядків, Планувальник завдань) описано в [docs/WINDOWS.md](docs/WINDOWS.md). Якщо скіли не завантажуються з помилкою символічного посилання під час встановлення, рішення в [docs/FAQ.md](docs/FAQ.md). Повні кроки в [docs/SETUP.md](docs/SETUP.md).

**Чи подає career-ops заявки замість мене?**
Ні. career-ops є фільтром, а не інструментом масової автоматичної розсилки. AI оцінює, ранжує і готує чернетки; ви переглядаєте і вирішуєте. Він ніколи не подає, не надсилає і не клікає нічого: останнє слово завжди за вами. Саме в цьому дизайні з людиною в контурі вся суть.

**Чи career-ops безкоштовний і з відкритим кодом?**
Так. career-ops безкоштовний і з відкритим кодом, і для кандидата так буде завжди: це перша еталонна реалізація [Маніфесту CareerOps](https://career-ops.org/manifesto). Прочитайте його, і якщо він каже те, у що ви вірите, підпишіть.

## Про автора

Я [Santiago Fernández de Valderrama Aparicio](https://santifer.io/about) (santifer): Head of Applied AI, колишній засновник (побудував і продав бізнес, який досі працює під моїм ім'ям). Я створив career-ops для управління власним пошуком роботи. Це спрацювало: я використав його, щоб отримати свою поточну посаду.

Цікаво, як цей репозиторій підтримується приблизно за 4 години на тиждень? Читайте [Agentic maintenance: how career-ops is run by a fleet of AI agents](https://santifer.io/ai-agent-fleet).

Моє портфоліо та інші open source проєкти → [santifer.io](https://santifer.io)

Wikidata: [Santiago Fernández de Valderrama Aparicio](https://www.wikidata.org/wiki/Q138710224) · [career-ops](https://www.wikidata.org/wiki/Q139007988).

## Застереження

**career-ops є локальним інструментом з відкритим кодом, а НЕ хмарним сервісом.** Використовуючи це програмне забезпечення, ви підтверджуєте:

1. **Ви контролюєте свої дані.** Ваше резюме, контактна інформація та персональні дані залишаються на вашому комп'ютері і надсилаються безпосередньо обраному вами AI-провайдеру (Anthropic, OpenAI тощо). Ми не збираємо, не зберігаємо і не маємо доступу до жодних ваших даних.
2. **Ви контролюєте AI.** Промпти за замовчуванням інструктують AI не подавати заявки автоматично, але AI-моделі можуть поводитися непередбачувано. Якщо ви змінюєте промпти або використовуєте інші моделі, ви робите це на власний ризик. **Завжди перевіряйте точність згенерованого AI контенту перед надсиланням.**
3. **Ви дотримуєтеся умов сервісу третіх сторін.** Ви повинні використовувати цей інструмент відповідно до Умов використання кар'єрних порталів, з якими взаємодієте (Greenhouse, Lever, Workday, LinkedIn тощо). Не використовуйте цей інструмент для спаму роботодавцям чи перевантаження систем ATS.
4. **Без гарантій.** Оцінки є рекомендаціями, а не істиною. AI-моделі можуть вигадувати навички або досвід. Автори не несуть відповідальності за результати працевлаштування, відхилені заявки, обмеження облікових записів чи будь-які інші наслідки.

Дивіться [LEGAL_DISCLAIMER.md](LEGAL_DISCLAIMER.md) за повною інформацією. Це програмне забезпечення надається за [ліцензією MIT](LICENSE) "як є", без будь-яких гарантій.

## Контриб'ютори

<a href="https://github.com/career-ops-hq/career-ops/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=career-ops-hq/career-ops" />
</a>

Усі, хто зробив внесок кодом, документацією, перекладами чи тестами, перелічені в
[CONTRIBUTORS.md](CONTRIBUTORS.md), включно з внесками без коду, які
графік вище показати не може.

Отримали роботу з career-ops? [Поділіться своєю історією!](https://github.com/career-ops-hq/career-ops/issues/new?template=i-got-hired.yml)

## Ліцензія та торгова марка

Код ліцензовано за [MIT](LICENSE). Назва та бренд
"career-ops" регулюються [Політикою торгової марки](TRADEMARK.md): дозвільною
для використання спільнотою, зарезервованою для назв комерційних продуктів
і схвалень.

## Відзнаки

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
  <sub>Також працює в будь-якому CLI за стандартом agent-skill. Дивіться <a href="docs/SUPPORTED_CLIS.md">Підтримувані CLI</a>.</sub><br>
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

## Контакти

[![Website](https://img.shields.io/badge/santifer.io-000?style=for-the-badge&logo=safari&logoColor=white)](https://santifer.io)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white)](https://linkedin.com/in/santifer)
[![X](https://img.shields.io/badge/X-000?style=for-the-badge&logo=x&logoColor=white)](https://x.com/santifer)
[![Discord](https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/8pRpHETxa4)
[![Email](https://img.shields.io/badge/Email-EA4335?style=for-the-badge&logo=gmail&logoColor=white)](mailto:hi@santifer.io)
