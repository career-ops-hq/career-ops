# 模式: pipeline — 待處理 URL 收件匣（第二大腦）

用於批次處理記錄在 `data/pipeline.md` 中的職缺 URL。求職者可以隨時把看到的職缺連結丟進待處理清單，之後執行 `/career-ops pipeline` 一次自動評估所有機會。

## 即時工作流程

1. **讀取資料**：分析 `data/pipeline.md`，找出 "Pending" 區塊下所有標記為 `- [ ]` 的待處理項目。
2. **逐一處理**：對每一個未處理的 URL：
   a. **計算新報告編號**：掃描 `reports/` 目錄，找出目前最大的三位數字前綴並加 1，作為 `REPORT_NUM`。
   b. **擷取職缺描述 (JD)**：首選 Playwright（透過 `browser_navigate` + `browser_snapshot`）渲染網頁擷取；次選 `WebFetch` 抓取靜態文字；最後以 `WebSearch` 搜尋同名職缺的快照。
   c. **例外處理**：若連結因權限、失效等原因完全打不開，將該項標記為 `- [!]`，附上錯誤描述，然後繼續處理下一個。
   d. **執行一鍵管線評估**：跑 A–F 各維度評估 → 存成報告 `.md` → 依設定產生履歷 PDF（若評分達門檻）→ 自動登錄至 tracker。
   e. **把紀錄從「待處理」移入「已處理」**：更新狀態為 `- [x] #NNN | 職缺連結 | 公司名稱 | 職缺名稱 | 評分/5 | PDF 狀態`。

   **自動產生 PDF 的分流控制（可設定）：**
   系統會讀取個人設定 `config/profile.yml` 中的 `auto_pdf_score_threshold`（自動產生 PDF 的評分門檻）。若該設定不存在，預設門檻為 `3.0`。
   若本次職缺的評分低於門檻，系統會**跳過**履歷 PDF 的產生步驟（照常撰寫評估報告，並在報告開頭標明 `**PDF:** not generated — run /career-ops pdf {company-slug} to create on demand`，同時在 tracker 的 PDF 欄登記為 ❌）。
   若評分等於或高於門檻，則照常自動產生量身打造的履歷 PDF。

   *註：這個機制可以大幅節省批次掃描時的 Playwright 渲染排版開銷（每次渲染需要 30–60 秒）。求職者之後可以針對心儀的職缺，單獨執行指令產生 PDF。*
3. **並行加速**：若待處理的 URL 達到 3 個以上，建議以並行方式（在背景啟動子 Agent）同時執行評估，以達到最高處理效率。
4. **輸出批次總結**：處理完畢後，輸出一份彙總表格：

```text
| 編號 | 公司名稱 | 職缺名稱 | 綜合評分 | PDF 狀態 | 投遞建議 |
```

---

## `pipeline.md` 語法規範

```markdown
## Pending
- [ ] https://jobs.example.com/posting/123
- [ ] https://boards.greenhouse.io/company/jobs/456 | 某某科技 | 資深 AI 產品經理
- [!] https://private.url/job — 錯誤：需要登入後才能檢視

## Processed
- [x] #143 | https://jobs.example.com/posting/789 | 極客科技 | AI 研發工程師 | 4.2/5 | PDF ✅
- [x] #144 | https://boards.greenhouse.io/xyz/jobs/012 | 某大廠 | 解決方案架構師 | 2.1/5 | PDF ❌
```

---

## 智慧解析 URL 職缺描述

1. **Playwright（首選）**：`browser_navigate` + `browser_snapshot`。能穩定處理所有單頁式應用 (SPA)。
   - **可選 — CLI 擷取器（`config/profile.yml` 中的 `scan.extractor: cli`）：** 改為執行 `node browser-extract.mjs <url>`（`--mode jd`）——精簡的 `{ "url", "title", "text" }`，更少 token（視職缺網站而定）。發生錯誤或缺少時**靜默**回退至 `browser_navigate` + `browser_snapshot`。
2. **WebFetch（次選）**：適用於靜態頁面，或在 Playwright 環境不可用時作為後備。
3. **WebSearch（最終手段）**：在第三方求職聚合平台上找同名職缺的快照。

**特殊情況處理：**
- **LinkedIn**：可能會觸發強制登入的攔截。若多次失敗，標記為 `[!]` 並引導求職者直接貼上 JD 全文。
- **PDF 檔案**：若 URL 直接指向一份 PDF 文件，使用 Read 工具讀取該二進位檔案。
- **本機檔案前綴 `local:`**：若是本機路徑，直接讀取對應檔案。例如：`local:jds/linkedin-pm-ai.md` 代表讀取本機的 `jds/linkedin-pm-ai.md`。

---

## 資料一致性檢核

啟動處理之前，先執行以下腳本檢查履歷與設定的同步狀態：

```bash
node cv-sync-check.mjs
```

若偵測到履歷或個人偏好資料有脫節風險，在繼續執行前先向求職者提出警示。
