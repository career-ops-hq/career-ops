# 台積電求職操作手冊

[English](playbook.md) · **繁體中文** · [求職日誌](journal.zh-TW.md) · [fork-notes 目錄](../README.zh-TW.md)

> 本文為 [playbook.md](playbook.md) 的台灣繁體中文翻譯；兩者不一致時以英文版為準。

本手冊說明人在台灣、履歷放在 **104人力銀行**，如何用 career-ops 鎖定 **台積電（TSMC）** 的職缺。
所有產出都做兩份：**英文（主要）** 與 **台灣繁體中文（zh-TW）**。

> 本文件不含任何隱私資料。履歷、個人設定、評估報告與 PDF 都放在已 gitignore 的使用者層路徑（見文末表格）。

---

## 0. 一頁看懂流程

```
104 履歷 ──匯出 PDF──▶ documents/cv/ ──intake──▶ cv.md（英文，正本）
                                              └──▶ local/cv.zh-TW.md（繁中譯本）
config/profile.yml  ◀── language: en + modes/zh-TW（台灣市場規則）
modes/_custom.md    ◀── 雙語產出規則（snippets/custom-bilingual.md）
portals.yml         ◀── 台積電職缺網站設定（snippets/portals-tsmc.yml）

台積電／104 職缺 ──貼上網址或 JD──▶ 評估報告（英文）＋ 繁中版
                                   └──▶ 客製履歷 PDF（英文）＋ 繁中 PDF
                                        └──▶ 由你本人在台積電網站送出
```

## 1. 命令列：第一次安裝

需要 **Node.js 18 以上**、**git**，以及一套 AI 程式助理 CLI（本文以 Claude Code 的 `claude` 為例）。
Windows 使用者請另外參考 [docs/WINDOWS.md](../../docs/WINDOWS.md)。

```bash
# 1. 取得這個 fork（已經有了就跳過）
git clone https://github.com/rojarsmith/career-ops-max.git
cd career-ops-max

# 2. 安裝相依套件與 PDF 產生器
npm install
npx playwright install chromium

# 3. 選用，但要從 PDF 匯入履歷就需要：pdftotext
#    macOS: brew install poppler   ·   Debian/Ubuntu: sudo apt install poppler-utils
#    Windows：安裝 Poppler，或改用步驟 2 的「貼上文字」方式

# 4. 健康檢查，會列出還缺哪些檔案：cv.md、config/profile.yml、portals.yml 等
node doctor.mjs

# 5. 在這個資料夾開啟 AI CLI，接下來在對話中完成初始設定
claude
```

之後大部分操作都是在對話中用白話下指令（例如「評估這個職缺」、「產生履歷」），或使用 `/career-ops` 指令。
命令列只用來執行下面各步驟列出的檢查。

## 2. 匯入 104 履歷

career-ops 無法登入 104，也沒有 104 的串接程式，所以要手動搬過來：

1. 在 104 打開你的履歷，**下載或列印成 PDF**。找不到下載選項的話，就用瀏覽器把頁面列印成 PDF。
2. 存成 `documents/cv/104-resume.pdf`。`documents/` 已被 gitignore，檔案不會離開你的電腦。
3. 在對話中說：**「執行 intake 模式」**。助理會在本機擷取文字並提出 `cv.md` 草稿，你確認之前什麼都不會寫入。
4. **英文版是正本。** 104 履歷通常是中文，請助理把 `cv.md` 寫成英文，另外把忠實的繁中版存到 `local/cv.zh-TW.md`（`local/` 已被 gitignore）。
   **兩份的每一項事實都要親自核對。** 翻譯可以調整措辭，但絕不能新增任何主張。兩份內容不一致時以 `cv.md` 為準。

備案：掃描檔或純圖片 PDF 無法擷取文字。改把履歷文字直接貼進對話，說「把這份轉成 cv.md」。

## 3. 個人設定與台灣市場規則

```bash
cp config/profile.example.yml config/profile.yml     # 初始設定已經建立過就跳過
```

- 把 [snippets/profile-language.yml](../snippets/profile-language.yml) 的 `language:` 區塊加進去。
  `output: en` 讓英文維持主要產出語言，`modes_dir: modes/zh-TW` 載入台灣市場規則，涵蓋勞健保與勞退、年終獎金、員工酬勞、競業禁止（勞基法第 9-1 條）、預告期間、責任制（第 84-1 條）等。
- 填入目標職務、所在地（台積電廠區分布在多個科學園區，列出你願意去的地點），以及以新台幣計的薪資目標。台灣模式會用「月薪 ×（12 ＋ 年終月數）」換算年薪。
- 個人化 `modes/_profile.md`（角色原型、職涯敘事）。**第一次評估前先執行 `node doctor.mjs`，確認 `unpersonalized` 是空的。** 否則職缺會用範本作者的求職目標來評分。

## 4. 雙語產出規則

```bash
cp modes/_custom.template.md modes/_custom.md       # 已經存在就跳過
```

把 [snippets/custom-bilingual.md](../snippets/custom-bilingual.md) 的內容附加到 `modes/_custom.md`，它會要求助理：

- 所有給人看的產出都先寫英文版，再寫一份用台灣用語的繁中版（履歷、職缺、面試、薪資；不用中國大陸用語）；
- 繁中版統一放在 `output/zh-TW/`，保留相同的相對路徑，讓 `reports/` 這類由程式檢查的資料夾維持「一份報告一個檔」（`check-jd-archive.mjs` 會檢查每個 `reports/*.md`）；
- 追蹤表、TSV 新增檔與狀態值只用英文，因為程式要解析它們。

## 5. 職缺來源

| 來源 | career-ops 的用法 |
|------|------------------|
| 台積電官方徵才網站 | 在 `portals.yml` 的 `tracked_companies` 加一筆（見 [snippets/portals-tsmc.yml](../snippets/portals-tsmc.yml)）。網站使用 **Avature**，前面有 Cloudflare（2026-09-26 已驗證）。在雲端用一般 HTTP 掃描會被擋，只有真正的瀏覽器能通過，詳見[日誌](journal.zh-TW.md)。加入後執行 `node audit-portals.mjs`；若出現錯誤，改用貼網址的方式評估。 |
| 104 職缺 | 沒有串接程式，把職缺網址或 JD 文字貼進對話即可。 |
| Yourator | 有串接程式（`provider: yourator`），適合台灣新創與數位職缺，可作為比較用；台積電本身不太可能在上面。 |

```bash
node audit-portals.mjs --summary     # career-ops 讀不讀得懂每個職缺網站？
node scan.mjs                        # 零 token 掃描讀得懂的網站
```

把稽核結果記到[求職日誌](journal.zh-TW.md)：台積電由哪個串接程式讀取，或是沒有任何程式能讀取。

## 6. 評估職缺

把台積電或 104 的職缺網址（或 JD 文字）貼進對話，自動流程會：

1. 先確認職缺仍有效，再依 A–F 與 G（職缺真實性）區塊用 1–5 分評分；
2. 寫出英文報告 `reports/{###}-tsmc-{date}.md`（內含逐字封存的 JD），以及繁中版 `output/zh-TW/reports/{###}-tsmc-{date}.md`；
3. 透過 `batch/tracker-additions/` 加上 `node merge-tracker.mjs` 新增一列到追蹤表。

**低於 4.0/5 分時，系統會建議不要投遞。** 重質不重量。

## 7. 客製履歷（英文 ＋ 繁中）

在對話中說：**「幫報告 ### 產生英文和繁中版的履歷 PDF。」**

- 英文：`output/cv-{candidate}-tsmc-….pdf`，由 `cv.md` 產生。
- 繁中：`output/zh-TW/` 下同名檔案，由 `local/cv.zh-TW.md` 用相同的客製方式產生。
- 中文字形來自系統字型（Windows 為微軟正黑體，macOS 為蘋方-繁）。Linux 請先安裝 `fonts-noto-cjk`，否則中文會變成方框。
- 選用檢查：用 `ats` 模式確認每份 PDF 能被 ATS 正確解析。

## 8. 投遞與追蹤

- `apply` 模式可以陪你填寫台積電的應徵表單，但**絕不會按下送出**。送出前由你檢查、由你送出。
- 送出後執行：`node set-status.mjs <報告編號> Applied`。
- 之後的狀態：`Responded` → `Interview` → `Offer` / `Rejected`。面試準備（`interview-prep` 模式）一樣會有繁中版。
- 每個里程碑之後，在日誌加一筆帶日期的紀錄。

## 檔案位置總表

| 項目 | 路徑 | 會 commit 嗎？ |
|------|------|---------------|
| 這些筆記 | `fork-notes/` | 會，公開在這個 fork 中，不含隱私資料 |
| 履歷正本（英文） | `cv.md` | 不會（已 gitignore） |
| 履歷譯本（繁中） | `local/cv.zh-TW.md` | 不會 |
| 104 匯出檔 | `documents/cv/` | 不會 |
| 個人設定、角色原型、自訂規則 | `config/profile.yml`、`modes/_profile.md`、`modes/_custom.md` | 不會 |
| 評估報告（英文） | `reports/` | 不會 |
| 繁中版、PDF | `output/`、`output/zh-TW/` | 不會 |
| 追蹤表 | `data/applications.md` | 不會 |

## 命令列速查

| 指令 | 使用時機 |
|------|---------|
| `node doctor.mjs` | 覺得哪裡怪怪的時候；第一次掃描之前 |
| `node update-system.mjs check` | 檢查上游有沒有新版本（你的資料與 `fork-notes/` 不受影響） |
| `node audit-portals.mjs --summary` | 修改 `portals.yml` 之後 |
| `node scan.mjs` | 尋找新職缺 |
| `node set-status.mjs <#> <狀態>` | 更新追蹤表中的一列 |
| `node verify-pipeline.mjs` | 檢查追蹤表與流程是否健康 |
| `node stats.mjs --summary` | 取得漏斗數字，寫進日誌 |
