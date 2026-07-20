<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/wordmark-dark.svg"><img src="docs/wordmark-light.svg" alt="career-ops" width="250" height="56"></picture></p>

<div align="center">

[English](README.md) | [Español](README.es.md) | [Deutsch](README.de.md) | [Français](README.fr.md) | [Português (Brasil)](README.pt-BR.md) | [한국어](README.ko-KR.md) | [日本語](README.ja.md) | [简体中文](README.cn.md) | [繁體中文](README.zh-TW.md) | [Українська](README.ua.md) | [Русский](README.ru.md) | [Polski](README.pl.md) | [Dansk](README.da.md) | [العربية](README.ar.md) | [हिन्दी](README.hi.md)

</div>

<p align="center">
  <a href="https://x.com/santifer"><img src="docs/hero-banner.jpg" alt="Career-Ops Multi-Agent Система Пошуку Роботи" width="800"></a>
</p>

<p align="center">
  <em>Я провів місяці у пошуках роботи, роблячи все самотужки. Тому я створив систему, яку хотів би мати з самого початку.</em><br>
  Компанії використовують AI для фільтрації кандидатів. <strong>Я дав кандидатам AI, щоб вони могли <em>вибирати</em> компанії.</strong><br>
  <em>Тепер це open source.</em>
</p>

<p align="center">
  <a href="https://trendshift.io/repositories/25195" target="_blank"><img src="https://trendshift.io/api/badge/repositories/25195" alt="santifer%2Fcareer-ops | Trendshift" style="width: 245px; height: 54px; vertical-align: middle;" width="245" height="54"/></a>
  &nbsp;&nbsp;
  <a href="https://www.producthunt.com/products/santifer-io?utm_source=badge-featured&utm_medium=badge" target="_blank"><img src="docs/press/producthunt.svg" alt="Career-Ops on Claude | Product Hunt" style="width: 206px; height: 54px; vertical-align: middle;" width="206" height="54"/></a>
</p>

<p align="center"><sub>Згадані у</sub></p>

<p align="center">
  <a href="https://wired.com.gr/article/to-ai-ergaleio-pou-fernei-epanastasi-ston-tropo-pou-psachnoume-douleia/" rel="noopener noreferrer nofollow"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/press/wired-dark.svg"><img src="docs/press/wired.svg" alt="WIRED" height="32"></picture></a>
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <a href="https://www.businessinsider.com/how-i-built-tool-filter-job-listings-landed-head-ai-2026-4" rel="noopener noreferrer nofollow"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/press/business-insider-dark.svg"><img src="docs/press/business-insider.svg" alt="Business Insider" height="32"></picture></a>
</p>

---

<p align="center">
  <img src="docs/demo.gif" alt="Демо Career-Ops" width="800">
</p>

<p align="center"><strong>740+ вакансій оцінено · 100+ персоналізованих резюме · 1 роботу мрії отримано</strong></p>

<p align="center">
  <a href="https://discord.gg/8pRpHETxa4"><img src="https://img.shields.io/badge/Приєднатися_до_спільноти-Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord"></a>
  &nbsp;
  <a href="https://www.npmjs.com/package/@santifer/career-ops"><img src="https://img.shields.io/npm/dt/@santifer/career-ops?style=for-the-badge&logo=npm&color=CB3837&label=npx%20installs" alt="npm installs"></a>
</p>

<p align="center">
  <a href="https://claude.com/claude-code"><img src="https://img.shields.io/badge/Built_with-Claude_Code-000?style=for-the-badge&logo=anthropic&logoColor=white" alt="Built with Claude Code"></a>
</p>

<p align="center">
  <sub>Також працює на будь-якому CLI зі стандартом agent-skill</sub><br>
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

## Що це таке

Career-Ops перетворює будь-який AI-кодинг CLI на повноцінний командний центр для пошуку роботи. Замість ручного відстеження заявок у таблиці, ви отримуєте AI-pipeline, який:

- **Оцінює вакансії** за структурованою оцінкою A-F (п'ять параметрів, що формують оцінку 1.0–5.0)
- **Генерує персоналізовані PDF** — ATS-оптимізовані резюме під кожен опис вакансії
- **Сканує портали** автоматично (Greenhouse, Ashby, Lever, сторінки компаній)
- **Пакетна обробка** — оцінка 10+ вакансій паралельно суб-агентами
- **Відстежує все** в єдиному джерелі даних з перевіркою цілісності

> **Важливо: це НЕ інструмент для масової розсилки.** Career-ops — це фільтр, який допомагає знайти кілька вакансій, вартих вашого часу, серед сотень. Система наполегливо рекомендує не подаватися на вакансії з балом нижче 4.0/5. Ваш час цінний, як і час рекрутера. Завжди перевіряйте все перед подачею заявки.

Career-ops працює агентно: Claude Code переходить на кар'єрні сторінки за допомогою Playwright, оцінює відповідність, аналізуючи ваше резюме відносно опису вакансії (не за ключовими словами), та адаптує ваше резюме під кожну вакансію.

> **Зверніть увагу: перші оцінки будуть не ідеальними.** Система ще не знає вас. Дайте їй контекст — ваше резюме, вашу кар'єрну історію, ваші досягнення, уподобання, сильні сторони, що хочете уникати. Чим більше ви її "навчаєте", тим краще вона стає. Уявіть, що ви вводите в курс справ нового рекрутера: перший тиждень він вивчає вас, а потім стає незамінним.

Створено людиною, яка використовувала систему для оцінки 740+ вакансій, генерації 100+ персоналізованих резюме та отримання посади Head of Applied AI. [Читати повний кейс](https://santifer.io/career-ops-system).

## Що система вміє

| Функція                       | Опис                                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Авто-конвеєр**              | Вставте URL — отримайте повну оцінку + PDF + запис у трекері                                                                                     |
| **6-блокова оцінка**          | Опис ролі, відповідність резюме, стратегія рівня, дослідження компенсації, персоналізація, підготовка до інтерв'ю (STAR+R) — плюс перевірка легітимності вакансії у Блоці G, що виявляє шахрайство та фейкові вакансії |
| **Банк історій для інтерв'ю** | Накопичує STAR+Reflection історії з оцінок — 5-10 майстер-історій, що відповідають на будь-яке поведінкове питання                               |
| **Скрипти переговорів**       | Фреймворки переговорів про зарплату, протидія географічним знижкам, використання конкуруючих пропозицій                                          |
| **Генерація ATS PDF**         | Резюме з впровадженими ключовими словами, дизайн Space Grotesk + DM Sans                                                                         |
| **Сканер порталів**           | 45+ попередньо налаштованих компаній (Anthropic, OpenAI, ElevenLabs, Retool, n8n...) + кастомні запити через Ashby, Greenhouse, Lever, Wellfound |
| **Пакетна обробка**           | Паралельна оцінка з `claude -p` воркерами                                                                                                        |
| **Дашборд TUI**               | Термінальний інтерфейс для перегляду, фільтрації та сортування вашого конвеєра                                                                   |
| **Human-in-the-Loop**         | AI оцінює та рекомендує, ви вирішуєте та дієте. Система ніколи не подає заявку — остаточне рішення завжди за вами                                |
| **Цілісність конвеєра**       | Автоматичне злиття, дедуплікація, нормалізація статусів, перевірки стану                                                                         |

## Швидкий старт

**Найшвидший спосіб — одна команда:**

```bash
npx @santifer/career-ops init
```

> 💡 `npx` постачається разом із [Node.js](https://nodejs.org) — він запускає
> інсталятор один раз, нічого не встановлюючи глобально. Ще немає Node?
> Спочатку встановіть його.
> (Уже користуєтеся Claude Code / Gemini / Codex CLI? Тоді він у вас уже є.)

Це клонує останній реліз у `./career-ops` та встановлює залежності. Потім:

```bash
cd career-ops
claude   # or gemini / codex / qwen / opencode — open your AI CLI here
```

**Під час першого запуску career-ops проведе вас через налаштування — ваше резюме, профіль і цільові ролі — просто у форматі діалогу. Нічого не треба редагувати вручну.**

<details>
<summary><b>Бажаєте налаштувати вручну? (git clone)</b></summary>

```bash
git clone https://github.com/santifer/career-ops.git
cd career-ops && npm install
npx playwright install chromium   # only needed for PDF generation
claude
```

</details>

> **Система створена для налаштування самим Claude.** Режими, архетипи, оцінювання, скрипти переговорів — просто попросіть Claude їх змінити. Він читає ті самі файли, які використовує, тому точно знає, що редагувати.

Дивіться [docs/SETUP.md](docs/SETUP.md) як повний посібник з налаштування.

## Використання

Career-ops — це одна слеш-команда з кількома режимами:

```text
/career-ops                → Показати всі доступні команди
/career-ops {вставити JD}  → Повний авто-конвеєр (оцінка + PDF + трекер)
/career-ops scan           → Сканувати портали на нові вакансії
/career-ops pdf            → Згенерувати ATS-оптимізоване резюме
/career-ops batch          → Пакетна оцінка кількох вакансій
/career-ops tracker        → Переглянути статус заявок
/career-ops apply          → Заповнити форми заявок з AI
/career-ops pipeline       → Обробити очікуючі URL
/career-ops contacto       → Повідомлення для LinkedIn outreach
/career-ops deep           → Глибоке дослідження компанії
/career-ops training       → Оцінити курс/сертифікацію
/career-ops project        → Оцінити портфоліо-проєкт
```

Або просто вставте URL вакансії чи її опис — career-ops автоматично визначить це та запустить повний конвеєр.

## Як це працює

```text
Ви вставляєте URL вакансії або опис
        │
        ▼
┌──────────────────┐
│  Визначення      │  Класифікує: LLMOps / Agentic / PM / SA / FDE / Transformation
│  архетипу        │
└────────┬─────────┘
         │
┌────────▼─────────┐
│  Оцінка A-F      │  Відповідність, прогалини, дослідження компенсації, STAR-історії
│  (читає cv.md)   │
└────────┬─────────┘
         │
    ┌────┼────┐
    ▼    ▼    ▼
 Звіт  PDF  Трекер
  .md   .pdf   .tsv
```

## Попередньо налаштовані портали

Сканер поставляється з **45+ компаніями**, готовими до сканування, та **19 пошуковими запитами** по основних дошках вакансій. Скопіюйте `templates/portals.example.yml` у `portals.yml` та додайте свої:

**AI-лабораторії:** Anthropic, OpenAI, Mistral, Cohere, LangChain, Pinecone
**Голосовий AI:** ElevenLabs, PolyAI, Parloa, Hume AI, Deepgram, Vapi, Bland AI
**AI-платформи:** Retool, Airtable, Vercel, Temporal, Glean, Arize AI
**Контакт-центри:** Ada, LivePerson, Sierra, Decagon, Talkdesk, Genesys
**Enterprise:** Salesforce, Twilio, Gong, Dialpad
**LLMOps:** Langfuse, Weights & Biases, Lindy, Cognigy, Speechmatics
**Автоматизація:** n8n, Zapier, Make.com
**Європейські:** Factorial, Attio, Tinybird, Clarity AI, Travelperk

**Дошки вакансій:** Ashby, Greenhouse, Lever, Wellfound, Workable, RemoteFront

## Дашборд TUI

Вбудований термінальний дашборд дозволяє візуально переглядати поточний стан вашого конвеєра:

```bash
npm run serve:dashboard   # launch the TUI
npm run build:dashboard   # optional: build the standalone binary
```

Функції: 6 вкладок фільтрації, 4 режими сортування, групований/плаский вигляд, lazy-load попереднього перегляду, inline зміна статусів.

## Структура проєкту

```text
career-ops/
├── CLAUDE.md                    # Інструкції для агента
├── cv.md                        # Ваше резюме (створіть цей файл)
├── article-digest.md            # Ваші досягнення (необов'язково)
├── config/
│   └── profile.example.yml      # Шаблон для вашого профілю
├── modes/                       # 14 режимів навичок
│   ├── _shared.md               # Спільний контекст (налаштуйте)
│   ├── oferta.md                # Одиночна оцінка
│   ├── pdf.md                   # Генерація PDF
│   ├── scan.md                  # Сканер порталів
│   ├── batch.md                 # Пакетна обробка
│   └── ...
├── templates/
│   ├── cv-template.html         # ATS-оптимізований шаблон резюме
│   ├── portals.example.yml      # Шаблон конфігурації сканера
│   └── states.yml               # Канонічні статуси
├── batch/
│   ├── batch-prompt.md          # Самодостатній промпт воркера
│   └── batch-runner.sh          # Скрипт-оркестратор
├── dashboard/                   # Go TUI для перегляду конвеєра
├── data/                        # Ваші дані відстеження (gitignored)
├── reports/                     # Звіти оцінок (gitignored)
├── output/                      # Згенеровані PDF (gitignored)
├── fonts/                       # Space Grotesk + DM Sans
├── docs/                        # Налаштування, кастомізація, архітектура
└── examples/                    # Приклади резюме, звітів, досягнень
```

## Технологічний стек

![Claude Code](https://img.shields.io/badge/Claude_Code-000?style=flat&logo=anthropic&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-2EAD33?style=flat&logo=playwright&logoColor=white)
![Go](https://img.shields.io/badge/Go-00ADD8?style=flat&logo=go&logoColor=white)
![Bubble Tea](https://img.shields.io/badge/Bubble_Tea-FF75B5?style=flat&logo=go&logoColor=white)

- **Агент**: Claude Code з кастомними навичками та режимами
- **PDF**: Playwright/Puppeteer + HTML-шаблон
- **Сканер**: Playwright + Greenhouse API + WebSearch
- **Дашборд**: Go + Bubble Tea + Lipgloss (тема Catppuccin Mocha)
- **Дані**: Markdown-таблиці + YAML-конфігурація + TSV-пакетні файли

## Також у відкритому коді

- **[cv-santiago](https://github.com/santifer/cv-santiago)** — Портфоліо-сайт (santifer.io) з AI-чатботом, LLMOps-дашбордом та кейсами. Якщо вам потрібне портфоліо для демонстрації під час пошуку роботи, форкніть його та зробіть своїм.

## Про автора

Я Сантьяго — Head of Applied AI, колишній засновник (побудував і продав бізнес, який досі працює під моїм ім'ям). Я створив career-ops для управління власним пошуком роботи. Це спрацювало: я використав його, щоб отримати свою поточну посаду.

Моє портфоліо та інші open source проєкти → [santifer.io](https://santifer.io)

☕ [Пригостіть мене кавою](https://buymeacoffee.com/santifer), якщо career-ops допоміг у вашому пошуку роботи.

## Історія зірок

<a href="https://www.star-history.com/?repos=santifer%2Fcareer-ops&type=timeline&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=santifer/career-ops&type=timeline&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=santifer/career-ops&type=timeline&legend=top-left" />
   <img alt="Графік історії зірок" src="https://api.star-history.com/chart?repos=santifer/career-ops&type=timeline&legend=top-left" />
 </picture>
</a>

## Застереження

**career-ops — це локальний інструмент з відкритим кодом, а НЕ хмарний сервіс.** Використовуючи це програмне забезпечення, ви підтверджуєте:

1. **Ви контролюєте свої дані.** Ваше резюме, контактна інформація та персональні дані залишаються на вашому комп'ютері і надсилаються безпосередньо обраному вами AI-провайдеру (Anthropic, OpenAI тощо). Ми не збираємо, не зберігаємо та не маємо доступу до жодних ваших даних.
2. **Ви контролюєте AI.** Промпти за замовчуванням інструктують AI не подавати заявки автоматично, але AI-моделі можуть поводитися непередбачувано. Якщо ви змінюєте промпти або використовуєте інші моделі, ви робите це на власний ризик. **Завжди перевіряйте AI-згенерований контент на точність перед подачею.**
3. **Ви дотримуєтеся умов сервісу третіх сторін.** Ви повинні використовувати цей інструмент відповідно до Умов використання кар'єрних порталів, з якими взаємодієте (Greenhouse, Lever, Workday, LinkedIn тощо). Не використовуйте цей інструмент для спаму роботодавців або перевантаження ATS-систем.
4. **Без гарантій.** Оцінки — це рекомендації, а не істина. AI-моделі можуть вигадувати навички або досвід. Автори не несуть відповідальності за результати працевлаштування, відхилені заявки, обмеження облікових записів чи будь-які інші наслідки.

Дивіться [LEGAL_DISCLAIMER.md](LEGAL_DISCLAIMER.md) за повною інформацією. Це програмне забезпечення надається за [ліцензією MIT](LICENSE) "як є", без будь-яких гарантій.

## Контриб'ютори

<a href="https://github.com/santifer/career-ops/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=santifer/career-ops" alt="Контриб'ютори santifer/career-ops" />
</a>

Отримали роботу завдяки career-ops? [Поділіться своєю історією!](https://github.com/santifer/career-ops/issues/new?template=i-got-hired.yml)

## Ліцензія

MIT

## Контакти

[![Вебсайт](https://img.shields.io/badge/santifer.io-000?style=for-the-badge&logo=safari&logoColor=white)](https://santifer.io)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white)](https://linkedin.com/in/santifer)
[![X](https://img.shields.io/badge/X-000?style=for-the-badge&logo=x&logoColor=white)](https://x.com/santifer)
[![Discord](https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/8pRpHETxa4)
[![Email](https://img.shields.io/badge/Email-EA4335?style=for-the-badge&logo=gmail&logoColor=white)](mailto:hi@santifer.io)
[![Пригостити кавою](https://img.shields.io/badge/Buy_Me_a_Coffee-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/santifer)
