# Career-Ops

[English](README.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [Português (Brasil)](README.pt-BR.md) | [한국어](README.ko-KR.md) | [日本語](README.ja.md) | [简体中文](README.cn.md) | [繁體中文](README.zh-TW.md) | [Українська](README.ua.md) | [Русский](README.ru.md) | [Polski](README.pl.md) | [Dansk](README.da.md) | [العربية](README.ar.md) | [हिन्दी](README.hi.md)

<p align="center">
  <a href="https://x.com/santifer"><img src="docs/hero-banner.jpg" alt="Career-Ops 多代理求职系统" width="800"></a>
</p>

<p align="center">
  <em>我花了好几个月用最费力的方式找工作。所以我打造了一个当初就希望拥有的系统。</em><br>
  公司用 AI 筛选候选人。<strong>我把 AI 交给候选人，让他们来<em>挑选</em>公司。</strong><br>
  <em>现在，它开源了。</em>
</p>

<p align="center">
  <a href="https://trendshift.io/repositories/25195" target="_blank"><img src="https://trendshift.io/api/badge/repositories/25195" alt="santifer%2Fcareer-ops | Trendshift" style="width: 245px; height: 54px; vertical-align: middle;" width="245" height="54"/></a>
  &nbsp;&nbsp;
  <a href="https://www.producthunt.com/products/santifer-io?utm_source=badge-featured&utm_medium=badge" target="_blank"><img src="docs/press/producthunt.svg" alt="Career-Ops on Claude | Product Hunt" style="width: 206px; height: 54px; vertical-align: middle;" width="206" height="54"/></a>
</p>

<p align="center"><sub>媒体报道</sub></p>

<p align="center">
  <a href="https://wired.com.gr/article/to-ai-ergaleio-pou-fernei-epanastasi-ston-tropo-pou-psachnoume-douleia/" rel="noopener noreferrer nofollow"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/press/wired-dark.svg"><img src="docs/press/wired.svg" alt="WIRED" height="32"></picture></a>
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <a href="https://www.businessinsider.com/how-i-built-tool-filter-job-listings-landed-head-ai-2026-4" rel="noopener noreferrer nofollow"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/press/business-insider-dark.svg"><img src="docs/press/business-insider.svg" alt="Business Insider" height="32"></picture></a>
</p>

---

<p align="center">
  <img src="docs/demo.gif" alt="Career-Ops 演示" width="800">
</p>

<p align="center"><strong>评估超过 740 个职位 · 生成超过 100 份个性化简历 · 成功拿下理想职位</strong></p>

<p align="center"><a href="https://discord.gg/8pRpHETxa4"><img src="https://img.shields.io/badge/加入社区-Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord"></a>
  &nbsp;
  <a href="https://www.npmjs.com/package/@santifer/career-ops"><img src="https://img.shields.io/npm/dt/@santifer/career-ops?style=for-the-badge&logo=npm&color=CB3837&label=npx%20installs" alt="npm installs"></a></p>

<p align="center">
  <a href="https://claude.com/claude-code"><img src="https://img.shields.io/badge/Built_with-Claude_Code-000?style=for-the-badge&logo=anthropic&logoColor=white" alt="Built with Claude Code"></a>
</p>

<p align="center">
  <sub>同样支持任何符合 agent-skill 标准的 CLI</sub><br>
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

## 这是什么

Career-Ops 可以把任何 AI 编码 CLI 变成完整的求职指挥中心。你不需要再手动用电子表格追踪申请流程，而是获得一个 AI 驱动的管道，能够：

- **评估职位**，使用结构化的 A-F 评分系统（10 个加权维度）
- **生成定制 PDF**，针对每份职位描述输出 ATS 优化简历
- **自动扫描招聘平台**（Greenhouse、Ashby、Lever、公司招聘页）
- **批量处理**，通过子代理并行评估 10 份以上职位
- **集中管理一切**，用单一事实来源配合完整性检查

> **重要：这不是海投工具。** career-ops 是一个过滤器，帮你从数百个职位里找出真正值得投入时间的少数机会。系统强烈建议不要申请评分低于 4.0/5 的职位。你的时间很宝贵，招聘方的时间也一样。提交前一定要自己复核。

career-ops 具备代理式工作能力：Claude Code 会用 Playwright 浏览招聘页面，通过推理你的简历与职位描述是否匹配来评估契合度，而不是只做关键词匹配；同时它也会根据每个职位调整你的简历。

> **提醒：最开始几次评估不会特别准。** 系统还不了解你。请给它更多上下文，比如你的简历、职业故事、成果证明、个人偏好、擅长的事、想避开的事。你喂给它的信息越多，它就越准确。把它当成在培养一个新招聘顾问：第一周它需要先了解你，之后就会变得非常有价值。

这个系统的作者曾用它评估 740 多个职位、生成 100 多份定制简历，并拿到一份 Head of Applied AI 的工作。[阅读完整案例研究](https://santifer.io/career-ops-system)。

## 功能特性

| 功能 | 说明 |
|------|------|
| **自动管道** | 粘贴一个 URL，即可获得完整评估 + PDF + 追踪记录 |
| **6 个评估模块** | 职位总结、简历匹配、职级策略、薪酬调研、个性化建议、面试准备（STAR+R）—— 外加一个用于核查职位真实性的 Block G 模块，可标记诈骗职位和幽灵职位 |
| **面试故事库** | 跨多次评估积累 STAR+Reflection 故事，沉淀出 5-10 个可回答任意行为面试题的主线故事 |
| **谈薪脚本** | 薪资谈判框架、地域折扣反驳话术、竞品 offer 杠杆策略 |
| **ATS PDF 生成** | 注入关键词的简历，采用 Space Grotesk + DM Sans 设计 |
| **平台扫描器** | 预配置 45+ 家公司（Anthropic、OpenAI、ElevenLabs、Retool、n8n...），支持跨 Ashby、Greenhouse、Lever、Wellfound 的自定义查询 |
| **批量处理** | 使用 `claude -p` worker 并行评估 |
| **Dashboard TUI** | 在终端 UI 中浏览、筛选和排序你的求职管道 |
| **人类在环** | AI 负责评估和建议，你负责决定和行动。系统绝不会自动提交申请，最终决定始终在你手上 |
| **管道完整性** | 自动合并、去重、状态标准化和健康检查 |

## 快速开始

**最快的方式 —— 一条命令：**

```bash
npx @santifer/career-ops init
```

> 💡 `npx` 随 [Node.js](https://nodejs.org) 一起提供 —— 它只运行一次安装程序，
> 不会全局安装任何东西。还没有 Node？请先安装它。
> （已经在用 Claude Code / Gemini / Codex CLI？那你已经有它了。）

这会把最新版本克隆到 `./career-ops` 并安装依赖。然后：

```bash
cd career-ops
claude   # 或 gemini / codex / qwen / opencode —— 在这里打开你的 AI CLI
```

**首次启动时，career-ops 会通过对话带你完成设置 —— 你的简历、个人档案和目标职位 —— 完全无需手动编辑任何文件。**

<details>
<summary><b>更喜欢手动设置？（git clone）</b></summary>

```bash
git clone https://github.com/santifer/career-ops.git
cd career-ops && npm install
npx playwright install chromium   # 仅生成 PDF 时需要
claude   # 打开你的 AI CLI —— 它会在首次启动时引导你完成设置
```

</details>

> **这个系统本来就是设计给 Claude 直接定制的。** modes、职业原型、评分权重、谈判脚本，直接告诉 Claude 要改什么就行。Claude 读取的正是它自己会使用的那些文件，所以它知道该改哪里。

完整配置指南见 [docs/SETUP.md](docs/SETUP.md)。

## Gemini CLI 集成

career-ops 原生支持 [Gemini CLI](https://github.com/google-gemini/gemini-cli) —— 与 Claude Code 和 OpenCode 的支持方式相同。所有 15 个斜杠命令均可使用，并基于相同的 `modes/*.md` 评估逻辑。

### 选项 A —— 原生 Gemini CLI（推荐）

```bash
# 1. 安装 Gemini CLI（需要 Node.js 20+）
npm install -g @google/gemini-cli
# 或: npx @google/gemini-cli --version

# 2. 在 career-ops 目录中运行 —— 首次启动时使用你的 Google 账号登录（免费）完成认证
cd career-ops
gemini

# 3. 使用统一的 /career-ops 命令及其子命令：
/career-ops "Anthropic 的资深 AI 工程师..."
/career-ops pipeline
/career-ops scan
/career-ops pdf
/career-ops tracker
```

`GEMINI.md` 文件会自动作为上下文加载。所有子命令都通过统一的 `.agents/skills/career-ops/SKILL.md` 定义进行路由。

### 选项 B —— 独立 API 脚本（无需安装 CLI）

```bash
# 1. 在 https://aistudio.google.com/apikey 获取免费 API 密钥
cp .env.example .env
# 编辑 .env → 设置 GEMINI_API_KEY=***

# 2. 安装依赖
npm install

# 3. 评估职位描述
node gemini-eval.mjs "我们在招聘资深 AI 工程师..."
node gemini-eval.mjs --file ./jds/my-job.txt
npm run gemini:eval -- "职位描述文本"
```

> **免费层：** 两种选项都无需付费。原生 CLI 使用 Google OAuth；API 脚本使用 `gemini-2.0-flash`（15 RPM，每天 1M token 免费）。


## 用法

career-ops 是一个单一斜杠命令，带有多种模式：

```
/career-ops                → 显示所有可用命令
/career-ops {粘贴职位描述}  → 完整自动管道（评估 + PDF + 追踪）
/career-ops scan           → 扫描平台上的新职位
/career-ops pdf            → 生成 ATS 优化简历
/career-ops batch          → 批量评估多个职位
/career-ops tracker        → 查看申请状态
/career-ops apply          → 用 AI 协助填写申请表
/career-ops pipeline       → 处理待办 URL
/career-ops contacto       → 生成 LinkedIn 外联消息
/career-ops deep           → 深度公司研究
/career-ops training       → 评估课程/证书
/career-ops project        → 评估作品集项目
```

或者直接粘贴职位 URL 或职位描述，career-ops 会自动识别并运行完整流程。

## 工作原理

```
粘贴职位 URL 或职位描述
        │
        ▼
┌──────────────────┐
│  职业原型检测    │  分类：LLMOps / Agentic / PM / SA / FDE / Transformation
└────────┬─────────┘
         │
┌────────▼─────────┐
│  A-F 评估        │  匹配度、能力缺口、薪酬调研、STAR 故事
│  （读取 cv.md）  │
└────────┬─────────┘
         │
    ┌────┼────┐
    ▼    ▼    ▼
  报告  PDF  追踪
  .md  .pdf  .tsv
```

## 预配置平台

扫描器默认内置 **45+ 家公司** 和跨主流招聘站点的 **19 个搜索查询**。把 `templates/portals.example.yml` 复制成 `portals.yml` 后，你可以继续添加自己的目标公司：

**AI Labs：** Anthropic、OpenAI、Mistral、Cohere、LangChain、Pinecone
**语音 AI：** ElevenLabs、PolyAI、Parloa、Hume AI、Deepgram、Vapi、Bland AI
**AI 平台：** Retool、Airtable、Vercel、Temporal、Glean、Arize AI
**联络中心：** Ada、LivePerson、Sierra、Decagon、Talkdesk、Genesys
**企业软件：** Salesforce、Twilio、Gong、Dialpad
**LLMOps：** Langfuse、Weights & Biases、Lindy、Cognigy、Speechmatics
**自动化：** n8n、Zapier、Make.com
**欧洲公司：** Factorial、Attio、Tinybird、Clarity AI、Travelperk

**覆盖的招聘平台：** Ashby、Greenhouse、Lever、Wellfound、Workable、RemoteFront

## Dashboard TUI

内置终端仪表盘可以让你更直观地浏览整个求职管道：

```bash
npm run serve:dashboard   # launch the TUI
npm run build:dashboard   # optional: build the standalone binary
```

功能包括：6 个筛选标签、4 种排序模式、分组/平铺视图、懒加载预览、行内状态修改。

## 项目结构

```
career-ops/
├── CLAUDE.md                    # 代理说明
├── cv.md                        # 你的简历（需要自行创建）
├── article-digest.md            # 你的成果证明（可选）
├── config/
│   └── profile.example.yml      # 个人档案模板
├── modes/                       # 14 个技能模式
│   ├── _shared.md               # 共享上下文（在这里自定义）
│   ├── oferta.md                # 单个职位评估
│   ├── pdf.md                   # PDF 生成
│   ├── scan.md                  # 平台扫描器
│   ├── batch.md                 # 批量处理
│   └── ...
├── templates/
│   ├── cv-template.html         # ATS 优化简历模板
│   ├── portals.example.yml      # 扫描器配置模板
│   └── states.yml               # 规范状态列表
├── batch/
│   ├── batch-prompt.md          # 自包含 worker 提示词
│   └── batch-runner.sh          # 编排脚本
├── dashboard/                   # Go TUI 管道查看器
├── data/                        # 你的追踪数据（已 gitignore）
├── reports/                     # 评估报告（已 gitignore）
├── output/                      # 生成的 PDF（已 gitignore）
├── fonts/                       # Space Grotesk + DM Sans
├── docs/                        # 配置、定制、架构说明
└── examples/                    # 示例简历、报告、成果证明
```

## 技术栈

![Claude Code](https://img.shields.io/badge/Claude_Code-000?style=flat&logo=anthropic&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-2EAD33?style=flat&logo=playwright&logoColor=white)
![Go](https://img.shields.io/badge/Go-00ADD8?style=flat&logo=go&logoColor=white)
![Bubble Tea](https://img.shields.io/badge/Bubble_Tea-FF75B5?style=flat&logo=go&logoColor=white)

- **代理**：Claude Code，配合自定义技能与 modes
- **PDF**：Playwright/Puppeteer + HTML 模板
- **扫描器**：Playwright + Greenhouse API + WebSearch
- **Dashboard**：Go + Bubble Tea + Lipgloss（Catppuccin Mocha 主题）
- **数据**：Markdown 表格 + YAML 配置 + TSV 批处理文件

## 也已开源

- **[cv-santiago](https://github.com/santifer/cv-santiago)**：作者的作品集网站（santifer.io），包含 AI 聊天机器人、LLMOps Dashboard 和案例研究。如果你也需要一个能在求职时展示的作品集，可以 fork 它然后改成自己的版本。

## 关于作者

我是 Santiago，现任 Head of Applied AI，也曾是一名创业者（创建并出售过一家公司，那家公司至今仍以我的名字运营）。我构建 career-ops 是为了管理我自己的求职流程，而它确实奏效了：我用它拿到了现在这份工作。

我的作品集和其他开源项目 → [santifer.io](https://santifer.io)

## Star 历史

<a href="https://www.star-history.com/?repos=santifer%2Fcareer-ops&type=timeline&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=santifer/career-ops&type=timeline&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=santifer/career-ops&type=timeline&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=santifer/career-ops&type=timeline&legend=top-left" />
 </picture>
</a>

## 免责声明

**career-ops 是一个本地开源工具，不是托管服务。** 使用本软件即表示你确认：

1. **数据由你掌控。** 你的简历、联系方式和个人数据都保留在你的设备上，并直接发送给你选择的 AI 提供商（Anthropic、OpenAI 等）。我们不会收集、存储或访问你的任何数据。
2. **AI 由你掌控。** 默认提示词会明确要求 AI 不要自动提交申请，但 AI 模型的行为可能不可预测。如果你修改提示词或使用不同模型，风险由你自行承担。**提交前务必核查 AI 生成内容的准确性。**
3. **你需要遵守第三方服务条款。** 你必须按照所使用招聘平台（Greenhouse、Lever、Workday、LinkedIn 等）的服务条款来使用本工具。不要用它向雇主发送垃圾申请，也不要对 ATS 系统造成过载。
4. **不提供任何保证。** 评估结果只是建议，不是真相。AI 模型可能会幻觉出并不存在的技能或经历。作者不对任何求职结果、申请被拒、账号受限或其他后果承担责任。

完整内容见 [LEGAL_DISCLAIMER.md](LEGAL_DISCLAIMER.md)。本软件依据 [MIT License](LICENSE) 以“按现状”方式提供，不附带任何形式的担保。

## 贡献者

<a href="https://github.com/santifer/career-ops/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=santifer/career-ops" />
</a>

通过 career-ops 成功入职？[分享你的故事！](https://github.com/santifer/career-ops/issues/new?template=i-got-hired.yml)

## 许可证与商标

代码以 [MIT](LICENSE) 许可证授权。"career-ops" 名称及品牌受 [商标政策](TRADEMARK.md) 约束 —— 允许社区使用，商业产品命名和背书需保留权利。

## 联系我们

[![Website](https://img.shields.io/badge/santifer.io-000?style=for-the-badge&logo=safari&logoColor=white)](https://santifer.io)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white)](https://linkedin.com/in/santifer)
[![X](https://img.shields.io/badge/X-000?style=for-the-badge&logo=x&logoColor=white)](https://x.com/santifer)
[![Discord](https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/8pRpHETxa4)
[![Email](https://img.shields.io/badge/Email-EA4335?style=for-the-badge&logo=gmail&logoColor=white)](mailto:hi@santifer.io)