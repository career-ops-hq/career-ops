# Deepseek — Skill: DeepSeek

版本: 0.1
作者: changekk1 (或替换为你的名字/团队)

概述
- DeepSeek Skill 为仓库提供基于 Deepseek 的语义检索能力，支持自然语言查询并返回最相关的文档片段与元信息，适用于文档检索、面试题库查找、知识库问答等场景。

目的
- 提供一个可复用的技能定义：输入自然语言查询与可选过滤器，输出按相似度排序的结果片段（含路径、上下文、相似度分数）。

能力（Capabilities）
- 自然语言查询 -> top_k 相关片段。
- 支持过滤器：tags、路径前缀、日期范围等。
- 返回来源链接（repo 相对路径）、片段上下文、相似度分数／置信度。
- 可配置 chunk 大小、重叠量、去重策略。

输入 / 输出 规范（示例）
- 输入（JSON）
  {
    "query": "如何准备系统设计面试？",
    "filters": {"tags": ["system-design"], "path_prefix": "docs/interviews"},
    "top_k": 5
  }
- 输出（JSON）
  {
    "results": [
      {
        "score": 0.93,
        "path": "docs/interviews/sys-design.md",
        "excerpt": "……",
        "line_start": 120,
        "line_end": 145
      },
      ...
    ]
  }

示例调用（用户场景）
- 查询：查找关于“负载均衡”的面试题，并按相关性返回前 5 条。
- 返回示例：列出条目，包含路径、摘要与相似度分数。

实现建议
- Embedding / 模型选择：列出可选 embedding 提供方（Deepseek 自家 embedding、OpenAI、其他）并说明成本/延迟权衡。
- 索引策略：把文档分片为 200–500 tokens 的 chunk，保留来源元数据（path、line range、tags）。
- 去重/合并：对高度重叠结果合并并返回最相关片段的合成摘要（可选）。
- 增量更新：对变更的文件做差量索引；定期重建（CI hook / cron）。

环境与密钥
- 需要的 Secrets / ENV：
  - DEEPSEEK_API_KEY — Deepseek 服务密钥（建议存为 GitHub Secret）
  - DEEPSEEK_ENDPOINT（如适用）
- 权限说明：仅使用读取索引/搜索的最小权限。

错误处理与边界情况
- 空查询 -> 返回 400 或空结果集（取决于上层约定）。
- 过滤器无匹配 -> 返回空结果集并带上提示。
- 服务不可用 -> 返回 503 并记录监控告警。

测试用例
- 功能测试：已知 query 在 top 3 包含特定文件片段。
- 边界测试：空查询、超长查询、没有匹配结果、并发大量请求。
- 性能测试：响应时延、吞吐量。

示例脚本（演示调用）
- 可在 docs/deepseek.md 中提供 Python/Node demo（见运行手册）。

运维 / 监控
- 建议监控指标：查询延迟、错误率、平均相似度、每小时查询量。
- 日志与隐私：记录查询时脱敏，尽量不保存敏感上下文。

更多信息 / TODO
- 补充架构图、数据流、以及 Deepseek API 具体调用示例（根据你们的账号与 SDK）。
