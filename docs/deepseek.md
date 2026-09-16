# Deepseek — 运行手册与示例

目标
- 说明如何在本仓库中部署与使用 Deepseek Skill，包含环境变量配置、示例调用、演示脚本与 CI 注意事项。

先决条件
- 已拥有 Deepseek 账号与 API key（DEEPSEEK_API_KEY）。
- 可选：配置 DEEPSEEK_ENDPOINT（自托管或区域化 Endpoint）。

配置（在 GitHub Actions / 环境中）
- 在仓库 Settings → Secrets 中添加：
  - DEEPSEEK_API_KEY: <你的 key>
  - DEEPSEEK_ENDPOINT: <如需>

快速示例（Python）
- 安装依赖（示例）
  pip install requests

- 示例请求（伪代码）
  import os, requests
  key = os.getenv("DEEPSEEK_API_KEY")
  endpoint = os.getenv("DEEPSEEK_ENDPOINT", "https://api.deepseek.example")
  resp = requests.post(f"{endpoint}/search", json={
    "query": "负载均衡",
    "top_k": 5
  }, headers={"Authorization": f"Bearer {key}"})
  print(resp.json())

CI / 索引更新建议
- 当 docs/ 或 src/ 目录发生变更时触发索引更新（增量索引）。
- 提供一个 GitHub Action 工作流模板（可选）用于重建或刷新索引。

安全与成本
- 将 API key 存为 Secrets，限制仓库协作者访问。
- 监控查询量以避免超支。

常见问题
- “结果不准确” → 调整 chunk 大小、embedding 模型或增加上下文窗口。
- “响应慢” → 检查网络、模型选择、并发限流设置。

附：联系与维护人
- 作者 / 维护者: changekk1 (或替换为你的名字/团队)
