# fork-notes — 本 fork 專屬文件

[English](README.md) · **繁體中文**

本目錄存放**只屬於這個 fork**（`rojarsmith/career-ops-max`）的研究、規劃與過程紀錄。
上游（`santifer/career-ops`）不會有這個目錄，所以這裡的內容不會和上游更新互相衝突。

## 為什麼放這裡，而不是 `docs/`

| 同步方式 | `fork-notes/` 為什麼安全 |
|----------|--------------------------|
| 從上游 `git merge` | 上游沒有 `fork-notes/` 目錄，合併時不會動到這些檔案。 |
| `node update-system.mjs apply` | `fork-notes/` 已登記在 `config/local-paths.txt`（見 [Fork-local paths](../DATA_CONTRACT.md#fork-local-paths)），更新程式會把它視為使用者層，永遠不寫入。同一個設定也讓 `validate-system-paths-coverage.mjs` 不會把這些檔案判定為孤兒檔。 |

`docs/`、`README.md`、`AGENTS.md`、`CLAUDE.md` 與 `modes/*` 都歸上游管理。fork 專屬的內容不要加進這些位置，也不要在裡面加連結，改由本目錄連出去。

## 本目錄的規則

1. **不放任何隱私資料。** 不寫姓名、Email、電話、身分證號、薪資數字、面試官姓名、招募人員聯絡方式，也不放履歷副本。
   隱私資料只放在已被 gitignore 的使用者層（`cv.md`、`config/profile.yml`、`data/`、`reports/`、`output/`、`local/` 等），不放這裡。
2. **英文為主要語言。** 每份文件都是 `name.md`（英文）加上台灣繁體中文版 `name.zh-TW.md`，兩者第一行互相連結。
   內容不一致時以英文版為準，而且兩份要在同一個 commit 裡一起更新。

## 目錄內容

| 文件 | 用途 |
|------|------|
| [tsmc/playbook.zh-TW.md](tsmc/playbook.zh-TW.md) | 台積電（台灣）求職的逐步設定與工作流程 |
| [tsmc/journal.zh-TW.md](tsmc/journal.zh-TW.md) | 依日期記錄、不含隱私資料的台積電求職日誌 |
| [snippets/custom-bilingual.md](snippets/custom-bilingual.md) | 貼進 `modes/_custom.md` 的雙語產出規則（英文撰寫，供 AI 讀取） |
| [snippets/profile-language.yml](snippets/profile-language.yml) | `config/profile.yml` 的 `language:` 設定區塊 |
| [snippets/portals-tsmc.yml](snippets/portals-tsmc.yml) | 台積電／台灣職缺的 `portals.yml` 起始設定 |
