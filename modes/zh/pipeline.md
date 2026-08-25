# 模式: pipeline — 待处理 URL 收件箱 (第二大脑)

用于批量处理记录在 `data/pipeline.md` 中的职位 URL 链接。候选人可以随时向待处理列表中追加抓取的岗位链接，然后运行 `/career-ops pipeline` 一键自动化评估所有待投递机会。

## 实时工作流

1. **读取数据**：分析 `data/pipeline.md` 文件，找出 "Pending" 模块下所有标记为 `- [ ]` 的待处理项目。
2. **循环遍历处理**：对每一个未处理的 URL：
   a. **计算新报告编号**：扫描 `reports/` 目录，找出当前最大的三位数字前缀并加 1，作为 `REPORT_NUM`。
   b. **抓取职位描述 (JD)**：首选 Playwright (通过 `browser_navigate` + `browser_snapshot`) 渲染网页抓取，备选 `WebFetch` 提取静态文本，最后使用 `WebSearch` 搜索同名岗位快照。
   c. **异常处理**：若链接因权限、失效等原因完全无法打开，将该项标记为 `- [!]`，附加错误描述，并继续处理下一个。
   d. **执行一键管道评估**：运行 A-F 维度评估 → 保存为报告 `.md` 文件 → 根据设定生成简历 PDF（若评分达到阈值）→ 自动记录至 tracker。
   e. **将记录从“待处理”移入“已处理”**：更新状态为 `- [x] #NNN | 职位链接 | 公司名称 | 职位名称 | 评分/5 | PDF 状态`。

   **关于自动生成 PDF 的分流控制 (Configurable)：**
   系统将读取个人配置 `config/profile.yml` 中的 `auto_pdf_score_threshold`（自动生成 PDF 评分阈值）。如果该配置项不存在，则默认阈值为 `3.0`。
   如果本次岗位的评估得分低于该阈值，系统将**跳过**简历 PDF 的生成步骤（照常撰写评估报告，并在报告头部标明 `**PDF:** not generated — run /career-ops pdf {company-slug} to create on demand`，同时在 tracker 的 PDF 列登记为 ❌）。
   如果评分等于或高于该阈值，则照常自动生成量身定制的简历 PDF。

   *注：此机制可以大幅节省批量扫描时的 Playwright 渲染排版开销（每次渲染需要 30-60 秒）。候选人可在后续通过执行命令单独生成心仪岗位的 PDF。*
3. **并发加速**：如果待处理的 URL 达到 3 个及以上，建议以并发方式（在后台启动子 Agent）并行执行评估，以实现最大处理效率。
4. **输出批处理总结**：处理完毕后，输出一份汇总清单表格：

```text
| 编号 | 公司名称 | 岗位名称 | 综合评分 | PDF 状态 | 投递建议 |
```

---

## `pipeline.md` 语法规范

```markdown
## Pending
- [ ] https://jobs.example.com/posting/123
- [ ] https://boards.greenhouse.io/company/jobs/456 | 某某科技 | 资深 AI 产品经理
- [!] https://private.url/job — 错误：需要登录后查看

## Processed
- [x] #143 | https://jobs.example.com/posting/789 | 极客科技 | AI 研发工程师 | 4.2/5 | PDF ✅
- [x] #144 | https://boards.greenhouse.io/xyz/jobs/012 | 某大厂 | 解决方案架构师 | 2.1/5 | PDF ❌
```

---

## 智能解析 URL 职位描述

1. **Playwright (首选)**：`browser_navigate` + `browser_snapshot`。能够稳定处理所有单页面应用 (SPA)。
   - **可选 — CLI 提取器（`config/profile.yml` 中的 `scan.extractor: cli`）：** 改为运行 `node browser-extract.mjs <url>`（`--mode jd`）——紧凑的 `{ "url", "title", "text" }`，更少 token（因门户而异）。出错或缺失时**静默**回退到 `browser_navigate` + `browser_snapshot`。
2. **WebFetch (备选)**：适用于静态页面，或在 Playwright 环境不可用时作为后备。
3. **WebSearch (最终手段)**：在第三方招聘聚合平台上查找同名职位的快照。

**特殊情况处理：**
- **LinkedIn**：可能会触发强登录校验拦截。若多次失败，标记为 `[!]` 并引导候选人直接粘贴 JD 文本。
- **PDF 文件**：如果 URL 链接直接指向一份 PDF 文档，使用 Read 工具读取二进制文档。
- **本地文件前缀 `local:`**：如果是本地路径，直接读取对应文件。例如：`local:jds/linkedin-pm-ai.md` 指向读取本地的 `jds/linkedin-pm-ai.md` 文件。

---

## 数据一致性校验

在启动处理之前，先执行以下脚本检查简历与配置的同步状态：
```bash
node cv-sync-check.mjs
```
如果检测到简历或个人偏好数据存在脱节风险，在继续执行前向求职者发出警示。
