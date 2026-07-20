<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/wordmark-dark.svg"><img src="docs/wordmark-light.svg" alt="career-ops" width="250" height="56"></picture></p>

<div align="center">

[English](README.md) | [Español](README.es.md) | [Deutsch](README.de.md) | [Français](README.fr.md) | [Português (Brasil)](README.pt-BR.md) | [한국어](README.ko-KR.md) | [日本語](README.ja.md) | [简体中文](README.cn.md) | [繁體中文](README.zh-TW.md) | [Українська](README.ua.md) | [Русский](README.ru.md) | [Polski](README.pl.md) | [Dansk](README.da.md) | [العربية](README.ar.md) | [हिन्दी](README.hi.md)

</div>

<p align="center">
  <a href="https://x.com/santifer"><img src="docs/hero-banner.jpg" alt="Career-Ops Мультиагентная система поиска работы" width="800"></a>
</p>

<p align="center">
  <em>Я месяцами откликался на вакансии вручную. И создал систему, которую хотел бы иметь с самого начала.</em><br>
  Компании используют ИИ для фильтрации кандидатов. <strong>Я дал кандидатам ИИ, чтобы <em>выбирать</em> компании.</strong><br>
  <em>Теперь это open source.</em>
</p>

<p align="center">
  <a href="https://trendshift.io/repositories/25195" target="_blank"><img src="https://trendshift.io/api/badge/repositories/25195" alt="santifer%2Fcareer-ops | Trendshift" style="width: 245px; height: 54px; vertical-align: middle;" width="245" height="54"/></a>
  &nbsp;&nbsp;
  <a href="https://www.producthunt.com/products/santifer-io?utm_source=badge-featured&utm_medium=badge" target="_blank"><img src="docs/press/producthunt.svg" alt="Career-Ops on Claude | Product Hunt" style="width: 206px; height: 54px; vertical-align: middle;" width="206" height="54"/></a>
</p>

<p align="center"><sub>УПОМИНАНИЯ В СМИ</sub></p>

<p align="center">
  <a href="https://wired.com.gr/article/to-ai-ergaleio-pou-fernei-epanastasi-ston-tropo-pou-psachnoume-douleia/" rel="noopener noreferrer nofollow"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/press/wired-dark.svg"><img src="docs/press/wired.svg" alt="WIRED" height="32"></picture></a>
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <a href="https://www.businessinsider.com/how-i-built-tool-filter-job-listings-landed-head-ai-2026-4" rel="noopener noreferrer nofollow"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/press/business-insider-dark.svg"><img src="docs/press/business-insider.svg" alt="Business Insider" height="32"></picture></a>
</p>

---

<p align="center">
  <img src="docs/demo.gif" alt="Career-Ops Демо" width="800">
</p>

<p align="center"><strong>740+ вакансий оценено · 100+ персонализированных резюме · 1 позиция мечты получена</strong></p>

<p align="center">
  <a href="https://discord.gg/8pRpHETxa4"><img src="https://img.shields.io/badge/Присоединиться_к_сообществу-Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord"></a>
  &nbsp;
  <a href="https://www.npmjs.com/package/@santifer/career-ops"><img src="https://img.shields.io/npm/dt/@santifer/career-ops?style=for-the-badge&logo=npm&color=CB3837&label=npx%20installs" alt="npm installs"></a>
</p>

<p align="center">
  <a href="https://claude.com/claude-code"><img src="https://img.shields.io/badge/Built_with-Claude_Code-000?style=for-the-badge&logo=anthropic&logoColor=white" alt="Built with Claude Code"></a>
</p>

<p align="center">
  <sub>Также работает с любым CLI, поддерживающим стандарт agent-skill</sub><br>
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

## Что это

Career-Ops превращает любой AI-CLI в полноценный командный центр для поиска работы. Вместо ручного ведения таблиц с откликами вы получаете ИИ-пайплайн, который:

- **Оценивает вакансии** по структурированной системе A–F (пять параметров, формирующих оценку 1.0–5.0)
- **Генерирует персонализированные PDF-резюме** — оптимизированные под ATS, адаптированные под каждую вакансию
- **Сканирует порталы** автоматически (Greenhouse, Ashby, Lever и др.; российские площадки настраиваются в `portals.yml`)
- **Пакетная обработка** — оценка 10+ вакансий параллельно через суб-агентов
- **Трекает всё** в единой точке правды с проверками целостности

> **Важно: это НЕ инструмент для массовой рассылки.** Career-ops — это фильтр. Он помогает найти те немногие вакансии, которые стоят вашего времени, из сотен. Система настоятельно рекомендует не откликаться на вакансии с оценкой ниже 4.0/5. Ваше время ценно, как и время рекрутера. Всегда проверяйте перед отправкой.

## Возможности

| Функция                       | Описание                                                                                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Авто-пайплайн**             | Вставь URL → получи оценку + PDF + запись в трекере                                                                                                       |
| **6-блочная оценка**          | Резюме роли, совпадение с CV, стратегия грейда, исследование компенсации, персонализация, подготовка к интервью (STAR+R) — плюс проверка легитимности вакансии (Блок G), которая выявляет мошеннические и фантомные вакансии |
| **Банк историй для интервью** | Накапливает STAR+Reflection истории — 5–10 мастер-историй, которые закрывают любой поведенческий вопрос                                                   |
| **Скрипты переговоров**       | Фреймворки зарплатных переговоров, отстаивание рыночной ставки, использование конкурирующих офферов                                                       |
| **ATS PDF-генерация**         | Резюме с инъекцией ключевых слов, дизайн Space Grotesk + DM Sans                                                                                          |
| **Сканер порталов**           | 45+ предустановленных компаний (международный рынок) + российские площадки (hh.ru, Хабр Карьера, trudvsem.ru и др.) — добавляются вручную в `portals.yml` |
| **Пакетная обработка**        | Параллельная оценка через `claude -p` воркеры                                                                                                             |
| **Dashboard TUI**             | Терминальный UI для просмотра, фильтрации и сортировки пайплайна                                                                                          |
| **Human-in-the-Loop**         | ИИ оценивает и рекомендует, вы решаете и действуете. Система никогда не отправляет отклик сама                                                            |
| **Целостность пайплайна**     | Автоматический merge, дедупликация, нормализация статусов, проверки здоровья                                                                              |

## Быстрый старт

**Самый быстрый способ — одна команда:**

```bash
npx @santifer/career-ops init
```

> 💡 `npx` поставляется вместе с [Node.js](https://nodejs.org) — он один раз запускает
> установщик, ничего не устанавливая глобально. Ещё нет Node? Установи его сначала.
> (Уже используешь Claude Code / Gemini / Codex CLI? Значит, он у тебя уже есть.)

Это клонирует последний релиз в `./career-ops` и устанавливает зависимости. Затем:

```bash
cd career-ops
claude   # или gemini / codex / qwen / opencode — открой здесь свой AI-CLI
```

**При первом запуске career-ops проведёт тебя через настройку — твоё CV, профиль и целевые роли — просто через диалог. Ничего не нужно править вручную.**

<details>
<summary><b>Предпочитаешь настроить вручную? (git clone)</b></summary>

```bash
git clone https://github.com/santifer/career-ops.git
cd career-ops && npm install
npx playwright install chromium   # нужно только для генерации PDF
claude   # открой свой AI-CLI — он проведёт онбординг при первом запуске
```

</details>

## Использование

Career-ops — одна slash-команда с множеством режимов:

```
/career-ops                       → Показать все доступные команды
/career-ops {вставь описание JD}  → Полный авто-пайплайн (оценка + PDF + трекер)
/career-ops scan                  → Сканирование порталов
/career-ops pdf                   → Генерация ATS-резюме
/career-ops batch                 → Пакетная оценка вакансий
/career-ops tracker               → Статус откликов
/career-ops apply                 → Заполнение форм отклика с ИИ
/career-ops pipeline              → Обработка очереди URL
/career-ops contacto              → Сообщение в LinkedIn
/career-ops deep                  → Глубокий анализ компании
/career-ops training              → Оценка курса/сертификации
/career-ops project               → Оценка портфолио-проекта
```

Или просто вставь URL вакансии — career-ops автоматически определит его и запустит полный пайплайн.

## Как это работает

```
Вставляешь URL вакансии или описание
        │
        ▼
┌──────────────────┐
│  Определение     │  Классификация: Backend / Frontend / DevOps / PM / SA / ML
│  архетипа        │
└────────┬─────────┘
         │
┌────────┼─────────┐
│  Оценка A–F      │  Совпадение, пробелы, исследование компенсации, STAR-истории
│  (читает cv.md)  │
└────────┬─────────┘
         │
    ┌────┼─────┐
    ▼    ▼     ▼
 Отчёт  PDF  Трекер
  .md   .pdf   .tsv
```

## 🇷🇺 Российские площадки

Career-ops поддерживает ключевые российские джоб-борды:

| Площадка            | URL                                        | Тип       | Особенности                                                  |
| ------------------- | ------------------------------------------ | --------- | ------------------------------------------------------------ |
| **HeadHunter**      | [hh.ru](https://hh.ru)                     | API + Web | Главная площадка РФ. Открытый API. 600k+ IT-вакансий         |
| **Хабр Карьера**    | [career.habr.com](https://career.habr.com) | Web       | IT-вакансии, грейды, зарплатные вилки, техническое комьюнити |
| **Работа в России** | [trudvsem.ru](https://trudvsem.ru)         | API + Web | Госпортал Роструда. Открытый API для массового парсинга      |
| **Rabota.ru**       | [rabota.ru](https://rabota.ru)             | Web       | Принадлежит Сберу. Крупные компании, финтех                  |
| **Superjob**        | [superjob.ru](https://www.superjob.ru)     | Web       | Вторая по величине после hh.ru                               |
| **Geekjob**         | [geekjob.ru](https://geekjob.ru)           | Web       | IT-вакансии с указанием вилок                                |
| **Буду**            | [budu.jobs](https://budu.jobs)             | Web       | IT-вакансии, бывший Хантфлоу                                 |

**Telegram-каналы** (мониторинг вручную): @devjobs, @frontendjob, @gophersjob, @phpjobsru, @remote_it

### Особенности российского рынка в оценке

- **Зарплата**: gross (до НДФЛ 13%) vs net (на руки) — система учитывает разницу
- **Оформление**: ТК РФ, ГПХ, самозанятость — влияет на оценку стабильности
- **Бенефиты**: ДМС, ДМС стомат., компенсация питания/спорта/обучения
- **Испытательный срок**: до 3 мес. (6 мес. для руководителей по ТК РФ)
- **Отпуск**: 28 календарных дней минимум по ТК + доп. дни

## Настройка порталов

Сканер работает с `portals.yml`. Скопируйте шаблон и добавьте нужные компании и российские площадки:

**AI Labs:** Anthropic, OpenAI, Mistral, Cohere, LangChain, Pinecone
**Voice AI:** ElevenLabs, PolyAI, Parloa, Hume AI, Deepgram
**AI Platforms:** Retool, Airtable, Vercel, Temporal, Glean
**Automation:** n8n, Zapier, Make.com

**🇷🇺 Россия:** Добавьте вручную в `portals.yml`: hh.ru, Хабр Карьера, trudvsem.ru, rabota.ru, Superjob, Geekjob — используйте структуру `templates/portals.example.yml` как образец формата (готовых RU-записей в шаблоне нет).

**Джоб-борды:** Ashby, Greenhouse, Lever, Wellfound, Workable (поддерживаются через WebSearch/WebFetch)

## Dashboard TUI

Встроенный терминальный дашборд для визуального просмотра пайплайна:

```bash
npm run serve:dashboard   # launch the TUI
npm run build:dashboard   # optional: build the standalone binary
```

Возможности: 6 табов фильтрации, 4 режима сортировки, группированный/плоский вид, ленивая подгрузка превью, смена статусов inline.

## Структура проекта

```
career-ops/
├── CLAUDE.md                    # Инструкции для агента
├── cv.md                        # Ваше CV (создайте)
├── config/
│   └── profile.example.yml      # Шаблон профиля
├── modes/                       # 14 режимов навыков
│   ├── _shared.md               # Общий контекст
│   ├── oferta.md                # Оценка вакансии
│   ├── pdf.md                   # Генерация PDF
│   ├── scan.md                  # Сканер порталов
│   ├── batch.md                 # Пакетная обработка
│   ├── ru/                      # 🇷🇺 Русские режимы (6 файлов)
│   └── ...
├── templates/
│   ├── cv-template.html         # ATS-шаблон резюме
│   ├── portals.example.yml      # Конфигурация сканера
│   └── states.yml               # Канонические статусы
├── batch/                       # Пакетная обработка
├── dashboard/                   # Go TUI
├── data/                        # Данные трекинга (gitignored)
├── reports/                     # Отчёты оценки (gitignored)
├── output/                      # Сгенерированные PDF (gitignored)
├── fonts/                       # Space Grotesk + DM Sans
├── docs/                        # Документация
└── examples/                    # Примеры CV, отчётов
```

## Технологии

- **Агент**: Claude Code с кастомными навыками и режимами
- **PDF**: Playwright + HTML-шаблон
- **Сканер**: Playwright + Greenhouse API + WebSearch
- **Dashboard**: Go + Bubble Tea + Lipgloss (тема Catppuccin Mocha)
- **Данные**: Markdown-таблицы + YAML-конфиг + TSV-файлы батчей

## FAQ

**Для чего нужен career-ops?**
career-ops — это приложение для поиска работы с открытым кодом, запускающийся через CLI. Данное приложение превращает CLI с встроенным AI-агентом в систему, которая будет оценивать, насколько вакансии соответствуют вашему резюме, генерировать файлы в формате PDF, адаптированные под каждый ATS, искать нужного человека для связи, и, конечно же, все будет отслеживаться в одном месте, оставляя окончательное решение за вами. Является первой реализацией CareerOps Manifesto. Подробнее: [career-ops.org](https://career-ops.org).

**Можно ли использовать career-ops бесплатно или на более дешёвой/локальной модели?**
Да. career-ops не привязан к конкретному CLI и работает с бесплатными и локальными моделями — через OpenRouter, Ollama или любой другой OpenAI-совместимой точкой доступа — поэтому платная подписка необязательна. Ознакомиться с полной настройкой можно в [docs/RUNNING_ON_A_BUDGET.md](docs/RUNNING_ON_A_BUDGET.md)

**С каким AI CLI работает career-ops?**
career-ops работает с любым крупным AI CLI — Claude Code, Codex, Gemini / Antigravity, OpenCode, Grok, Qwen и другими — через открытый стандарт Agent Skill Standard, поэтому не привязан к одному поставщику. Используйте уже имеющийся CLI.

**Как установить career-ops на Windows?**
career-ops работает на Windows. Если навыки не загружаются из-за ошибки с символическими ссылками (symlink error) во время установки, ознакомьтесь с решением в [docs/FAQ.md](docs/FAQ.md). Полная инструкция в [docs/SETUP.md](docs/SETUP.md).

**career-ops отправляет заявки автоматически за меня?**
Нет. career-ops — это фильтр, а не автоматический рассыльщик. AI оценивает, ранжирует и создаёт черновики. Вы же проверяете их и принимаете решения. Он никогда не отправляет, не посылает и не нажимает ничего за вас — окончательный выбор всегда за вами. Принцип «человек в цикле» является ключевым.

**career-ops бесплатный? с открытым исходным кодом?**
Да. career-ops бесплатен и имеет открытый исходный код, и для соискателей всегда таким останется — это первая реализация [CareerOps Manifesto](https://career-ops.org/manifesto). Прочтите, и если он отражает ваши убеждения, пожалуйста, подпишите его.

## Дисклеймер

**career-ops — локальный open-source инструмент, НЕ хостинг-сервис.** Используя это ПО, вы подтверждаете:

1. **Вы контролируете свои данные.** CV, контакты и персональные данные остаются на вашей машине и отправляются напрямую выбранному AI-провайдеру (Anthropic, OpenAI и др.). Мы не собираем и не храним ваши данные.
2. **Вы контролируете ИИ.** Промты по умолчанию запрещают ИИ автоматически отправлять отклики, но модели могут вести себя непредсказуемо. Модификация промтов — на ваш риск. **Всегда проверяйте сгенерированный контент перед отправкой.**
3. **Соблюдайте ToS площадок.** Используйте инструмент в соответствии с правилами порталов (hh.ru, Хабр Карьера, LinkedIn и др.). Не спамьте работодателей.
4. **Нет гарантий.** Оценки — рекомендации, не истина. ИИ может галлюцинировать. Авторы не несут ответственности за результаты трудоустройства.

Подробнее: [LEGAL_DISCLAIMER.md](LEGAL_DISCLAIMER.md). ПО распространяется по [лицензии MIT](LICENSE) «как есть», без каких-либо гарантий.

## Лицензия

MIT
