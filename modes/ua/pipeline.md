# Режим: pipeline — Черга URL (Second Brain)

Обробляє URL вакансій з `data/pipeline.md`. Користувач додає URL коли завгодно, потім запускає `/career-ops pipeline` для обробки.

## Workflow

1. **Прочитати** `data/pipeline.md` → знайти `- [ ]` в секції "Очікуючі" (або "Pendientes" / "Pending" — pipeline.md може містити заголовки будь-якою мовою)
2. **Для кожного URL**:
   a. Зарезервувати наступний `REPORT_NUM` атомарно, запустивши `node reserve-report-num.mjs` (та звільнити маркер, запустивши `node reserve-report-num.mjs --release <num>` після запису звіту)
   b. **🚦 Playwright verification gate (обов'язково):** `browser_navigate` → `browser_snapshot`. Визначити: title + description + Apply button = active; тільки footer/navbar без JD = closed/inactive. **Якщо inactive** → позначити `- [!] URL — Вакансія закрита/неактивна`, пропустити цей URL, перейти до наступного.
   c. **Витягти JD** з того ж Playwright snapshot (або WebFetch/WebSearch як fallback, якщо Playwright вже підтвердив активність)
   d. Якщо URL недоступний (login wall, 404, timeout) → позначити `- [!]` з приміткою, продовжити
   e. **Виконати auto-pipeline**: Оцінка A-F → Звіт .md → PDF (якщо бал >= 3.0) → Трекер
   f. **Перемістити з "Очікуючі" в "Оброблені"**: `- [x] #NNN | URL | Компанія | Роль | Бал/5 | PDF ✅/❌`
3. **Якщо 3+ URL**, паралелізація з Agent tool (`run_in_background`). **Обмеження:** тільки **один** Playwright-агент одночасно (правило `_shared.md`). Рекомендована схема: один агент послідовно проходить verification gate для кожного URL через Playwright; після підтвердження активності — запускає окремих агентів для evaluation/report/PDF (WebFetch, оцінка, генерація звіту паралельно). Жоден агент не починає evaluation, поки Playwright gate не підтвердив, що вакансія активна.
4. **По завершенні** показати таблицю:

```
| # | Компанія | Роль | Бал | PDF | Рекомендована дія |
```

## Формат pipeline.md

```markdown
## Очікуючі

- [ ] https://jobs.example.com/posting/123
- [ ] https://dou.ua/vacancies/company-role/ | Компанія | Senior Backend
- [!] https://private.url/job — Помилка: потрібна авторизація

## Оброблені

- [x] #143 | https://jobs.example.com/posting/789 | Acme Corp | AI PM | 4.2/5 | PDF ✅
- [x] #144 | https://djinni.co/jobs/123456 | BigCo | Backend | 2.1/5 | PDF ❌
```

## Визначення JD з URL

1. **Playwright (переважно):** `browser_navigate` + `browser_snapshot`. Працює з усіма SPA.
   - **Опційно — CLI-екстрактор (`scan.extractor: cli` у `config/profile.yml`):** натомість запустіть `node browser-extract.mjs <url>` (`--mode jd`) — компактний `{ "url", "title", "text" }`, менше токенів (залежно від порталу). У разі помилки чи відсутності **тихо** відкотіться до `browser_navigate` + `browser_snapshot`.
2. **WebFetch (fallback):** Для статичних сторінок.
3. **WebSearch (останній ресурс):** Пошук на вторинних порталах.

**Особливі випадки:**

- **DOU.ua**: Парсити сторінку вакансії через Playwright
- **Djinni.co**: Може вимагати логін → позначити `[!]`, попросити вставити текст
- **LinkedIn**: Може вимагати логін → позначити `[!]`, попросити вставити текст
- **PDF**: Якщо URL на PDF — прочитати через Read tool
- **`local:` префікс**: Читати локальний файл. Приклад: `local:jds/company-role.md`

## Нумерація

1. Запустити `node reserve-report-num.mjs` для атомарного резервування наступного порядкового номера (stdout поверне `{###}`).
2. Записати файл звіту, використовуючи цей номер.
3. Звільнити маркер, запустивши `node reserve-report-num.mjs --release {###}` після запису звіту.

## Синхронізація джерел

Перед обробкою URL:

```bash
node cv-sync-check.mjs
```

Якщо розсинхронізація — попередити користувача.
