# Deep Research Agent 上下文管理研究：执行阻塞记录

历史状态：`BLOCKED`（不是 `contaminated`）。MiniMax native embedding adapter 已加入；本文件保留先前失败证据，不是最终验收报告，未用人工整理的主题结论、Gold、oracle 或预期来源填充研究结果。

## 已完成的运行链路

- Researcher runtime 使用本地 stdio MCP client 发现 `.sidecar/gptr-mcp`。
- 真实调用了 gptr-mcp 的 `deep_research`，没有调用 `write_report`。
- gptr-mcp 的真实工具为 `deep_research`、`quick_search`、`get_research_sources`、`get_research_context`、`write_report`；Researcher 只允许前三类研究工具中的 deep research/context/sources 路径。
- gptr-mcp 的 `quick_search` 通过 Tavily 返回 10 条结果和 URL，证明搜索 key/provider 路径正常。
- 结果持久化和有界 synthesis 输入仍由 ResearchRun 控制；长结果不会无界注入 Researcher 上下文。

## 阻塞

此前直接使用 OpenAI embedding schema 时，`deep_research` 命中 chat 但 embedding 返回 `vectors:null`、`base_resp.status_code=2013`，最终 context 为空。该失败已通过 sidecar 内 `MiniMaxEmbeddings` adapter 修正：同一 key 的 `embo-01` 原生请求使用 `texts` 和 `type`，返回 1536 维 vectors；必须重新运行真实研究验证完整链路。

本地 Pi provider 源码证实当前 Researcher 的 `minimax-cn` 路径使用 `api.minimaxi.com/anthropic`；这解释了同一 key 为什么能被 Researcher 使用。没有添加其他付费 embedding 服务或密钥。

完整的无密钥运行摘要和调用记录见 [`smoke-trace.json`](./smoke-trace.json)。adapter 修正后必须重新运行同一 Researcher 任务；不得切换模型、搜索服务或使用 Researcher 自行搜索补齐结果。

## 负对照

设置 `DEEP_RESEARCH_MCP_DISABLE_STDIO=1` 后，Researcher 的 `deep_research_task` 明确失败，且未注册 `web_search` 回退工具；测试见 [`gptr-mcp-negative-control.mjs`](../../tests/gptr-mcp-negative-control.mjs)。
