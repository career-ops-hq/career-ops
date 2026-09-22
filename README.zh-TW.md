<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/wordmark-dark.svg"><img src="docs/wordmark-light.svg" alt="career-ops" width="250" height="56"></picture></p>

<p align="center">
  <em>我花了好幾個月用最費力的方式找工作。所以我打造了一個當初就希望能擁有的系統。</em><br>
  企業用 AI 篩選候選人。<strong>我把 AI 交給候選人，讓他們來<em>挑選</em>企業。</strong><br>
  它評估、排序、起草。<strong>它從不送出，送出的是你。</strong> 開源，本機執行，屬於你。
</p>

<p align="center">
  <a href="https://x.com/santifer/status/2041403685696053741"><img src="docs/demo.gif" alt="career-ops 流程：已評分的職缺，219 個標記為不申請，然後是一份完整評估" width="800"></a>
</p>

<p align="center"><sub>求職中途的一個切面：流程，然後打開一個職缺，從頭到尾完整評估。</sub></p>

<p align="center"><strong>740 個職缺中，值得申請的有 68 個。12 次面試。1 個 offer。</strong></p>
<p align="center"><sub>一次求職，作者本人的 2026 年紀錄。重要的數字是篩掉了多少，而不是總數。全部數據見<a href="https://santifer.io/career-ops-system">案例研究</a>。</sub></p>

<p align="center"><sub>從不送出、從不寄信、從不回傳資料：<a href="#career-ops-不做的事">它不做的事</a> · 在你已經在用的 AI CLI 裡執行，<a href="docs/RUNNING_ON_A_BUDGET.md">支援免費與本機模型</a>。</sub></p>

<details>
<summary>以 17 種語言閱讀</summary>
<div align="center">

[English](README.md) | [Español](README.es.md) | [Deutsch](README.de.md) | [Français](README.fr.md) | [Português (Brasil)](README.pt-BR.md) | [한국어](README.ko-KR.md) | [日本語](README.ja.md) | [简体中文](README.cn.md) | [繁體中文](README.zh-TW.md) | [Українська](README.ua.md) | [Русский](README.ru.md) | [Polski](README.pl.md) | [Dansk](README.da.md) | [தமிழ்](README.ta.md) | [العربية](README.ar.md) | [हिन्दी](README.hi.md) | [Türkçe](README.tr.md)

</div>
</details>

<hr>

<p align="center">
  <a href="HIRED.md"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fsantifer%2Fcareer-ops%2Fmain%2Fdocs%2Fhired-count.json&query=%24.count&label=%F0%9F%8E%89%20HIRED%20WITH%20CAREER-OPS&suffix=%20verified&color=2ea44f&style=for-the-badge&labelColor=2b3137" alt="透過 career-ops 獲得錄取：已核實數量"></a>
</p>

<p align="center"><sub>拿到 offer 了？<a href="https://github.com/career-ops-hq/career-ops/issues/new?template=i-got-hired.yml">分享一下 →</a> · 你的卡片會讓正在求職的人看到出路是存在的。</sub></p>

<p align="center">
  <a href="HIRED.md"><img src="docs/hired-wall.svg" alt="最近三個錄取故事" width="800"></a>
</p>

<p align="center"><sub>每一個數字都是<a href="HIRED.md">可以查核的 →</a>公開故事 · 每一個都從你現在所在的位置開始。</sub></p>

<p align="center"><sub>媒體報導</sub></p>

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

<p align="center"><sub>由 <a href="https://santifer.io">Santiago Fernández de Valderrama Aparicio</a>（<a href="https://github.com/santifer">@santifer</a>）建立並維護</sub></p>

## 這是什麼

career-ops（[career-ops.org](https://career-ops.org)，也叫 **careerops**）是一個開源的 AI 求職工具，在任何 AI 程式碼 CLI 裡於本機執行：它評估職缺、客製你的履歷、追蹤每一次申請，而最終決定始終由你作出。你不再需要手動用試算表追蹤應徵紀錄，而是獲得一條 AI 驅動的流程，能夠：

- **評估職缺**，輸出結構化報告：A 到 H 各個區塊，以及一個 1 到 5 的總評分。評分來自對五個維度的整體判斷，而不是算術公式。區塊 B 的逐項要求重要度欄位和區塊 G 的職缺真實性評估是獨立的、不影響評分的訊號；區塊 H 只在 4.5 分以上時才會撰寫
- **生成客製化 PDF**：針對每份職缺描述進行 ATS 最佳化的履歷
- **自動掃描求職平台**（Greenhouse、Ashby、Lever、企業頁面）
- **批次處理**：透過子代理並行評估 10 份以上的職缺
- **集中管理一切**：單一資料來源，附完整性檢查
- **調查企業並找到該聯絡的人**：申請讓你排進隊伍，調查讓你獲得對話

> **重要：這不是廣撒網的工具。** career-ops 是一個篩選器：它幫助你從數百份職缺中找出真正值得投入的少數機會。本系統強烈建議不要應徵評分低於 4.0/5 的職缺。你的時間很寶貴，招募人員的時間也是。送出前務必仔細審閱。

career-ops 具有代理能力：你選擇的 AI 程式碼 CLI 會透過 Playwright 瀏覽求職頁面，藉由推理你的履歷與職缺描述的契合度（而非關鍵字比對）進行評估，並針對每份職缺調整你的履歷。

> **注意：最初幾次評估的品質可能不盡理想。** 因為系統還不了解你。請提供更多背景資訊：你的履歷、職涯故事、成就佐證、個人偏好、你的專長以及希望避免的事情。你餵給它的資訊越多，它就越準確。把它當作新進的招募顧問：第一週需要先認識你，之後就會成為不可或缺的夥伴。

作者用它評估了 740 個職缺，申請了 68 個，拿到了 Head of Applied AI 的職位。[閱讀完整案例研究](https://santifer.io/career-ops-system)。

## career-ops 不做的事

- **送出申請。** 它只準備答案；打開表單、按下送出的是你。腳本從不發送 POST（`prepare-application.mjs`）。
- **寄送郵件。** 只寫草稿。整個程式碼庫裡沒有任何郵件寄送模組。
- **回傳資料。** 沒有遙測，沒有我們的後端。你的履歷只從你的機器送往你選擇的 AI 供應商，不去任何別的地方。唯一的公開紀錄就是這個儲存庫：`HIRED.md` 和它的 issue。
- **催你申請低於 4.0/5 的職缺。** 它會告訴你別申請。你可以不聽，它會明說。

它會改寫你的履歷，但絕不能捏造。目前這條規則寫在提示詞裡，還沒有變成程式碼裡的強制檢查。每份履歷送出前都請自己讀一遍。詳情見 [FAQ](#常見問題faq)。

## CareerOps 宣言

career-ops 是 [CareerOps 宣言](https://career-ops.org/manifesto?utm_source=readme)的第一個參考實作。讀一讀。如果它說中了你的想法，就簽署它。你的簽名會成為一次 commit。

## 功能特色

| 功能                     | 說明                                                                                                                                     |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **自動流程**             | 貼上一個 URL，獲得完整評估 + PDF + 追蹤紀錄                                                                                               |
| **A-H 評估**             | 職缺摘要、履歷比對（標註每條要求在這個職缺裡有多重要，以及權重來自職缺描述的措辭、結構還是估算，逐條標註；估算永遠不能進入最高一級）、職級策略、薪酬調查、個人化、面試準備（STAR+R），再加上區塊 G 的職缺真實性檢查（標記詐騙與幽靈職缺），以及一個工作許可訊號（把明確不提供簽證擔保的職缺描述標記為硬性阻礙） |
| **面試故事庫**           | 跨評估累積 STAR+反思故事：5 到 10 個能回答任何行為面試問題的主故事                                                                         |
| **談判話術**             | 薪資談判框架、應對地域折價、以競爭 offer 作為籌碼                                                                                         |
| **ATS PDF 產生**         | 注入關鍵字的履歷，Space Grotesk + DM Sans 設計                                                                                            |
| **求職信產生器**         | 基於調查的求職信：關鍵字呼應、四個互動式角度提問（為什麼／問題／方法／語氣）、在對話中審核草稿，以及透過與履歷相同的 HTML + Playwright 流程產生 A4 PDF。每次評估自動起草；用 `/career-ops cover` 依需求完成並產生 |
| **申請郵件草稿**         | 從報告或貼上的職缺描述產生給招募人員、內推或主動應徵的正式郵件，包含主旨、附件清單、有憑有據的契合點，以及來自你個人資料的聯絡資訊區塊。僅限草稿：career-ops 從不寄送、送出或點擊任何內容。 |
| **求職平台掃描器**       | 預先設定 100+ 家企業（Anthropic、OpenAI、ElevenLabs、Retool、n8n…）+ 跨 Ashby、Greenhouse、Lever、Wellfound 的自訂查詢                     |
| **已募資企業探索**       | 以審閱為先的 `company:funded` 指令從結構化的公開資料來源列出近期獲得募資的企業與來源診斷，不更動你的資料                                    |
| **批次處理**             | 用無頭 CLI worker（`claude -p` / `opencode run`）並行評估                                                                                  |
| **Dashboard TUI**        | 在終端機裡瀏覽、篩選和排序你的流程                                                                                                        |
| **Human-in-the-Loop**    | AI 評估並推薦，你決定並行動。系統從不送出申請：最終決定權永遠在你手上 <!-- hitl: absolute guarantee. Do not add "automatically", "by itself", "without your permission" or any other hedge when translating this row. -->               |
| **流程完整性**           | 自動合併、去重、狀態正規化、健康檢查                                                                                                      |
| **面試套件**             | 按時間區塊安排的準備計畫、附回饋的練習、面試後檢討（[`interview/`](modes/interview/README.md)），以及企業警訊偵測器（[`interview-redflag`](modes/interview-redflag.md)） |
| **Offer 階段**           | 合約閱讀助手：逐條款解讀加上給律師的問題清單（[`offer-prep`](modes/offer-prep.md)），以及期望／公告／實際薪資差距分析器（`salary-gap.mjs`）   |
| **跟進與回覆**           | 跟進節奏計算器與預設提醒（`followup-cadence.mjs`、`followup-seed.mjs`）；把雇主回覆歸類為追蹤紀錄更新（[`reply-watch`](modes/reply-watch.md)） |
| **模式分析**             | 拒信模式與各 ATS 管道的推進率（`analyze-patterns.mjs`）、整個求職週期的漏斗統計（`stats.mjs`）、重複刊登與幽靈職缺偵測（`detect-reposts.mjs`） |
| **外掛系統**             | 可選整合（Gmail、Notion、Apify + 社群註冊表），預設關閉；見 [docs/PLUGINS.md](docs/PLUGINS.md)                                              |
| **履歷之外**             | 企業調查（[`deep`](modes/deep.md)）揭示 AI 策略、近期動向、工程文化，以及你的履歷應該採取的角度。聯絡人探索（[`contacto`](modes/contacto.md)）找出值得聯絡的招募主管、招募人員或團隊成員，並草擬一則不超過 300 字元、針對聯絡人類型調整過的 LinkedIn 訊息。正式申請郵件草稿（[`email`](modes/email.md)）把已評估的報告或貼上的職缺描述變成主旨、內文和附件清單，不寄送、不送出、不點擊任何內容。申請讓你排進隊伍，調查讓你獲得對話。 |

## 快速開始

**最快的方式：一道指令：**

```bash
npx @santifer/career-ops init
```

> 💡 `npx` 隨 [Node.js](https://nodejs.org) 一起提供：它只執行一次安裝程式，
> 不會全域安裝任何東西。還沒有 Node？先安裝它。
> （已經在用 Claude Code / Gemini / Codex CLI？那你已經有了。）

這會把最新版本複製到 `./career-ops` 並安裝相依套件。然後：

```bash
cd career-ops
claude   # or codex / qwen / opencode / agy / grok — open your AI CLI here
```

**首次啟動時，career-ops 會透過對話引導你完成設定：你的履歷、個人資料和目標職缺。不需要手動編輯任何東西。**

<details>
<summary><b>想手動設定？（git clone）</b></summary>

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

### 全域安裝

```bash
npm i -g @santifer/career-ops
```

這會全域安裝 `career-ops` 執行檔，讓你可以直接執行它而不是透過 `npx`。與 `npx @santifer/career-ops init`（用來初始化一個專案目錄）不同，全域安裝會給你一個持久的 `career-ops` 指令，在終端機的任何地方都能用。

**該用哪一個？**
- `npx @santifer/career-ops init`：最適合首次使用；會建立一個專用的專案資料夾。
- `npm i -g @santifer/career-ops`：最適合已有專案資料夾、想直接執行 career-ops 指令的情況。

> **這個系統就是設計成由你的 AI 程式碼 CLI 自己來客製的。** 模式、原型、評分權重、談判話術：直接請它改就行。它讀取的正是它自己使用的檔案，所以它清楚該改哪裡。

完整安裝指南見 [docs/SETUP.md](docs/SETUP.md)；用自訂或本機模型低成本執行 career-ops 的方法見 [docs/RUNNING_ON_A_BUDGET.md](docs/RUNNING_ON_A_BUDGET.md)（在 Antigravity CLI 免費方案零成本執行見 [docs/FREE_TIER.md](docs/FREE_TIER.md)）；排程定期掃描和零 token 的「初篩到短名單」作法見 [docs/AUTOMATION.md](docs/AUTOMATION.md)；ATS 自動填表流程的細節見 [docs/APPLY_AUTOFILL.md](docs/APPLY_AUTOFILL.md)；把 LinkedIn 聯絡人匯出與漏斗中的企業交叉比對見 [docs/LINKEDIN_JOIN.md](docs/LINKEDIN_JOIN.md)；常見設定問題的解答見 [docs/FAQ.md](docs/FAQ.md)，包括[故事溯源如何防止捏造數字](docs/FAQ.md#why-does-career-ops-refuse-to-use-a-number-from-my-story-bank)。設計原則在 [ARCHITECTURE.md](ARCHITECTURE.md)；執行期流程在 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## Antigravity CLI 整合

career-ops 原生支援 Antigravity CLI，方式和支援 Claude Code、OpenCode 一樣。所有斜線指令都透過共用的 skill 進入點提供，使用相同的 `modes/*.md` 評估邏輯。

Google 已把消費者版 Gemini CLI 的存取遷移到 Antigravity CLI。`GEMINI.md` 現在是一個不做任何事的相容性守衛，這樣 Antigravity 在同時讀取 `AGENTS.md` 和 `GEMINI.md` 時不會重複載入完整的專案指令。

### 原生 Antigravity CLI

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

這個 skill 按開放標準定義在 `.agents/skills/career-ops/SKILL.md` 中，並為每個支援的 CLI（例如 `.claude/`、`.cursor/`、`.qwen/`、`.antigravitycli/`、`.grok/`）建立了符號連結或引用。

## Codex 整合

career-ops 透過同一個共用路由支援 Codex，但呼叫方式和自動註冊斜線指令的 CLI 不同。完整指南見 [docs/CODEX.md](docs/CODEX.md)。

### 互動式 Codex

```bash
cd career-ops
codex
```

Codex 裡不保證有斜線指令。如果 `/career-ops` 不可用，就用自然語言請 Codex 直接執行對應模式：

```text
Evaluate this JD with career-ops auto-pipeline: https://company.com/jobs/123
Run the career-ops scan mode and summarize new matches.
Run the career-ops pipeline mode for data/pipeline.md.
Run the career-ops pdf mode for the latest evaluated role.
Run the career-ops tracker mode and summarize the current statuses.
```

### 單次執行的 Codex（`codex exec`）

```bash
codex exec "Evaluate this JD with career-ops auto-pipeline: https://company.com/jobs/123"
codex exec "Run career-ops scan mode in this repo and summarize new matches."
codex exec "Run career-ops pipeline mode for data/pipeline.md."
codex exec "Run career-ops pdf mode for the latest evaluated role."
codex exec "Run career-ops tracker mode and summarize the current statuses."
```

## Grok Build CLI 整合

career-ops 原生支援 Grok Build CLI，方式和支援 Claude Code、OpenCode 一樣。`AGENTS.md` 會作為專案規則自動載入，所有斜線指令都透過共用的 skill 進入點提供。

### 原生 Grok Build CLI

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

無頭批次 worker 請使用 `grok -p "prompt"`（加上 `--yolo` 可自動核准工具執行）。

### 獨立的 Gemini API 腳本（無需安裝 CLI）

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

> **免費方案：** 兩種方式都無需付費。原生 CLI 使用 Google OAuth；API 腳本使用 `gemini-3.6-flash`（速率限制取決於模型和方案；目前配額見 Google AI 文件）。

## 使用方式

career-ops 使用共用的指令路由。在會註冊斜線指令的 CLI 裡，它看起來是這樣：

```
/career-ops           → 顯示所有可用指令
/career-ops {JD}      → 自動流程：評估 + 報告 + PDF + 追蹤紀錄（貼上文字或 URL）
/career-ops pipeline  → 處理收件匣裡待處理的 URL（data/pipeline.md）
/career-ops oferta    → 僅評估，區塊 A 到 G（不自動產生 PDF）
/career-ops ofertas   → 比較並排序多個職缺
/career-ops contacto  → LinkedIn 妙招：找到聯絡人 + 草擬訊息
/career-ops deep      → 針對企業的深度調查提示詞
/career-ops interview-prep → 產生針對特定企業的面試準備文件
/career-ops interview    → 互動式的個人資料／履歷入門訪談
/career-ops eu-swe    → 在履歷／申請／面試前校準一份歐洲 SWE 申請
/career-ops eu-fintech → 掃描 21 個歐洲金融科技求職平台的 Product Manager 職缺（零 token）
/career-ops interview/plan → 為即將到來的面試制定按時間區塊安排的準備計畫
/career-ops interview/practice → 模擬面試，一次一個問題並給出回饋
/career-ops interview/debrief → 面試後檢討：補上短板，預測下一輪
/career-ops interview-redflag → 入職前分析雇主的警訊
/career-ops pdf       → 僅產生 PDF，ATS 最佳化履歷
/career-ops text      → 客製的 markdown 履歷（鏡像 cv.md，不產生 PDF）
/career-ops latex     → 把履歷匯出為 LaTeX/Overleaf .tex
/career-ops latex-tex → 就地客製你自己的 resume.tex（選用；cv.md 仍是預設）
/career-ops cover     → 求職信：單獨貼上職缺描述，或 /career-ops cover {slug}
/career-ops email     → 正式申請郵件草稿（僅草稿；從不寄送、送出或點擊）
/career-ops add       → 向履歷新增專案／論文／職位（擷取 + 預覽 + 確認）
/career-ops expand    → 從個人資料連結自動探索並補充缺少的能力
/career-ops training  → 對照你的 North Star 評估課程／證照
/career-ops project   → 評估一個作品集專案點子
/career-ops tracker   → 申請狀態總覽
/career-ops agent-inbox → 為下一個工作階段排入／清空請求（data/agent-inbox.md）
/career-ops apply     → 即時申請助手（讀取表單 + 產生答案）
/career-ops scan      → 掃描求職平台並發現新職缺
/career-ops discover  → 把企業清單解析為可掃描的 ATS 看板 + 附加到 portals.yml（零 token）
/career-ops batch     → 用並行 worker 批次處理
/career-ops patterns  → 分析拒信模式並改善目標設定
/career-ops offer-prep → 和候選人一起閱讀收到的 offer／合約：逐條款解讀 + 給律師的問題（不是法律建議）
/career-ops titles    → 根據你的履歷推薦相近的職稱以擴大搜尋範圍
/career-ops upskill   → 基於已評估報告的綜合技能落差分析
/career-ops followup  → 跟進節奏追蹤：標記逾期，產生草稿
/career-ops reply-watch → 歸類雇主回覆並建議追蹤紀錄更新
/career-ops outcome   → 記錄申請結果並歸檔產出物
/career-ops calibrate → 諮詢性報告：你的評估分數能預測真實結果嗎？讀取 /outcome 資料；從不改變評分
/career-ops update    → 更新 career-ops 系統檔案，附 diff 預覽 + 相容性檢查
```

或者直接貼上一個職缺 URL 或描述：career-ops 會自動辨識並執行完整流程。

Codex 裡不保證有斜線指令。請改用同樣的模式名稱寫在提示詞裡，或透過 `codex exec` 呼叫。

## 運作原理

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

## 預設掃描平台

掃描器內建 **100+ 家企業**可直接掃描，以及涵蓋主流求職網站的 **45+ 條搜尋查詢**。把 `templates/portals.example.yml` 複製為 `portals.yml`，再加入你自己的：

**AI 實驗室：** Anthropic、OpenAI、Mistral、Cohere、LangChain、Pinecone
**語音 AI：** ElevenLabs、PolyAI、Parloa、Hume AI、Deepgram、Vapi、Bland AI
**AI 平台：** Retool、Airtable、Vercel、Temporal、Glean、Arize AI
**客服中心：** Ada、LivePerson、Sierra、Decagon、Talkdesk、Genesys
**企業級：** Salesforce、Twilio、Gong、Dialpad
**LLMOps：** Langfuse、Weights & Biases、Lindy、Cognigy、Speechmatics
**自動化：** n8n、Zapier、Make.com
**歐洲：** Factorial、Attio、Tinybird、Clarity AI、Travelperk

**搜尋的求職網站：** 55+ 個供應商模組涵蓋 ATS API、整站資料來源、XML/RSS 來源、markdown 來源和本機解析器。完整表格見[支援的求職網站](docs/SUPPORTED_JOB_BOARDS.md)。

預設情況下 `node scan.mjs`（即 `npm run scan`）信任每個 ATS 資料來源回傳的內容。有些企業在職缺關閉後仍會把過期職缺留在公開 API 裡，這些過期項目可能會混進 `pipeline.md`。加上 `--verify` 可以在 API 階段之後啟動 Playwright，在過期職缺進入流程之前把它們剔除：

```bash
node scan.mjs --verify          # zero-token discovery + Playwright liveness check
```

驗證是循序執行的，而且只針對新職缺（去重之後），所以成本是有上限的。

## 儀表板 TUI

內建的終端機儀表板讓你以視覺化方式瀏覽你的流程：

```bash
npm run serve:dashboard   # launch the TUI
npm run build:dashboard   # optional: build the standalone binary
```

功能：6 個篩選分頁、4 種排序模式、分組／平鋪檢視、延遲載入預覽、行內狀態修改。

還有一個**實驗性的 Web UI**（alpha 版，選用：除非你主動啟動，否則不會執行任何東西）：見 [`web/README.md`](web/README.md)。

## 專案結構

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

## 外部資料目錄（選用）

預設情況下，使用者層資料（如 `cv.md`、`portals.yml`，以及 `data/`、`reports/`、`output/` 資料夾）位於專案根目錄內。

為了把個人資料和程式碼分開（更方便切換分支、拉取更新或測試多個個人資料），你可以按以下優先順序設定一個外部資料目錄：

1. **環境變數：** 設定 `CAREER_OPS_ROOT` 或 `CAREER_OPS_DATA_DIR` 環境變數：
   ```bash
   export CAREER_OPS_ROOT=~/my-career-data
   ```
2. **標記檔案：** 在儲存庫根目錄建立一個 `.career-ops-data` 檔案，內容是你的資料目錄路徑。
3. **預設：** 使用儲存庫根目錄。

解析完成後，所有使用者檔案都相對於該資料夾解析和寫入，而提示詞檔案和腳本仍然相對於儲存庫解析。

- **覆寫追蹤檔：** 你也可以設定 `CAREER_OPS_TRACKER` 直接覆寫申請追蹤檔的路徑。
- **寫入：** 所有寫入操作（如合併）都以 `{DATA_ROOT}/data/applications.md` 為標準目標。

Go 版儀表板 TUI、Node.js 腳本和 AI 代理模式都會自動遵循這個解析層級。


## 技術堆疊

![Claude Code](https://img.shields.io/badge/Claude_Code-000?style=flat&logo=anthropic&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-2EAD33?style=flat&logo=playwright&logoColor=white)
![Go](https://img.shields.io/badge/Go-00ADD8?style=flat&logo=go&logoColor=white)
![Bubble Tea](https://img.shields.io/badge/Bubble_Tea-FF75B5?style=flat&logo=go&logoColor=white)

- **代理**：具備共用 skill 和模式的 AI 程式碼 CLI（`AGENTS.md` + 各 CLI 的包裝）
- **PDF**：Playwright + HTML 範本
- **求職信**：HTML 範本 + Playwright（A4 PDF，與履歷相同的流程）
- **掃描器**：Playwright + Greenhouse API + WebSearch
- **儀表板**：Go + Bubble Tea + Lipgloss（Catppuccin Mocha 主題）
- **資料**：Markdown 表格 + YAML 設定 + TSV 批次檔案

## 同樣開源

- **[cv-santiago](https://github.com/santifer/cv-santiago)**：作品集網站（santifer.io），附 AI 聊天機器人、LLMOps 儀表板和案例研究。如果你需要一個配合求職展示的作品集，fork 它，改成你自己的。

## 常見問題（FAQ）

**career-ops 是什麼？**
career-ops 是一個開源的 AI 求職工具，在你的 AI 程式碼 CLI（Claude Code、Codex、OpenCode 等）裡於本機執行，把每一個決定都留給你。它依你的履歷評估職缺、產生適配 ATS 的 PDF、找出該聯絡的對象，並在一個地方追蹤所有進度：最終決定權永遠在你手上。它是 CareerOps 宣言的第一個參考實作。詳見 [career-ops.org](https://career-ops.org)。

**客製化履歷會捏造內容嗎？**
不應該，提示詞裡也這麼寫：只改寫，絕不捏造。但這條規則還沒有由程式碼裡的檢查強制執行。兩個未關閉的 issue 在追蹤：[#2677](https://github.com/career-ops-hq/career-ops/issues/2677)（職稱必須與 cv.md 一致）和 [#1411](https://github.com/career-ops-hq/career-ops/issues/1411)（不通過即阻止的真實性檢查）。在它們合併之前，每份履歷送出前都請自己讀一遍。[法律聲明](LEGAL_DISCLAIMER.md) 用更長的篇幅說了同樣的話。

**我可以免費執行 career-ops，或改用較便宜／本機的模型嗎？**
可以。career-ops 不綁定特定 CLI，也能跑在免費與本機模型上（OpenRouter 的免費模型、Ollama，或任何相容 OpenAI 的端點），所以你不必被付費訂閱綁住。完整設定見 [docs/RUNNING_ON_A_BUDGET.md](docs/RUNNING_ON_A_BUDGET.md)。

**我已經付費訂閱 Claude Pro/Max，為什麼 career-ops 還在燒 API 額度？**
因為環境變數中的 `ANTHROPIC_API_KEY` 優先於你已登入的訂閱：CLI 會改用這把金鑰，並按 token 計費。執行 `echo $ANTHROPIC_API_KEY`，若有印出任何內容，就把它從 shell 設定檔移除、重開終端機並執行 `/login`。批次模式是例外，因為 `claude -p` 的 worker 不會使用互動式登入：執行一次 `claude setup-token`，把結果匯出為 `CLAUDE_CODE_OAUTH_TOKEN`。完整步驟見 [docs/RUNNING_ON_A_BUDGET.md](docs/RUNNING_ON_A_BUDGET.md#2b-already-paying-for-a-subscription-make-sure-you-are-using-it)。

**career-ops 支援哪些 AI CLI？**
career-ops 透過開放的 Agent Skill Standard 跑在各主流 AI 程式碼 CLI 上（Claude Code、Codex、Gemini / Antigravity、OpenCode、Grok、Qwen 等），因此不會被單一廠商綁死。你手上已經有的 CLI 就能直接用。

**要怎麼在 Windows 上安裝 career-ops？**
career-ops 可以在 Windows 上執行。平台相關的設定和已知的坑（Git Bash 偵測、行尾符號、工作排程器）在 [docs/WINDOWS.md](docs/WINDOWS.md)。如果安裝過程中技能因 symlink 錯誤而載入失敗，解法在 [docs/FAQ.md](docs/FAQ.md)。完整步驟見 [docs/SETUP.md](docs/SETUP.md)。

**career-ops 會自動幫我投遞職缺嗎？**
不會。career-ops 是篩選器，不是亂槍打鳥的自動投遞工具。AI 負責評估、排序與草擬；審閱與決定由你來做。它從不送出、寄出或點擊任何東西：最終決定權永遠在你手上。這種保留人工把關的設計，正是整套系統的重點。

**career-ops 是免費且開源的嗎？**
是。career-ops 免費且開源，而且對求職者而言永遠都會是：它是 [CareerOps 宣言](https://career-ops.org/manifesto)的第一個參考實作。讀一讀，如果它說中了你的想法，就簽署它。

## 關於作者

我是 [Santiago Fernández de Valderrama Aparicio](https://santifer.io/about)（santifer）：Head of Applied AI，前創業者（創辦並賣掉了一家至今仍以我的名字營運的公司）。我打造 career-ops 是為了管理自己的求職。它奏效了：我用它拿到了現在的職位。

想知道這個儲存庫是怎麼用每週大約 4 小時維護的？讀一讀 [Agentic maintenance: how career-ops is run by a fleet of AI agents](https://santifer.io/ai-agent-fleet)。

我的作品集和其他開源專案 → [santifer.io](https://santifer.io)

Wikidata：[Santiago Fernández de Valderrama Aparicio](https://www.wikidata.org/wiki/Q138710224) · [career-ops](https://www.wikidata.org/wiki/Q139007988)。

## 免責聲明

**career-ops 是一個在本機執行的開源工具，不是託管服務。** 使用本軟體即表示你確認：

1. **你掌控自己的資料。** 你的履歷、聯絡方式和個人資料留在你的機器上，直接傳送給你選擇的 AI 供應商（Anthropic、OpenAI 等）。我們不收集、不儲存、也無法存取你的任何資料。
2. **你掌控 AI。** 預設提示詞指示 AI 不要自動送出申請，但 AI 模型可能出現無法預測的行為。如果你修改了提示詞或使用其他模型，風險自負。**送出前務必檢查 AI 產生內容的正確性。**
3. **你遵守第三方條款。** 你必須按照所互動求職平台（Greenhouse、Lever、Workday、LinkedIn 等）的服務條款使用本工具。不要用本工具向雇主發送垃圾訊息或衝擊 ATS 系統。
4. **不作任何保證。** 評估是建議，不是事實。AI 模型可能虛構技能或經歷。作者不對就業結果、被拒的申請、帳號限制或任何其他後果負責。

完整內容見 [LEGAL_DISCLAIMER.md](LEGAL_DISCLAIMER.md)。本軟體依據 [MIT 授權](LICENSE)「按原樣」提供，不附帶任何形式的保證。

## 貢獻者

<a href="https://github.com/career-ops-hq/career-ops/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=career-ops-hq/career-ops" />
</a>

每一位貢獻過程式碼、文件、翻譯或測試的人都列在
[CONTRIBUTORS.md](CONTRIBUTORS.md) 裡，包括上面的圖表無法呈現的
非程式碼貢獻。

用 career-ops 找到工作了？[分享你的故事！](https://github.com/career-ops-hq/career-ops/issues/new?template=i-got-hired.yml)

## 授權條款與商標

程式碼以 [MIT](LICENSE) 授權發布。「career-ops」的名稱和
品牌受[商標政策](TRADEMARK.md)約束：對社群使用寬鬆，
對商業產品命名和背書保留權利。

## 榮譽與報導

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
  <sub>也可以在任何符合 agent-skill 標準的 CLI 上執行。見<a href="docs/SUPPORTED_CLIS.md">支援的 CLI</a>。</sub><br>
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

## 聯絡我

[![Website](https://img.shields.io/badge/santifer.io-000?style=for-the-badge&logo=safari&logoColor=white)](https://santifer.io)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white)](https://linkedin.com/in/santifer)
[![X](https://img.shields.io/badge/X-000?style=for-the-badge&logo=x&logoColor=white)](https://x.com/santifer)
[![Discord](https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/8pRpHETxa4)
[![Email](https://img.shields.io/badge/Email-EA4335?style=for-the-badge&logo=gmail&logoColor=white)](mailto:hi@santifer.io)
