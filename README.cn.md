<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/wordmark-dark.svg"><img src="docs/wordmark-light.svg" alt="career-ops" width="250" height="56"></picture></p>

<p align="center">
  <em>我花了好几个月用最费力的方式找工作。所以我打造了一个当初就希望拥有的系统。</em><br>
  公司用 AI 筛选候选人。<strong>我把 AI 交给候选人，让他们来<em>挑选</em>公司。</strong><br>
  它评估、排序、起草。<strong>它从不提交，提交的是你。</strong> 开源，本地运行，属于你。
</p>

<p align="center">
  <a href="https://x.com/santifer/status/2041403685696053741"><img src="docs/demo.gif" alt="career-ops 流水线：已打分的职位，219 个标记为不申请，然后是一份完整评估" width="800"></a>
</p>

<p align="center"><sub>求职中途的一个截面：流水线，然后打开一个职位，从头到尾完整评估。</sub></p>

<p align="center"><strong>740 个职位中，值得申请的有 68 个。12 次面试。1 个 offer。</strong></p>
<p align="center"><sub>一次求职，作者本人的 2026 年记录。重要的数字是筛掉了多少，而不是总数。全部数据见<a href="https://santifer.io/career-ops-system">案例研究</a>。</sub></p>

<p align="center"><sub>从不提交、从不发邮件、从不回传数据：<a href="#career-ops-不做的事">它不做的事</a> · 运行在你已经在用的 AI CLI 里，<a href="docs/RUNNING_ON_A_BUDGET.md">支持免费和本地模型</a>。</sub></p>

<details>
<summary>用 17 种语言阅读</summary>
<div align="center">

[English](README.md) | [Español](README.es.md) | [Deutsch](README.de.md) | [Français](README.fr.md) | [Português (Brasil)](README.pt-BR.md) | [한국어](README.ko-KR.md) | [日本語](README.ja.md) | [简体中文](README.cn.md) | [繁體中文](README.zh-TW.md) | [Українська](README.ua.md) | [Русский](README.ru.md) | [Polski](README.pl.md) | [Dansk](README.da.md) | [தமிழ்](README.ta.md) | [العربية](README.ar.md) | [हिन्दी](README.hi.md) | [Türkçe](README.tr.md)

</div>
</details>

<hr>

<p align="center">
  <a href="HIRED.md"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fsantifer%2Fcareer-ops%2Fmain%2Fdocs%2Fhired-count.json&query=%24.count&label=%F0%9F%8E%89%20HIRED%20WITH%20CAREER-OPS&suffix=%20verified&color=2ea44f&style=for-the-badge&labelColor=2b3137" alt="通过 career-ops 获得录用：已核实数量"></a>
</p>

<p align="center"><sub>拿到 offer 了？<a href="https://github.com/career-ops-hq/career-ops/issues/new?template=i-got-hired.yml">分享一下 →</a> · 你的卡片会让正在求职的人看到出路是存在的。</sub></p>

<p align="center">
  <a href="HIRED.md"><img src="docs/hired-wall.svg" alt="最近三个录用故事" width="800"></a>
</p>

<p align="center"><sub>每一个数字都是<a href="HIRED.md">可以核查的 →</a>公开故事 · 每一个都从你现在所在的位置开始。</sub></p>

<p align="center"><sub>媒体报道</sub></p>

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

<p align="center"><sub>由 <a href="https://santifer.io">Santiago Fernández de Valderrama Aparicio</a>（<a href="https://github.com/santifer">@santifer</a>）创建并维护</sub></p>

## 这是什么

career-ops（[career-ops.org](https://career-ops.org)，也叫 **careerops**）是一个开源的 AI 求职工具，在任何 AI 编码 CLI 里本地运行：它评估职位、定制你的简历、追踪每一次申请，而最终决定始终由你作出。你不需要再手动用电子表格追踪申请流程，而是获得一个 AI 驱动的流水线，能够：

- **评估职位**，输出结构化报告：A 到 H 各个区块，以及一个 1 到 5 的总评分。评分来自对五个维度的整体判断，而不是算术公式。区块 B 的逐项要求重要度列和区块 G 的职位真实性评估是独立的、不影响评分的信号；区块 H 只在 4.5 分及以上时才会撰写
- **生成定制 PDF**：针对每份职位描述输出 ATS 优化简历
- **自动扫描招聘平台**（Greenhouse、Ashby、Lever、公司招聘页）
- **批量处理**：通过子代理并行评估 10 份以上职位
- **集中管理一切**：用单一事实来源配合完整性检查
- **调研公司并找到该联系的人**：申请让你排进队伍，调研让你获得对话

> **重要：这不是海投工具。** career-ops 是一个过滤器：帮你从数百个职位里找出真正值得投入时间的少数机会。系统强烈建议不要申请评分低于 4.0/5 的职位。你的时间很宝贵，招聘方的时间也一样。提交前一定要自己复核。

career-ops 具备代理式工作能力：你选择的 AI 编码 CLI 会用 Playwright 浏览招聘页面，通过推理你的简历与职位描述是否匹配来评估契合度，而不是只做关键词匹配；同时它也会根据每个职位调整你的简历。

> **提醒：最开始几次评估不会特别准。** 系统还不了解你。请给它更多上下文：你的简历、职业故事、成果证明、个人偏好、擅长的事、想避开的事。你喂给它的信息越多，它就越准确。把它当成在培养一个新招聘顾问：第一周它需要先了解你，之后就会变得非常有价值。

作者用它评估了 740 个职位，申请了 68 个，拿到了 Head of Applied AI 的职位。[阅读完整案例研究](https://santifer.io/career-ops-system)。

## career-ops 不做的事

- **提交申请。** 它只准备答案；打开表单、点击提交的是你。脚本从不发送 POST（`prepare-application.mjs`）。
- **发送邮件。** 只写草稿。整个代码库里没有任何邮件发送模块。
- **回传数据。** 没有遥测，没有我们的后端。你的简历只从你的机器发往你选择的 AI 提供商，不去任何别的地方。唯一的公开记录就是这个仓库：`HIRED.md` 和它的 issue。
- **催你申请低于 4.0/5 的职位。** 它会告诉你别申请。你可以不听，它会明说。

它会改写你的简历，但绝不能编造。目前这条规则写在提示词里，还没有变成代码里的强制检查。每份简历发出前都请自己读一遍。详情见 [FAQ](#常见问题faq)。

## CareerOps 宣言

career-ops 是 [CareerOps 宣言](https://career-ops.org/manifesto?utm_source=readme)的首个参考实现。读一读。如果它说出了你的想法，就签名。你的签名会成为一次 commit。

## 功能特性

| 功能                     | 说明                                                                                                                                     |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **自动流水线**           | 粘贴一个 URL，获得完整评估 + PDF + 追踪记录                                                                                               |
| **A-H 评估**             | 职位摘要、简历匹配（标注每条要求在这个职位里有多重要，以及权重来自职位描述的措辞、结构还是估算，逐条标注；估算永远不能进入最高档）、级别策略、薪酬调研、个性化、面试准备（STAR+R），再加上区块 G 的职位真实性检查（标记骗局和幽灵职位），以及一个工作许可信号（把明确不提供签证担保的职位描述标记为硬性阻碍） |
| **面试故事库**           | 跨评估积累 STAR+反思故事：5 到 10 个能回答任何行为面试问题的主故事                                                                         |
| **谈判话术**             | 薪资谈判框架、应对地域折价、利用竞争 offer 作为筹码                                                                                       |
| **ATS PDF 生成**         | 注入关键词的简历，Space Grotesk + DM Sans 设计                                                                                            |
| **求职信生成器**         | 基于调研的求职信：关键词呼应、四个交互式角度提问（为什么/问题/方法/语气）、在聊天中审批草稿，以及通过与简历相同的 HTML + Playwright 流水线生成 A4 PDF。每次评估自动起草；用 `/career-ops cover` 按需完成并生成 |
| **申请邮件草稿**         | 从报告或粘贴的职位描述生成给招聘人员、内推或冷申请的正式邮件，包含主题、附件清单、有据可查的匹配点和来自你个人资料的联系信息块。仅限草稿：career-ops 从不发送、提交或点击任何内容。 |
| **招聘平台扫描器**       | 预配置 100+ 家公司（Anthropic、OpenAI、ElevenLabs、Retool、n8n…）+ 跨 Ashby、Greenhouse、Lever、Wellfound 的自定义查询                     |
| **已融资公司发现**       | 以审阅为先的 `company:funded` 命令从结构化的公开数据源中列出近期获得融资的公司和来源诊断，不改动你的数据                                    |
| **批量处理**             | 用无头 CLI worker（`claude -p` / `opencode run`）并行评估                                                                                  |
| **Dashboard TUI**        | 在终端里浏览、筛选和排序你的流水线                                                                                                        |
| **Human-in-the-Loop**    | AI 评估并推荐，你决定并行动。系统从不提交申请：最终决定始终在你手中 <!-- hitl: absolute guarantee. Do not add "automatically", "by itself", "without your permission" or any other hedge when translating this row. -->               |
| **流水线完整性**         | 自动合并、去重、状态规范化、健康检查                                                                                                      |
| **面试套件**             | 按时间块安排的准备计划、带反馈的练习环节、面试后复盘（[`interview/`](modes/interview/README.md)），以及公司危险信号检测器（[`interview-redflag`](modes/interview-redflag.md)） |
| **Offer 阶段**           | 合同阅读助手：逐条款解读加上给律师的问题清单（[`offer-prep`](modes/offer-prep.md)），以及期望/公布/实际薪资差距分析器（`salary-gap.mjs`）   |
| **跟进与回复**           | 跟进节奏计算器和预置提醒（`followup-cadence.mjs`、`followup-seed.mjs`）；把雇主回复归类为追踪记录更新（[`reply-watch`](modes/reply-watch.md)） |
| **模式分析**             | 拒信模式和各 ATS 渠道的推进率（`analyze-patterns.mjs`）、整个求职周期的漏斗统计（`stats.mjs`）、重复发布和幽灵职位检测（`detect-reposts.mjs`） |
| **插件系统**             | 可选集成（Gmail、Notion、Apify + 社区注册表），默认关闭；见 [docs/PLUGINS.md](docs/PLUGINS.md)                                              |
| **简历之外**             | 公司调研（[`deep`](modes/deep.md)）揭示 AI 战略、近期动向、工程文化，以及你的简历应该采取的角度。联系人发现（[`contacto`](modes/contacto.md)）找出值得联系的招聘经理、招聘人员或团队成员，并起草一条不超过 300 字符、针对联系人类型调整过的 LinkedIn 消息。正式申请邮件草稿（[`email`](modes/email.md)）把已评估的报告或粘贴的职位描述变成主题、正文和附件清单，不发送、不提交、不点击任何内容。申请让你排进队伍，调研让你获得对话。 |

## 快速开始

**最快的方式：一条命令：**

```bash
npx @santifer/career-ops init
```

> 💡 `npx` 随 [Node.js](https://nodejs.org) 一起提供：它只运行一次安装程序，
> 不会全局安装任何东西。还没有 Node？先安装它。
> （已经在用 Claude Code / Gemini / Codex CLI？那你已经有了。）

这会把最新版本克隆到 `./career-ops` 并安装依赖。然后：

```bash
cd career-ops
claude   # or codex / qwen / opencode / agy / grok — open your AI CLI here
```

**首次启动时，career-ops 会通过对话引导你完成设置：你的简历、个人资料和目标职位。不需要手动编辑任何东西。**

<details>
<summary><b>想手动设置？（git clone）</b></summary>

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

### 全局安装

```bash
npm i -g @santifer/career-ops
```

这会全局安装 `career-ops` 二进制文件，让你可以直接运行它而不是通过 `npx`。与 `npx @santifer/career-ops init`（用来初始化一个项目目录）不同，全局安装会给你一个持久的 `career-ops` 命令，在终端的任何地方都能用。

**该用哪个？**
- `npx @santifer/career-ops init`：最适合首次使用；会创建一个专用的项目文件夹。
- `npm i -g @santifer/career-ops`：最适合已有项目文件夹、想直接运行 career-ops 命令的情况。

> **这个系统就是设计成由你的 AI 编码 CLI 自己来定制的。** 模式、原型、评分权重、谈判话术：直接让它改就行。它读取的正是它自己使用的文件，所以它清楚该改哪里。

完整安装指南见 [docs/SETUP.md](docs/SETUP.md)；用自定义或本地模型低成本运行 career-ops 的方法见 [docs/RUNNING_ON_A_BUDGET.md](docs/RUNNING_ON_A_BUDGET.md)（在 Antigravity CLI 免费层零成本运行见 [docs/FREE_TIER.md](docs/FREE_TIER.md)）；定时扫描和零 token 的"初筛到短名单"配方见 [docs/AUTOMATION.md](docs/AUTOMATION.md)；ATS 自动填表流程的细节见 [docs/APPLY_AUTOFILL.md](docs/APPLY_AUTOFILL.md)；把 LinkedIn 联系人导出与漏斗中的公司交叉比对见 [docs/LINKEDIN_JOIN.md](docs/LINKEDIN_JOIN.md)；常见设置问题的解答见 [docs/FAQ.md](docs/FAQ.md)，包括[故事溯源如何防止编造数字](docs/FAQ.md#why-does-career-ops-refuse-to-use-a-number-from-my-story-bank)。设计原则在 [ARCHITECTURE.md](ARCHITECTURE.md)；运行时流程在 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## Antigravity CLI 集成

career-ops 原生支持 Antigravity CLI，方式和支持 Claude Code、OpenCode 一样。所有斜杠命令都通过共享的 skill 入口提供，使用相同的 `modes/*.md` 评估逻辑。

Google 已把消费者版 Gemini CLI 的访问迁移到 Antigravity CLI。`GEMINI.md` 现在是一个不做任何事的兼容性守卫，这样 Antigravity 在同时读取 `AGENTS.md` 和 `GEMINI.md` 时不会重复加载完整的项目指令。

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

这个 skill 按开放标准定义在 `.agents/skills/career-ops/SKILL.md` 中，并为每个支持的 CLI（例如 `.claude/`、`.cursor/`、`.qwen/`、`.antigravitycli/`、`.grok/`）建立了符号链接或引用。

## Codex 集成

career-ops 通过同一个共享路由支持 Codex，但调用方式和自动注册斜杠命令的 CLI 不同。完整指南见 [docs/CODEX.md](docs/CODEX.md)。

### 交互式 Codex

```bash
cd career-ops
codex
```

Codex 里不保证有斜杠命令。如果 `/career-ops` 不可用，就用自然语言让 Codex 直接运行对应模式：

```text
Evaluate this JD with career-ops auto-pipeline: https://company.com/jobs/123
Run the career-ops scan mode and summarize new matches.
Run the career-ops pipeline mode for data/pipeline.md.
Run the career-ops pdf mode for the latest evaluated role.
Run the career-ops tracker mode and summarize the current statuses.
```

### 单次执行的 Codex（`codex exec`）

```bash
codex exec "Evaluate this JD with career-ops auto-pipeline: https://company.com/jobs/123"
codex exec "Run career-ops scan mode in this repo and summarize new matches."
codex exec "Run career-ops pipeline mode for data/pipeline.md."
codex exec "Run career-ops pdf mode for the latest evaluated role."
codex exec "Run career-ops tracker mode and summarize the current statuses."
```

## Grok Build CLI 集成

career-ops 原生支持 Grok Build CLI，方式和支持 Claude Code、OpenCode 一样。`AGENTS.md` 会作为项目规则自动加载，所有斜杠命令都通过共享的 skill 入口提供。

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

无头批量 worker 请使用 `grok -p "prompt"`（加上 `--yolo` 可自动批准工具执行）。

### 独立的 Gemini API 脚本（无需安装 CLI）

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

> **免费层：** 两种方式都无需付费。原生 CLI 使用 Google OAuth；API 脚本使用 `gemini-3.6-flash`（速率限制取决于模型和层级；当前配额见 Google AI 文档）。

## 用法

career-ops 使用共享的命令路由。在会注册斜杠命令的 CLI 里，它看起来是这样：

```
/career-ops           → 显示所有可用命令
/career-ops {JD}      → 自动流水线：评估 + 报告 + PDF + 追踪记录（粘贴文本或 URL）
/career-ops pipeline  → 处理收件箱里待处理的 URL（data/pipeline.md）
/career-ops oferta    → 仅评估，区块 A 到 G（不自动生成 PDF）
/career-ops ofertas   → 比较并排序多个职位
/career-ops contacto  → LinkedIn 妙招：找到联系人 + 起草消息
/career-ops deep      → 针对公司的深度调研提示词
/career-ops interview-prep → 生成针对特定公司的面试准备文档
/career-ops interview    → 交互式的个人资料/简历入门访谈
/career-ops eu-swe    → 在简历/申请/面试前校准一份欧洲 SWE 申请
/career-ops eu-fintech → 扫描 21 个欧洲金融科技招聘平台的 Product Manager 职位（零 token）
/career-ops interview/plan → 为即将到来的面试制定按时间块安排的准备计划
/career-ops interview/practice → 模拟面试，一次一个问题并给出反馈
/career-ops interview/debrief → 面试后复盘：补上短板，预测下一轮
/career-ops interview-redflag → 入职前分析雇主的危险信号
/career-ops pdf       → 仅生成 PDF，ATS 优化简历
/career-ops text      → 定制的 markdown 简历（镜像 cv.md，不生成 PDF）
/career-ops latex     → 把简历导出为 LaTeX/Overleaf .tex
/career-ops latex-tex → 就地定制你自己的 resume.tex（可选；cv.md 仍是默认）
/career-ops cover     → 求职信：单独粘贴职位描述，或 /career-ops cover {slug}
/career-ops email     → 正式申请邮件草稿（仅草稿；从不发送、提交或点击）
/career-ops add       → 向简历添加项目/论文/职位（抓取 + 预览 + 确认）
/career-ops expand    → 从个人资料链接自动发现并补充缺失的能力
/career-ops training  → 对照你的 North Star 评估课程/证书
/career-ops project   → 评估一个作品集项目点子
/career-ops tracker   → 申请状态总览
/career-ops agent-inbox → 为下一个会话排队/清空请求（data/agent-inbox.md）
/career-ops apply     → 实时申请助手（读取表单 + 生成答案）
/career-ops scan      → 扫描招聘平台并发现新职位
/career-ops discover  → 把公司列表解析为可扫描的 ATS 板块 + 追加到 portals.yml（零 token）
/career-ops batch     → 用并行 worker 批量处理
/career-ops patterns  → 分析拒信模式并改进目标定位
/career-ops offer-prep → 和候选人一起阅读收到的 offer/合同：逐条款解读 + 给律师的问题（不是法律建议）
/career-ops titles    → 根据你的简历推荐相近的职位名称以扩大搜索范围
/career-ops upskill   → 基于已评估报告的综合技能差距分析
/career-ops followup  → 跟进节奏追踪：标记逾期，生成草稿
/career-ops reply-watch → 归类雇主回复并建议追踪记录更新
/career-ops outcome   → 记录申请结果并归档产物
/career-ops calibrate → 咨询性报告：你的评估分数能预测真实结果吗？读取 /outcome 数据；从不改变评分
/career-ops update    → 更新 career-ops 系统文件，带 diff 预览 + 兼容性检查
```

或者直接粘贴一个职位 URL 或描述：career-ops 会自动识别并运行完整流水线。

Codex 里不保证有斜杠命令。请改用同样的模式名称写在提示词里，或者通过 `codex exec` 调用。

## 工作原理

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

## 预配置平台

扫描器自带 **100+ 家公司**可直接扫描，以及覆盖主流招聘网站的 **45+ 条搜索查询**。把 `templates/portals.example.yml` 复制为 `portals.yml`，再添加你自己的：

**AI 实验室：** Anthropic、OpenAI、Mistral、Cohere、LangChain、Pinecone
**语音 AI：** ElevenLabs、PolyAI、Parloa、Hume AI、Deepgram、Vapi、Bland AI
**AI 平台：** Retool、Airtable、Vercel、Temporal、Glean、Arize AI
**联络中心：** Ada、LivePerson、Sierra、Decagon、Talkdesk、Genesys
**企业级：** Salesforce、Twilio、Gong、Dialpad
**LLMOps：** Langfuse、Weights & Biases、Lindy、Cognigy、Speechmatics
**自动化：** n8n、Zapier、Make.com
**欧洲：** Factorial、Attio、Tinybird、Clarity AI、Travelperk

**搜索的招聘网站：** 55+ 个提供方模块覆盖 ATS API、整站数据源、XML/RSS 源、markdown 源和本地解析器。完整表格见[支持的招聘网站](docs/SUPPORTED_JOB_BOARDS.md)。

默认情况下 `node scan.mjs`（即 `npm run scan`）信任每个 ATS 数据源返回的内容。有些公司在职位关闭后仍会把过期职位留在公开 API 里，这些过期条目可能会混进 `pipeline.md`。加上 `--verify` 可以在 API 阶段之后启动 Playwright，在过期职位进入流水线之前把它们剔除：

```bash
node scan.mjs --verify          # zero-token discovery + Playwright liveness check
```

验证是顺序执行的，并且只针对新职位（去重之后），所以成本是有上限的。

## Dashboard TUI

内置的终端仪表板让你可视化地浏览你的流水线：

```bash
npm run serve:dashboard   # launch the TUI
npm run build:dashboard   # optional: build the standalone binary
```

功能：6 个筛选标签、4 种排序模式、分组/平铺视图、延迟加载预览、内联状态修改。

还有一个**实验性的 Web UI**（alpha 版，可选：除非你主动启动，否则不会运行任何东西）：见 [`web/README.md`](web/README.md)。

## 项目结构

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

## 外部数据目录（可选）

默认情况下，用户层数据（如 `cv.md`、`portals.yml`，以及 `data/`、`reports/`、`output/` 文件夹）位于项目根目录内。

为了把个人数据和代码分开（更方便切换分支、拉取更新或测试多个个人资料），你可以按以下优先级配置一个外部数据目录：

1. **环境变量：** 设置 `CAREER_OPS_ROOT` 或 `CAREER_OPS_DATA_DIR` 环境变量：
   ```bash
   export CAREER_OPS_ROOT=~/my-career-data
   ```
2. **标记文件：** 在仓库根目录创建一个 `.career-ops-data` 文件，内容是你的数据目录路径。
3. **默认：** 使用仓库根目录。

解析完成后，所有用户文件都相对于该文件夹解析和写入，而提示词文件和脚本仍然相对于仓库解析。

- **覆盖追踪文件：** 你也可以设置 `CAREER_OPS_TRACKER` 直接覆盖申请追踪文件的路径。
- **写入：** 所有写入操作（如合并）都以 `{DATA_ROOT}/data/applications.md` 为规范目标。

Go 版仪表板 TUI、Node.js 脚本和 AI 代理模式都会自动遵循这一解析层级。


## 技术栈

![Claude Code](https://img.shields.io/badge/Claude_Code-000?style=flat&logo=anthropic&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-2EAD33?style=flat&logo=playwright&logoColor=white)
![Go](https://img.shields.io/badge/Go-00ADD8?style=flat&logo=go&logoColor=white)
![Bubble Tea](https://img.shields.io/badge/Bubble_Tea-FF75B5?style=flat&logo=go&logoColor=white)

- **代理**：带共享 skill 和模式的 AI 编码 CLI（`AGENTS.md` + 各 CLI 的包装）
- **PDF**：Playwright + HTML 模板
- **求职信**：HTML 模板 + Playwright（A4 PDF，与简历相同的流水线）
- **扫描器**：Playwright + Greenhouse API + WebSearch
- **仪表板**：Go + Bubble Tea + Lipgloss（Catppuccin Mocha 主题）
- **数据**：Markdown 表格 + YAML 配置 + TSV 批处理文件

## 也已开源

- **[cv-santiago](https://github.com/santifer/cv-santiago)**：作品集网站（santifer.io），带 AI 聊天机器人、LLMOps 仪表板和案例研究。如果你需要一个配合求职展示的作品集，fork 它，改成你自己的。

## 常见问题（FAQ）

**career-ops 是什么？**
career-ops 是一个开源的 AI 求职工具，在你的 AI 编码 CLI（Claude Code、Codex、OpenCode 等）里本地运行，把每一个决定都留给你。它根据你的简历评估职位，生成适配 ATS 的 PDF，找到合适的联系人，并在一个地方追踪所有进展：最终决定始终在你手中。它是 CareerOps 宣言的首个参考实现。详情见 [career-ops.org](https://career-ops.org)。

**定制简历会编造内容吗？**
不应该，提示词里也这么写：只改写，绝不编造。但这条规则还没有由代码里的检查强制执行。两个未关闭的 issue 在跟进：[#2677](https://github.com/career-ops-hq/career-ops/issues/2677)（职位名称必须与 cv.md 一致）和 [#1411](https://github.com/career-ops-hq/career-ops/issues/1411)（不通过即阻止的真实性检查）。在它们合并之前，每份简历发出前都请自己读一遍。[法律声明](LEGAL_DISCLAIMER.md) 用更长的篇幅说了同样的话。

**我可以免费运行 career-ops，或使用更便宜的本地模型吗？**
可以。career-ops 不受特定 CLI 限制，可以用免费和本地模型运行（OpenRouter 免费模型、Ollama 或任何兼容 OpenAI 的端点），因此你不必绑定付费订阅。完整设置见 [docs/RUNNING_ON_A_BUDGET.md](docs/RUNNING_ON_A_BUDGET.md)。

**我付了 Claude Pro/Max，但 career-ops 在消耗 API 额度。为什么？**
因为环境里的 `ANTHROPIC_API_KEY` 优先于你已登录的订阅：CLI 会使用这个密钥并按 token 计费。运行 `echo $ANTHROPIC_API_KEY`，如果有输出，就把它从 shell 配置里删掉，重启终端并运行 `/login`。批量模式是例外，因为 `claude -p` worker 不使用交互式登录：运行一次 `claude setup-token`，把结果导出为 `CLAUDE_CODE_OAUTH_TOKEN`。完整步骤见 [docs/RUNNING_ON_A_BUDGET.md](docs/RUNNING_ON_A_BUDGET.md#2b-already-paying-for-a-subscription-make-sure-you-are-using-it)。

**career-ops 支持哪些 AI CLI？**
career-ops 通过开放的 Agent Skill Standard 运行在任何主流 AI 编码 CLI 上（Claude Code、Codex、Gemini / Antigravity、OpenCode、Grok、Qwen 等），所以永远不会被单一厂商锁定。用你已经有的 CLI 就行。

**如何在 Windows 上安装 career-ops？**
career-ops 可以在 Windows 上运行。平台相关的设置和已知的坑（Git Bash 检测、行尾符、任务计划程序）在 [docs/WINDOWS.md](docs/WINDOWS.md)。如果安装时因符号链接错误导致 skills 无法加载，解决方法在 [docs/FAQ.md](docs/FAQ.md)。完整步骤见 [docs/SETUP.md](docs/SETUP.md)。

**career-ops 会替我自动申请职位吗？**
不会。career-ops 是一个过滤器，不是海投的自动申请器。AI 负责评估、排序和起草；你负责审阅与决定。它从不提交、发送或点击任何内容：最终决定始终在你手中。这种保留人工决策的设计正是重点所在。

**career-ops 是免费开源软件吗？**
是。career-ops 是免费开源软件，而且对求职者会一直如此：它是 [CareerOps 宣言](https://career-ops.org/manifesto)的首个参考实现。读一读，如果它说出了你的想法，就签名。

## 关于作者

我是 [Santiago Fernández de Valderrama Aparicio](https://santifer.io/about)（santifer）：Head of Applied AI，前创业者（创办并卖掉了一家至今仍以我的名字运营的公司）。我打造 career-ops 是为了管理自己的求职。它奏效了：我用它拿到了现在的职位。

想知道这个仓库是怎么用每周大约 4 小时维护的？读一读 [Agentic maintenance: how career-ops is run by a fleet of AI agents](https://santifer.io/ai-agent-fleet)。

我的作品集和其他开源项目 → [santifer.io](https://santifer.io)

Wikidata：[Santiago Fernández de Valderrama Aparicio](https://www.wikidata.org/wiki/Q138710224) · [career-ops](https://www.wikidata.org/wiki/Q139007988)。

## 免责声明

**career-ops 是一个本地运行的开源工具，不是托管服务。** 使用本软件即表示你确认：

1. **你掌控自己的数据。** 你的简历、联系方式和个人数据留在你的机器上，直接发送给你选择的 AI 提供商（Anthropic、OpenAI 等）。我们不收集、不存储、也无法访问你的任何数据。
2. **你掌控 AI。** 默认提示词指示 AI 不要自动提交申请，但 AI 模型可能出现不可预测的行为。如果你修改了提示词或使用其他模型，风险自负。**提交前务必检查 AI 生成内容的准确性。**
3. **你遵守第三方条款。** 你必须按照所交互招聘平台（Greenhouse、Lever、Workday、LinkedIn 等）的服务条款使用本工具。不要用本工具向雇主发送垃圾信息或冲击 ATS 系统。
4. **不作任何保证。** 评估是建议，不是事实。AI 模型可能虚构技能或经历。作者不对就业结果、被拒的申请、账号限制或任何其他后果负责。

完整内容见 [LEGAL_DISCLAIMER.md](LEGAL_DISCLAIMER.md)。本软件依据 [MIT 许可证](LICENSE)"按原样"提供，不附带任何形式的保证。

## 贡献者

<a href="https://github.com/career-ops-hq/career-ops/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=career-ops-hq/career-ops" />
</a>

每一位贡献过代码、文档、翻译或测试的人都列在
[CONTRIBUTORS.md](CONTRIBUTORS.md) 里，包括上面的图表无法展示的
非代码贡献。

用 career-ops 找到工作了？[分享你的故事！](https://github.com/career-ops-hq/career-ops/issues/new?template=i-got-hired.yml)

## 许可证与商标

代码以 [MIT](LICENSE) 许可证发布。"career-ops" 的名称和
品牌受[商标政策](TRADEMARK.md)约束：对社区使用宽松，
对商业产品命名和背书保留权利。

## 荣誉与报道

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
  <sub>也可以在任何符合 agent-skill 标准的 CLI 上运行。见<a href="docs/SUPPORTED_CLIS.md">支持的 CLI</a>。</sub><br>
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

## 联系我们

[![Website](https://img.shields.io/badge/santifer.io-000?style=for-the-badge&logo=safari&logoColor=white)](https://santifer.io)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white)](https://linkedin.com/in/santifer)
[![X](https://img.shields.io/badge/X-000?style=for-the-badge&logo=x&logoColor=white)](https://x.com/santifer)
[![Discord](https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/8pRpHETxa4)
[![Email](https://img.shields.io/badge/Email-EA4335?style=for-the-badge&logo=gmail&logoColor=white)](mailto:hi@santifer.io)
