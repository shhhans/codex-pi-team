# Researcher 与专业 Deep Research MCP 的两层边界

## 决策

Researcher 不实现完整 Deep Research。系统采用两层结构：

```text
Researcher
  ├─ 接收研究目标
  ├─ 调用 Deep Research MCP
  ├─ 监控进度和上下文预算
  ├─ 审查返回的证据、矛盾和覆盖率
  └─ 生成最终报告

专业 Deep Research MCP
  ├─ 搜索和网页抓取
  ├─ 子问题拆解
  ├─ 多轮检索
  ├─ 来源交叉验证
  ├─ 研究过程管理
  └─ 产出研究结果和引用
```

因此项目侧不再加载 `pi-deep-research` extension，也不向 Researcher 暴露 `web_search`、页面提取、证据卡生成或轮次 checkpoint 工具。项目实现重点是受控 MCP client/adapter、持久化任务编排、双层上下文预算、结果审查门禁和干净的最终报告输入。

## 受控 client / adapter

`.pi/research/deep-research-mcp-adapter.mjs` 使用 MCP Streamable HTTP transport，先发现服务器工具，再允许调用。默认契约包含 start、status、result、cancel，工具名可通过环境变量映射。start 明确传递目标、子问题、约束、上下文预算和结果契约；缺少必需工具或 `task_id` 时 fail closed。

`.pi/researcher-runtime/context-management-extension.ts` 只向角色暴露统一的 `deep_research_task`，不暴露底层搜索实现。远端 result 只取回一次并完整落盘，active context 只收到 task id、artifact path 和下一步操作。

## 上下文与任务管理

每个 Researcher run 持久化 MCP task id、状态、进度、远端 context usage、本地 tool/context usage 和 result artifact。Researcher 轮询远端预算，同时 runtime 在本地上下文达到 hard limit 时中止继续增长。原始 MCP result 位于 `.pi/research/runs/<run-id>/deep-research/`，不会通过 Tool Result 累积进主上下文。

## 结果审查与 synthesis 门禁

`deep_research_review` 在冻结的 MCP result 上检查：

- 是否有 report、sources 和 citations；
- citation 的 source provenance 是否可解析；
- 请求的 sub-question coverage 是否达到门槛；
- contradictions 和 gaps 是否被显式保留。

审查返回 `READY_FOR_SYNTHESIS` 或 `NEEDS_MORE_RESEARCH`。未通过时，Researcher 必须针对缺口委派后续 MCP 任务，不能用临时网页搜索自行补答案。`research_synthesis_input` 和 `research_report_artifact` 都受审查门禁约束。

这保证 MCP 对最终报告具有因果作用：仅调用或记录 MCP 不构成能力证明；报告只能读取已冻结、已审查的 MCP 结果。测试包含缺失引用/覆盖率时不能 synthesis 的负对照，不使用 Gold、oracle 或 expected patch 生成候选结果。

## 配置与迁移

连接契约和环境变量见 `.pi/researcher-runtime/README.md`。`pi-deep-research@0.1.6` 已从 Researcher runtime 依赖中移除，替换为官方 MCP TypeScript SDK client。既有 run/evidence API 暂保留在持久化类中用于旧 run 可恢复性，但不再属于 Researcher 的工具面或新工作流。
