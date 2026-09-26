# 台積電求職日誌

[English](journal.md) · **繁體中文** · [操作手冊](playbook.zh-TW.md) · [fork-notes 目錄](../README.zh-TW.md)

> 本文為 [journal.md](journal.md) 的台灣繁體中文翻譯；兩者不一致時以英文版為準。

依日期記錄台積電求職過程，**不含隱私資料**：做了什麼、系統產出了什麼、學到了什麼。最新的紀錄放最上面。
英文版要在同一個 commit 裡一起更新。

## 可以寫與不能寫的內容

| 可以記錄 | 絕對不要記錄 |
|----------|-------------|
| 日期、階段與狀態變化（`Evaluated` → `Applied` → `Interview`） | 你的姓名、Email、電話、身分證號、地址 |
| 職務*類別*（例如「製程整合」、「IT／軟體」） | 薪資數字、offer 金額、獎金數字 |
| 報告編號（`#012`），它指向已 gitignore 的 `reports/` | 面試官或招募人員的姓名與聯絡方式 |
| 分數，以及主要影響分數的區塊 | 履歷內文、求職信內文、表單回答 |
| 執行過的指令、遇到的問題與解法 | 求職網站或 Email 的截圖 |
| 心得與流程調整 | 招募人員私下告知的任何內容 |

## 紀錄範本

```markdown
### YYYY-MM-DD — <簡短標題>

- **階段：** 設定 | 找職缺 | 評估 | 投遞 | 面試 | offer | 結束
- **完成事項：** …
- **系統產出：** 報告 #…，分數 …/5，已產生英文＋繁中版（是／否）
- **指令：** `node …`
- **心得／下一步：** …
```

---

## 紀錄

### 2026-09-26 — 完成初始設定

- **階段：** 設定
- **完成事項：** 在私人資料 repo 建立 `config/profile.yml`、`modes/_profile.md`、`modes/_brief.md`、
  `modes/_custom.md`（含雙語規則）、`portals.yml` 與空白追蹤表。目標：台積電軟體相關、經理級以上職務，可接受三個工作地點。
  使用者偏好不需刷 LeetCode 類題目的招募流程；這列為扣 0.5 分的軟性警訊，不是直接淘汰條件。
- **系統產出：** `node doctor.mjs` 回報 `onboardingNeeded: false`，沒有未個人化的檔案。
  `validate-portals.mjs` 與 `validate-profile.mjs` 都沒有問題。
- **待解決：** 對話中提到的期望薪資，和 104 匯出履歷上的數字不一致。確認之前，設定檔兩個數字都保留。
- **下一步：** 用網址評估第一個真實的台積電職缺。

### 2026-09-26 — 接上私人資料 repo

- **階段：** 設定
- **完成事項：** 建立存放個人資料的私人 GitHub repo，並接上雲端工作階段。用環境變數
  `CAREER_OPS_ROOT=../career-ops-max-rojarsmith` 把 `{DATA_ROOT}` 指向它，`node doctor.mjs` 就能在那裡找到 `cv.md`。
  一開始試過 commit `.career-ops-data` 標記檔，但放棄了：它會讓 `test-all.mjs` 第 20 節失敗（該節檢查沒設變數時資料目錄為預設值）。改用環境變數後快速測試全部通過；但設了變數時，有些測試會把測試檔寫進資料目錄，所以跑測試要用 `env -u CAREER_OPS_ROOT`。
- **系統產出：** 尚無。還缺 `config/profile.yml`、`modes/_profile.md`、`portals.yml`。
- **心得：** Claude GitHub App 只看得到被授權的 repo，新建的私人 repo 要先加進 App 的存取清單，工作階段才接得上。
- **下一步：** 在雲端環境設定加入 `CAREER_OPS_ROOT`；初始設定：用現有的 `cv.md` 和 `cv.zh-TW.md` 建立個人設定、角色原型與職缺來源。

### 2026-09-26 — 從雲端環境測試連線

- **階段：** 設定
- **完成事項：** 把雲端環境的網路存取改成 **Full**，再從雲端工作階段測試台積電與 104 的連線。
- **發現：**
  - 兩個網站都在 **Cloudflare** 後面。一般 HTTP 請求（curl，因此也包括 `scan.mjs` 和 `fetch-jd.mjs`）在雲端會拿到 403 驗證頁。
  - **台積電徵才網站在真正的、有畫面的 Chromium 中可以開啟**（使用 `xvfb-run`）。它是 **Avature** 網站：頁面上有 Avature 的標記，
    `/en_US/careers/SearchJobs` 可以正常使用，顯示 797 筆職缺。原本「ATS 尚未驗證」的註記就此確認；但 `scan.mjs` 的 Avature 串接程式用的是一般 HTTP 請求，在雲端仍會被擋。
  - **104 在雲端連真正的瀏覽器也拒絕**（403，104 自己的錯誤頁）。可能是封鎖非台灣或資料中心的 IP，但這只是推測，尚未證實。
  - 雲端的 Chromium 必須透過工作階段的 proxy，並信任它的 CA（`--ignore-certificate-errors-spki-list=<proxy CA 的 SPKI>`），
    否則所有 HTTPS 頁面都會出現 `ERR_CERT_AUTHORITY_INVALID`。
- **下一步：** 在雲端用有畫面的瀏覽器、貼網址評估台積電職缺；104 職缺改貼 JD 文字。之後若在台灣的電腦上，再用 Avature 設定重跑 `node audit-portals.mjs`。

### 2026-09-25 — 為台積電求職準備好 fork

- **階段：** 設定
- **完成事項：** 建立 fork 專屬文件目錄 `fork-notes/`，並登記在 `config/local-paths.txt`，
  所以從上游 `git merge` 或執行 `update-system.mjs apply` 都不會動到它。完成雙語[操作手冊](playbook.zh-TW.md)與設定片段。
- **系統產出：** 尚無。`cv.md`、`config/profile.yml`、`portals.yml` 都還沒建立。
- **發現：** career-ops 內建台灣市場模式（`modes/zh-TW/`，涵蓋勞動法規、福利與在地求職平台）。
  沒有 104 的串接程式，104 職缺要用貼網址或貼 JD 的方式處理。台積電徵才網站背後的 ATS **尚未驗證**：撰寫這些筆記的雲端工作階段連不到該網站。
- **下一步：** 匯出 104 履歷 → 放進 `documents/cv/` → 執行 intake → 核對 `cv.md` 與 `local/cv.zh-TW.md`；
  用語言設定片段建立 `config/profile.yml`；加入台積電職缺網站並執行 `node audit-portals.mjs`。
