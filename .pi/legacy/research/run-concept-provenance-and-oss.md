# Run 概念溯源与开源复用研究

> 状态：Lead 校正综合版  
> 研究执行：Pi Researcher（MiniMax M3，deep，7 个搜索轮次）  
> 研究门禁：`research_checkpoint` Round 7 = PROCEED，平均置信度 96%  
> 校正说明：Researcher 首版报告因缺少本地目录发现工具而误判 `pi-subagents`、`pi-intercom` 未安装。Lead 拒绝该报告，补充 `ls/find/grep` 后由同一 Researcher Session 校正证据；模型在重写阶段因上下文过大被 provider 终止。本文件是 Lead 基于已冻结研究 trace 与本地源码复核形成的综合版，不冒充 Researcher 原稿。

## 1. 核心结论

本项目的 `run` 不是单一外部框架直接移植而来，而是两层概念叠加：

1. **执行身份层已经由 `pi-subagents` 提供。** 一次真实子 Agent 执行具有原生 `runId`，并关联状态、生命周期事件、session 文件、输出 artifact、`interrupt`、`stop`、`resume` 和 process-terminal evidence。
2. **项目治理层来自批准决策。** 项目基线要求 scope change 后 mark stale、到达 safe boundary、保存 partial results，并在新 `planVersion` 下重新执行。`.pi/communication/lifecycle.mjs` 为此增加了 `planVersion`、`staleAsOf`、`safeBoundary`、`partials` 和 authority fencing。

因此，正确架构不是再创建一套独立 Run 身份，而是：

> 以 `pi-subagents runId` 作为唯一执行身份；项目 lifecycle 只作为治理适配层，附加 `taskId / planVersion / stale / authority / partialArtifacts`。

`RunRegistry`、`PersistentRunLifecycle` 和 pi-subagents native run 不应成为三个相互独立的 source of truth。

## 2. 三层概念来源

### 2.1 项目直接来源

- `.pi/decisions/2026-08-21-agent-team-communication-baseline.md` 第 19 行首先批准行为规则：scope change 使用 mark-stale、cancel 或 safe boundary、保留 partial results，并在新 plan version 下 restart。
- Architecture v2 §6 将该规则写成协议，但错误地假设 `intercom cancel` 可以终止 subagent。
- Architecture v2.1 §6 与 Blocker 1 修正了该错误：`intercom cancel` 只处理消息，旧 Agent Run 必须通过 stale authority fence 与安全边界治理。
- `.pi/communication/lifecycle.mjs` 是上述项目决策的本地实现。

这条证据链证明项目为何需要 stale/restart；它不证明 Temporal、Airflow 或 LangGraph 曾直接影响本项目。

### 2.2 已安装 Pi substrate

`.pi/settings.json` 声明 `npm:pi-intercom`、`npm:pi-subagents`、`npm:pi-web-access`。本地安装位置为：

- `.pi/npm/node_modules/pi-subagents`（研究时安装版本 0.53.0）
- `.pi/npm/node_modules/pi-intercom`（研究时安装版本 0.11.0）

`pi-subagents` 已提供：native `runId`、foreground/background run、`status/interrupt/stop/resume/steer`、`status.json/events.jsonl/output-*.log`、session files、lifecycle events、retained child resume 和 process-terminal proof。

`pi-intercom` 读取 `PI_SUBAGENT_RUN_ID`、child agent、child index 和 orchestrator metadata，使 `contact_supervisor` 可以把真实子 Agent Run 关联到父级。

因此 native run 不是“未来可能安装”的参考，而是当前已经存在的执行实体。

### 2.3 外部类比，不是直接来源

- Airflow 的 Dag Run 说明同一个 workflow definition 可以产生多个独立执行实例。
- Temporal 的 Workflow ID / Run ID 与 Continue-As-New 提供“同一逻辑链、不同执行 Run”的成熟术语。
- LangGraph 的 thread/checkpoint/store 展示 session continuity、执行状态与长期 memory 应当分离。
- AQM 的 stage snapshot/restart 展示 partial context preservation 的开源实现方向。

这些项目可用于校准语义和评估复用，但没有证据证明它们直接影响了本项目 Architecture v2.1。

## 3. 术语表

| 术语 | 本项目建议定义 |
|---|---|
| Task | 用户希望完成的逻辑目标，可跨多个 plan version 和 run |
| Plan Version | Lead 与用户批准的当前任务方案版本 |
| Native Run | pi-subagents 启动的一次真实子 Agent 执行，以原生 `runId` 标识 |
| Session / Thread | 保存模型对话历史与上下文的容器；一个 session 可被 resume，但不等于一个治理 Run |
| Execution Attempt | 仅在表达同一 Task/Plan 下的重试序号时使用；必须引用 native `runId`，不能自成身份体系 |
| Retry | 因瞬时失败对同一逻辑操作再次尝试，不改变已批准 scope |
| Resume | 从已持久化 session/context 继续 Agent 工作 |
| Restart on Scope Change | 新 `planVersion` 下启动新的 native run；旧 run 变为 stale |
| Checkpoint | 可恢复的状态快照；普通日志或 partial artifact 不自动等于 checkpoint |
| Artifact | Agent 产生的文档、代码、报告、测试结果或 partial output |

## 4. lifecycle.mjs 审计

### 与 pi-subagents 重叠

- run identity
- active/terminal lifecycle
- output/session artifact paths
- restart/resume 相关状态
- lifecycle observability

这些能力应读取或引用 pi-subagents 的 native artifacts，而不是重新实现。

### 项目独有价值

- `planVersion`
- `staleAsOf`
- 旧结果是否 authoritative
- scope-change partial preservation
- role memory 中的 stale marker
- 新计划对旧 artifact 的引用与重新验证要求

这些属于项目治理，应保留。

### 当前主要缺口

1. 自定义 lifecycle record 没有强制绑定真实 `PI_SUBAGENT_RUN_ID`。
2. `policy.mjs::RunRegistry` 与 persistent lifecycle 存在双重状态来源。
3. `markStale()` 创建新 JSON record 不等于真实启动新的 Pi Agent Run。
4. `safeBoundary=true` 是状态声明，不自动证明子进程真的抵达安全边界。
5. 应消费 native `events.jsonl/status.json/process-terminal`，避免凭自定义标记推断进程状态。

## 5. 开源复用矩阵

| 方案 | 已有能力 | 当前适配度 | 建议 |
|---|---|---:|---|
| 已安装 pi-subagents | runId、状态、事件、session、resume/stop/interrupt、artifact、process proof | 最高 | 作为 canonical execution substrate |
| 已安装 pi-intercom | Run/child/parent metadata 与 supervisor 通道 | 高 | 复用现有 metadata，不另建路由身份 |
| LangGraph | thread checkpoint、interrupt/resume、store | 中 | 仅在未来采用显式状态图时评估；当前不要引入 |
| Temporal | durable workflow chain、Run ID、Continue-As-New | 概念高，集成成本高 | 用于术语和可靠性参考；当前不要安装 |
| Airflow | DAG/task execution instance | 低 | 只作概念谱系参考，不适合交互式 Agent Team |
| AQM | queue、stage snapshot、restart | 待验证 | 可研究实现方式，成熟度与维护状态需单独评估 |

当前 build-vs-reuse 决策：**配置并复用 pi-subagents，围绕其 native run 编写薄治理 adapter；不引入新的重型 workflow runtime。**

## 6. 推荐 canonical data model

```ts
interface GovernedAgentRun {
  taskId: string;
  planVersion: string;

  // Canonical execution identity from pi-subagents.
  nativeRunId: string;
  sessionId?: string;
  role: "researcher" | "architect" | "engineer" | "critic" | "reviewer";

  governanceStatus: "active" | "stale" | "completed" | "failed";
  staleAsOf?: string;
  staleReason?: string;
  authoritative: boolean;

  partialArtifacts: string[];
  nativeStatusPath?: string;
  nativeEventsPath?: string;
  nativeSessionPath?: string;
}
```

原则：

- `nativeRunId` 不从内容 hash 派生。
- 不复制 pi-subagents 的完整 runtime state。
- adapter 只保存项目治理字段与 native artifact 引用。
- authority 由 `planVersion + governanceStatus` 判断，而不是由 session 是否仍存活判断。

## 7. 最小迁移路径

1. **建立映射。** 启动子 Agent 时，把 `PI_SUBAGENT_RUN_ID` 写入治理记录。
2. **单一真相源。** native runtime 状态读取 pi-subagents `status.json/events.jsonl`；项目治理状态由一个 persistent adapter 管理。
3. **消除双 Registry。** `RunRegistry` 改为 adapter 的只读缓存或 façade，不再独立决定 authority。
4. **修正 restart。** `markStale` 只负责冻结旧 run；真正的新 run 必须通过 pi-subagents launch 返回新的 native runId，再创建治理映射。
5. **修正 safe boundary。** 结合角色协议和 native lifecycle/process-terminal evidence 验证，不能在 `markStale()` 内无条件写成 true。
6. **复用 partial。** 新 run payload 显式引用旧 partial artifacts，并要求重新验证；旧结果默认不权威。
7. **负控。** 移除 native run adapter 后，scope-change E2E 必须失败，证明结果由真实 pi-subagents lifecycle 因果产生。

## 8. 非声明与未决项

- 不声称 Temporal、Airflow、LangGraph 或 AQM 直接启发了本项目。
- 不声称 `intercom cancel` 能终止子 Agent。
- 不声称 persistent lifecycle record 等于完整 session/context checkpoint。
- 不声称写入 `safeBoundary=true` 就证明实际进程安全终止。
- 尚需查明 pi-subagents extension API 中最稳定的 run-start/run-terminal 消费接口；优先使用公开 artifacts/API，避免依赖内部文件布局。

## 9. Researcher 流程教训

本次研究首版出现了“高置信度事实错误”：Researcher 只检查 `.pi/researcher-runtime/node_modules`，便断言项目没有安装 pi-subagents/intercom。根因是角色最初没有 `ls/find/grep`，无法完成本地生态发现。

因此，新的 Researcher 原则必须落实为能力和门禁：

1. 架构研究先扫描本地 settings、lockfile、package tree、extension source。
2. 强制回答“概念来源”和“已有 OSS 可复用项”。
3. `research_checkpoint` 的 source count/confidence 不能替代本地事实验证。
4. Lead 必须对影响架构的本地事实做独立机械核验。
5. 没有完成本地生态扫描前，不得建议自行 build。

## 10. 主要来源

### 本地直接证据

- `.pi/decisions/2026-08-21-agent-team-communication-baseline.md`
- `.pi/research/agent-team-communication-architecture-v2.md`
- `.pi/research/agent-team-communication-architecture-v2.1.md`
- `.pi/communication/lifecycle.mjs`
- `.pi/communication/policy.mjs`
- `.pi/settings.json`
- `.pi/npm/node_modules/pi-subagents/README.md`
- `.pi/npm/node_modules/pi-subagents/docs/observability.md`
- `.pi/npm/node_modules/pi-subagents/docs/tool-reference.md`
- `.pi/npm/node_modules/pi-subagents/docs/workflows.md`
- `.pi/npm/node_modules/pi-intercom/index.ts`

### 外部 primary/reference sources

- pi-subagents Observability: https://github.com/nicobailon/pi-subagents/blob/main/docs/observability.md
- Temporal Workflow Execution: https://docs.temporal.io/workflow-execution
- Temporal Continue-As-New: https://docs.temporal.io/workflow-execution/continue-as-new
- Airflow Dag Runs: https://airflow.apache.org/docs/apache-airflow/stable/core-concepts/dag-run.html
- LangGraph Persistence: https://docs.langchain.com/oss/python/langgraph/persistence
- AQM: https://github.com/aqm-framework/aqm
