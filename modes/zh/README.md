# career-ops — 中文模式 (`modes/zh/`)

此目录包含主要 career-ops 模式的中文翻译，适用于针对中国大陆市场（或使用中文职位描述）的求职者。

## 何时使用这些模式？

如果满足以下条件之一，请使用 `modes/zh/`：

- 你主要申请的是**中文职位描述**（如拉勾、BOSS直聘、猎聘、脉脉或公司官网中文版）。
- 你的**简历语言**是中文，或者你需要在中英文简历之间进行切换。
- 你需要撰写**自然的中文技术交流文本**（如求职信、LinkedIn 沟通话术等）。
- 你需要处理**中国大陆市场特有的合同与福利条款**：五险一金、个税计算、年终奖、股票期权/RSU、试用期、竞业限制、应届生 vs 社招、996/弹性工作制、税前/税后薪资、落户政策等。

如果你的大部分职位描述都是英文的（即使是在中国的外企），建议保留使用 `modes/` 下的默认英文模式。

## 如何启用？

启用中文模式有两种方式：

### 方式 1：按会话临时启用

在会话开始时，明确告诉 AI 助手：

> "从现在开始使用 `modes/zh/` 下的中文模式。"

或者：

> "请使用 `modes/zh/_shared.md` 和 `modes/zh/oferta.md` 进行中文岗位的评估和申请。"

### 方式 2：在个人配置中永久设置

在 `config/profile.yml` 中添加语言偏好设置，例如：

```yaml
language:
  primary: zh
  modes_dir: modes/zh
```

在第一次会话时，提醒助手遵守此字段即可。

## 翻译了哪些文件？

首批翻译覆盖了四个最高频、高价值的模式：

| 文件名 | 基础模板 | 用途 |
|---|---|---|
| `_shared.md` | `modes/_shared.md` | 共享上下文、画像检测、全局规则及中国大陆市场特性 |
| `oferta.md` | `modes/oferta.md` | 完整的职位评估（Block A-F + G 真实性评估） |
| `apply.md` | `modes/apply.md` | 网页表单填写实时助手 |
| `pipeline.md` | `modes/pipeline.md` | URL 收件箱 / 收集职位的第二大脑 |

其他工具相关的模式（如 `scan`、`batch`、`pdf`、`tracker` 等）仍将使用默认的英文版本，因为它们主要包含命令行参数、系统路径和配置指令，保持语言一致性有助于工具稳定运行。

## 常用词汇表

为保持语气的一致性，在修改或扩展模式时请遵循以下词汇对照：

| 英文 | 中文 (本仓库规范) | 说明 |
|---|---|---|
| Job posting | 职位描述 / 岗位需求 | 通常简称 JD |
| Application | 投递 / 申请 | |
| Cover letter | 自荐信 / 求职信 | |
| Resume / CV | 简历 | |
| Salary / Compensation | 薪资 / 薪酬包 / 总包 | 总包通常包含基本薪资、奖金和期权等 |
| Interview | 面试 | |
| Hiring manager | 业务负责人 / Hiring Manager | |
| Recruiter | HR / 招聘人员 | |
| AI | AI / 人工智能 | |
| Requirements | 岗位要求 / 任职资格 | |
| Notice period | 离职通知期 / 离职周期 | 通常为 1 个月 |
| Probation | 试用期 | |
| Non-compete | 竞业限制 / 竞业协议 | |
| Social insurance | 五险一金 | 社保及住房公积金 |
| Year-end bonus | 年终奖 | |
| Stock options / RSU | 股票期权 / 限制性股票 | 简称期权/RSU |
| Hukou / Talent policy | 落户指标 / 人才政策 | |
