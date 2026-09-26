<!--
  custom-bilingual.md — paste everything below the line into modes/_custom.md
  (user layer, gitignored; create it from modes/_custom.template.md first).
  Written in English because the agent reads it. What it does, in 繁體中文：
  所有給人看的產出都做英文（主要）與台灣繁體中文兩份；繁中版放在 output/zh-TW/；
  追蹤表與狀態值只用英文；翻譯不得新增任何事實。
-->

---

## House Rules — bilingual output (EN primary + zh-TW)

1. **Two versions of every human-facing artifact.** Evaluation reports, CVs, cover letters, application
   emails, outreach messages, form-answer drafts, interview prep, offer-prep notes and analysis summaries
   are written first in English (primary, per `language.output: en`), then as a Taiwan Traditional
   Chinese (zh-TW) twin.
2. **Where twins go.** A twin lives under `output/zh-TW/`, at the same relative path and file name as
   its English original. For example, `reports/012-tsmc-2026-10-01.md` →
   `output/zh-TW/reports/012-tsmc-2026-10-01.md`, and `output/cv-x-tsmc.pdf` → `output/zh-TW/cv-x-tsmc.pdf`.
   Never put a twin inside `reports/`, `data/`, `batch/` or `jds/`: scripts validate those folders and
   expect one file per record.
3. **Link the pair.** Markdown twins start with a line linking to the English original, and the English
   original ends with a line linking to its twin.
4. **Taiwan vocabulary, not Mainland.** Use 履歷, 職缺, 面試, 薪資, 軟體, 資料, 專案, 品質, 網路, 使用者.
   Never use 简历, 软件, 数据, 项目, 质量, 网络, 用户, or simplified characters. Follow the glossary in
   `modes/zh-TW/README.md`.
5. **A translation adds nothing.** The zh-TW twin restates the English content. No new claims, metrics,
   titles or skills. Numbers, dates, company and product names stay identical. If a phrase has no clean
   translation, keep the English term and add the Chinese in parentheses.
6. **The zh-TW CV comes from `{DATA_ROOT}/cv.zh-TW.md`,** the user-reviewed translation of `cv.md`, with the
   same tailoring as the English CV for that report. If it disagrees with `cv.md`, `cv.md` wins. Flag the
   discrepancy to the user; don't resolve it silently.
7. **Machine-parsed data stays English-only.** Tracker rows (`data/applications.md`), TSV files in
   `batch/tracker-additions/`, status values, the `## Machine Summary` YAML and `data/*.tsv` get no
   twin and no Chinese text in structured fields.
8. **No private data in `fork-notes/`.** When asked to log progress, write a privacy-safe entry to
   `fork-notes/tsmc/journal.md` and the same entry to `journal.zh-TW.md`: no names, contact details,
   salary figures or CV text.
