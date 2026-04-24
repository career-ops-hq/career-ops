# Career-Ops

[English](README.md) | [Español](README.es.md) | [Português (Brasil)](README.pt-BR.md) | [한국어](README.ko-KR.md) | [日本語](README.ja.md) | [Русский](README.ru.md) | [简体中文](README.cn.md) | [繁體中文](README.zh-TW.md)

<p align="center">
  <a href="https://x.com/santifer"><img src="docs/hero-banner.jpg" alt="Career-Ops — 多代理求職系統" width="800"></a>
</p>

<p align="center">
  <em>我花了好幾個月用最費力的方式找工作。所以我打造了一個當初就希望能擁有的系統。</em><br>
  企業用 AI 篩選候選人。<strong>我把 AI 交給候選人，讓他們來<em>挑選</em>企業。</strong><br>
  <em>現在，它開源了。</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Claude_Code-000?style=flat&logo=anthropic&logoColor=white" alt="Claude Code">
  <img src="https://img.shields.io/badge/OpenCode-111827?style=flat&logo=terminal&logoColor=white" alt="OpenCode">
  <img src="https://img.shields.io/badge/Codex_(soon)-6B7280?style=flat&logo=openai&logoColor=white" alt="Codex">
  <img src="https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/Go-00ADD8?style=flat&logo=go&logoColor=white" alt="Go">
  <img src="https://img.shields.io/badge/Playwright-2EAD33?style=flat&logo=playwright&logoColor=white" alt="Playwright">
  <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT">
  <a href="https://discord.gg/8pRpHETxa4"><img src="https://img.shields.io/badge/Discord-5865F2?style=flat&logo=discord&logoColor=white" alt="Discord"></a>
  <br>
  <img src="https://img.shields.io/badge/EN-blue?style=flat" alt="EN">
  <img src="https://img.shields.io/badge/ES-red?style=flat" alt="ES">
  <img src="https://img.shields.io/badge/DE-grey?style=flat" alt="DE">
  <img src="https://img.shields.io/badge/FR-blue?style=flat" alt="FR">
  <img src="https://img.shields.io/badge/PT--BR-green?style=flat" alt="PT-BR">
  <img src="https://img.shields.io/badge/KO-white?style=flat" alt="KO">
  <img src="https://img.shields.io/badge/JA-red?style=flat" alt="JA">
  <img src="https://img.shields.io/badge/ZH--TW-blue?style=flat" alt="ZH-TW">
</p>

---

<p align="center">
  <img src="docs/demo.gif" alt="Career-Ops 示範" width="800">
</p>

<p align="center"><strong>評估超過 740 份職缺 · 生成超過 100 份個人化履歷 · 成功獲得理想職位</strong></p>

<p align="center"><a href="https://discord.gg/8pRpHETxa4"><img src="https://img.shields.io/badge/加入社群-Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord"></a></p>

## 這是什麼

Career-Ops 能將任何 AI 程式碼 CLI 轉化為完整的求職指揮中心。不再需要手動用試算表追蹤應徵紀錄，而是獲得一個 AI 驅動的管道，能夠：

- **評估職缺** — 結構化的 A-F 評分系統（10 個加權評估維度）
- **生成客製化 PDF** — 針對每份職缺描述進行 ATS 最佳化的履歷
- **自動掃描求職平台**（Greenhouse、Ashby、Lever、企業頁面）
- **批次處理** — 透過子代理並行評估 10 份以上的職缺
- **集中管理一切** — 單一資料來源，附完整性檢查

> **重要：這不是廣撒網的工具。** career-ops 是一個篩選器 — 它幫助你從數百份職缺中找出真正值得投入的少數機會。本系統強烈建議不要應徵評分低於 4.0/5 的職缺。你的時間很寶貴，招募人員的時間也是。送出前務必仔細審閱。

career-ops 具有代理能力：Claude Code 透過 Playwright 瀏覽求職頁面，藉由推理你的履歷與職缺描述的契合度（而非關鍵字比對）進行評估，並針對每份職缺調整你的履歷。

> **注意：最初幾次評估的品質可能不盡理想。** 因為系統還不了解你。請提供更多背景資訊 — 你的履歷、職涯故事、成就佐證、個人偏好、你的專長以及希望避免的事情。你餵給它的資訊越多，它就越準確。把它當作招募新人的招募顧問：第一週需要學習認識你，之後就會成為不可或缺的夥伴。

這個系統由一位親身使用它評估超過 740 份職缺、生成超過 100 份客製化履歷、並成功獲得 Head of Applied AI 職位的人所打造。[閱讀完整案例研究](https://santifer.io/career-ops-system)。

## 功能特色

| 功能 | 說明 |
|------|------|
| **自動管道** | 貼上 URL，自動完成評估 + PDF + 追蹤紀錄 |
| **6 區塊評估** | 職位摘要、履歷匹配、職級策略、薪酬調查、個人化、面試準備（STAR+R）|
| **面試故事庫** | 跨評估累積 STAR+Reflection 故事 — 能回答任何行為面試問題的 5-10 個核心故事 |
| **薪資談判腳本** | 薪資談判框架、地區薪資折扣反駁話術、競爭 Offer 運用策略 |
| **ATS PDF 生成** | 注入關鍵字的履歷，採用 Space Grotesk + DM Sans 設計 |
| **平台掃描器** | 預設超過 45 家企業（Anthropic、OpenAI、ElevenLabs、Retool、n8n...）+ 跨 Ashby、Greenhouse、Lever、Wellfound 的自訂查詢 |
| **批次處理** | 使用 `claude -p` 工作器並行評估 |
| **儀表板 TUI** | 在終端機 UI 中瀏覽、篩選及排序你的求職管道 |
| **人機協作** | AI 負責評估與建議，你負責決策與行動。系統絕不自動送出應徵 — 最終決定永遠在你手上 |
| **管道完整性** | 自動合併、去重、狀態正規化、健康檢查 |

## 快速開始

```bash
# 1. 複製並安裝
git clone https://github.com/santifer/career-ops.git
cd career-ops && npm install
npx playwright install chromium   # PDF 生成所需

# 2. 檢查設定
npm run doctor                     # 驗證所有必要條件

# 3. 設定檔
cp config/profile.example.yml config/profile.yml  # 填入你的個人資訊
cp templates/portals.example.yml portals.yml       # 自訂目標企業

# 4. 加入你的履歷
# 在專案根目錄建立 cv.md，以 Markdown 格式撰寫你的履歷

# 5. 透過 Claude 個人化設定
claude   # 在此目錄開啟 Claude Code

# 然後請 Claude 幫你調整系統：
# 「把職位類型改成後端工程師相關職缺」
# 「把模式翻譯成繁體中文」
# 「把這 5 家公司加入 portals.yml」
# 「用我貼的這份履歷更新我的個人檔案」

# 6. 開始使用
# 貼上職缺 URL 或執行 /career-ops
```

> **這個系統設計上就是讓 Claude 來客製化的。** 模式、職位類型、評分權重、談判腳本 — 直接告訴 Claude 要修改什麼，它就會動手。Claude 讀取的是它自己使用的相同檔案，所以它確切知道要編輯哪裡。

完整設定指南請參閱 [docs/SETUP.md](docs/SETUP.md)。

## 使用方式

career-ops 是一個具有多種模式的單一斜線指令：

```
/career-ops                → 顯示所有可用指令
/career-ops {貼上職缺描述}  → 完整自動管道（評估 + PDF + 追蹤）
/career-ops scan           → 掃描平台尋找新職缺
/career-ops pdf            → 生成 ATS 最佳化履歷
/career-ops batch          → 批次評估多份職缺
/career-ops tracker        → 查看應徵狀態
/career-ops apply          → AI 協助填寫應徵表單
/career-ops pipeline       → 處理待辦 URL
/career-ops contacto       → LinkedIn 外寄訊息
/career-ops deep           → 深度公司研究
/career-ops training       → 評估課程/證照
/career-ops project        → 評估作品集專案
```

或者直接貼上職缺 URL 或描述 — career-ops 會自動偵測並執行完整管道。

## 運作原理

```
貼上職缺 URL 或描述
        │
        ▼
┌──────────────────┐
│  職位類型        │  分類：LLMOps / Agentic / PM / SA / FDE / Transformation
│  偵測            │
└────────┬─────────┘
         │
┌────────▼─────────┐
│  A-F 評估        │  匹配度、缺口、薪酬調查、STAR 故事
│  （讀取 cv.md）  │
└────────┬─────────┘
         │
    ┌────┼────┐
    ▼    ▼    ▼
  報告  PDF  追蹤
  .md  .pdf  .tsv
```

## 預設掃描平台

掃描器預設了超過 **45 家企業**及跨主要求職板的 **19 個搜尋查詢**。將 `templates/portals.example.yml` 複製為 `portals.yml` 並自行新增：

**AI 實驗室：** Anthropic、OpenAI、Mistral、Cohere、LangChain、Pinecone
**語音 AI：** ElevenLabs、PolyAI、Parloa、Hume AI、Deepgram、Vapi、Bland AI
**AI 平台：** Retool、Airtable、Vercel、Temporal、Glean、Arize AI
**客服中心：** Ada、LivePerson、Sierra、Decagon、Talkdesk、Genesys
**企業級：** Salesforce、Twilio、Gong、Dialpad
**LLMOps：** Langfuse、Weights & Biases、Lindy、Cognigy、Speechmatics
**自動化：** n8n、Zapier、Make.com
**歐洲：** Factorial、Attio、Tinybird、Clarity AI、Travelperk

**搜尋的求職平台：** Ashby、Greenhouse、Lever、Wellfound、Workable、RemoteFront

## 儀表板 TUI

內建的終端機儀表板讓你以視覺化方式瀏覽求職管道：

```bash
cd dashboard
go build -o career-dashboard .
./career-dashboard --path ..
```

功能：6 個篩選分頁、4 種排序模式、分組/平鋪檢視、延遲載入預覽、內嵌狀態修改。

## 專案結構

```
career-ops/
├── CLAUDE.md                    # 代理指令
├── cv.md                        # 你的履歷（需自行建立）
├── article-digest.md            # 你的成就佐證（選填）
├── config/
│   └── profile.example.yml      # 個人檔案範本
├── modes/                       # 14 個技能模式
│   ├── _shared.md               # 共用情境（在此自訂）
│   ├── oferta.md                # 單一職缺評估
│   ├── pdf.md                   # PDF 生成
│   ├── scan.md                  # 平台掃描器
│   ├── batch.md                 # 批次處理
│   └── ...
├── templates/
│   ├── cv-template.html         # ATS 最佳化履歷範本
│   ├── portals.example.yml      # 掃描器設定範本
│   └── states.yml               # 標準狀態清單
├── batch/
│   ├── batch-prompt.md          # 自包含工作器提示
│   └── batch-runner.sh          # 協調器腳本
├── dashboard/                   # Go TUI 管道檢視器
├── data/                        # 你的追蹤資料（已 gitignore）
├── reports/                     # 評估報告（已 gitignore）
├── output/                      # 生成的 PDF（已 gitignore）
├── fonts/                       # Space Grotesk + DM Sans
├── docs/                        # 設定、自訂化、架構說明
└── examples/                    # 範例履歷、報告、成就佐證
```

## 技術堆疊

![Claude Code](https://img.shields.io/badge/Claude_Code-000?style=flat&logo=anthropic&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-2EAD33?style=flat&logo=playwright&logoColor=white)
![Go](https://img.shields.io/badge/Go-00ADD8?style=flat&logo=go&logoColor=white)
![Bubble Tea](https://img.shields.io/badge/Bubble_Tea-FF75B5?style=flat&logo=go&logoColor=white)

- **代理**：Claude Code，附自訂技能與模式
- **PDF**：Playwright/Puppeteer + HTML 範本
- **掃描器**：Playwright + Greenhouse API + WebSearch
- **儀表板**：Go + Bubble Tea + Lipgloss（Catppuccin Mocha 主題）
- **資料**：Markdown 表格 + YAML 設定 + TSV 批次檔案

## 同樣開源

- **[cv-santiago](https://github.com/santifer/cv-santiago)** — 作者的作品集網站（santifer.io），包含 AI 聊天機器人、LLMOps 儀表板與案例研究。如果你需要一個在求職過程中展示的作品集，可以 fork 它並改造成你自己的。

## 關於作者

我是 Santiago — Head of Applied AI，前創業者（創建並出售了一家至今仍以我名字營運的公司）。我打造 career-ops 是為了管理自己的求職過程，並成功用它找到了現在這份工作。

個人作品集與其他開源專案 → [santifer.io](https://santifer.io)

## Star 歷史

<a href="https://www.star-history.com/?repos=santifer%2Fcareer-ops&type=timeline&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=santifer/career-ops&type=timeline&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=santifer/career-ops&type=timeline&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=santifer/career-ops&type=timeline&legend=top-left" />
 </picture>
</a>

## 免責聲明

**career-ops 是一個本地端開源工具 — 並非託管服務。** 使用本軟體即表示你確認：

1. **你掌控自己的資料。** 你的履歷、聯絡資訊和個人資料僅儲存於你的裝置上，並直接傳送至你所選擇的 AI 服務供應商（Anthropic、OpenAI 等）。我們不會收集、儲存或存取你的任何資料。
2. **你掌控 AI。** 預設提示詞已指示 AI 不要自動送出應徵，但 AI 模型的行為可能無法預測。如果你修改提示詞或使用不同的模型，風險由你自行承擔。**送出前務必確認 AI 生成內容的正確性。**
3. **你須遵守第三方服務條款。** 你必須依據你所操作的求職平台（Greenhouse、Lever、Workday、LinkedIn 等）的服務條款使用本工具。請勿使用本工具向雇主發送垃圾訊息或對 ATS 系統造成過多負擔。
4. **不提供任何保證。** 評估結果僅為建議，並非事實。AI 模型可能會產生幻覺，錯誤描述技能或經歷。作者對於任何就業結果、應徵被拒、帳號限制或其他後果概不負責。

詳細內容請參閱 [LEGAL_DISCLAIMER.md](LEGAL_DISCLAIMER.md)。本軟體依 [MIT 授權條款](LICENSE) 以「現狀」提供，不附帶任何形式的保證。

## 貢獻者

<a href="https://github.com/santifer/career-ops/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=santifer/career-ops" />
</a>

使用 career-ops 找到工作了嗎？[分享你的故事！](https://github.com/santifer/career-ops/issues/new?template=i-got-hired.yml)

## 授權條款

MIT

## 聯絡我

[![Website](https://img.shields.io/badge/santifer.io-000?style=for-the-badge&logo=safari&logoColor=white)](https://santifer.io)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white)](https://linkedin.com/in/santifer)
[![X](https://img.shields.io/badge/X-000?style=for-the-badge&logo=x&logoColor=white)](https://x.com/santifer)
[![Discord](https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/8pRpHETxa4)
[![Email](https://img.shields.io/badge/Email-EA4335?style=for-the-badge&logo=gmail&logoColor=white)](mailto:hi@santifer.io)
