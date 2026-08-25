# Agent Blackboard 可观测性 MVP

状态：实现、确定性验证和真实 Pi Blackboard 因果 smoke 已完成；安装后新 session 的 MCP/PiP 验收及完整持久角色 live smoke 待完成。

## Summary

建立项目级黑板，按 Lead task ID 划分任务泳道。

- Lead 负责创建任务，并持续维护任务名称和任务说明。
- Researcher、Executor、Reviewer 只能更新自己的当前状态与动作，不能修改任务定义。
- 每次 Agent 更新都会形成事件，并唤醒正在监听的 Lead。
- Codex 仓库内插件提供黑板管理、监听和 PiP 悬浮展示。
- 黑板只负责观察与提醒；纠偏继续走现有 Lead 通信路径。
- 全部使用 Windows 原生 Node.js、PowerShell 和 Git，不使用 WSL/Bash。

## Key Changes

### 1. 任务与事件模型

运行状态保存在：

```text
<git-common-dir>/harness-blackboard/v1/
```

主工作树和独立 worktree 共享同一黑板，且不会污染 Git 状态。

任务由 Lead 创建和维护：

```text
task_id             Lead 分配，创建后不可修改
name                Lead 维护的简短任务名称
description         Lead 维护的任务说明与当前范围
status              active | accepted | archived
created_at
updated_at
```

规则：

- Agent 不能创建任务或修改 `name`、`description`。
- Lead 可在任务范围变化时更新名称和说明。
- 任务说明是黑板中判断目标漂移的当前基准，但不替代 `goal.md`、ADR 或正式任务契约。
- 任务被 Lead 验收后标记为 `accepted`，资源回收后归档。
- Lead 修改任务元数据会刷新 UI，但不会提醒 Lead 自己；只有 Agent 活动事件会唤醒 Lead。

Agent 更新采用独立、不可覆盖的事件：

```text
version
task_id
role
agent_id
state
activity
blocker?
next?
worktree
sequence
observed_at
```

- `task_id` 必须对应已存在的 active 任务。
- `role`、`agent_id`、`worktree` 由运行时注入。
- `sequence` 是每个 Agent 单调递增整数。
- `observed_at` 由运行时生成。
- `activity` 必填、单行、最多 240 字符。
- `blocker`、`next` 可选，各最多 500 字符。
- 不使用应用层 hash。

状态集合：

- 通用：`working`、`waiting`、`blocked`
- Researcher：额外允许 `completed`
- Executor：额外允许 `ready_for_review`
- Reviewer：额外允许 `reviewing`、`changes_requested`、`ready_for_acceptance`

### 2. Pi Agent 集成

向三个角色注册：

```text
blackboard_update({
  task_id,
  state,
  activity,
  blocker?,
  next?
})
```

运行时根据 `task_id` 返回 Lead 维护的任务名称和说明，使 Agent 在每次更新时重新看到当前目标。

Agent 更新规则：

- 接到任务后，在第一个实质性工具调用前更新。
- 开始新的具体动作或切换工作阶段时更新。
- 开始等待、遇到阻塞、提交审查、给出审查结论时立即更新。
- 不为每个文件或命令更新，不做周期性 heartbeat。
- 如果任务不存在、已经归档或可观测性写入失败，Agent 在安全边界暂停并通知 Lead。
- 黑板更新不是授权、完成证明或通信回执。

同时修正现有闭环：

- Executor 发布 `ready_for_review` 后保持会话存活并等待 Reviewer。
- Reviewer 和 Executor 持续往返，直至 Reviewer 发布 `ready_for_acceptance`。
- Lead 验收后才回收会话和 worktree。
- 删除现有 stop signal 和 Reviewer 等待 Executor 退出的契约。
- Reviewer 保留只读 Git、测试编写和代码 review 能力，但不修改生产代码。

### 3. Codex 仓库内插件

使用 repo-local marketplace 维护团队插件，包含：

- `.codex-plugin/plugin.json`
- 本地 STDIO MCP server
- Blackboard Lead skill
- MCP Apps UI
- 必要资源和构建脚本

Lead 工具：

```text
blackboard_create_task(project_root, task_id, name, description)
blackboard_update_task(project_root, task_id, name?, description?)
blackboard_accept_task(project_root, task_id)
blackboard_archive_task(project_root, task_id)
blackboard_snapshot(project_root, include_archived=false)
blackboard_watch(project_root, cursor, timeout_ms)
blackboard_render(project_root)
```

权限与行为：

- 任务管理工具仅提供给 Codex Lead，不暴露给 Pi Agent。
- `task_id` 创建后不可修改；需要新 ID 时创建新任务并归档旧任务。
- 每次修改名称或说明都保留修订记录，包括旧值、新值和时间。
- `blackboard_watch` 最长等待 55 秒；发现 Agent 新事件立即返回全部未读事件及新 cursor。
- Lead 检查事件时，同时收到该任务最新的名称和说明，直接比较 Agent 当前动作与任务范围。
- watcher 超时仅代表没有更新。
- watcher 在任务存在活跃 Agent 时重新挂载，避免无界等待。

### 4. PiP 黑板界面

UI 按任务泳道展示：

- Lead task ID
- Lead 维护的任务名称
- 可展开的任务说明
- 当前任务状态
- 每个 Agent 的角色、状态、当前动作、阻塞、下一步和更新时间
- 名称或说明最近被 Lead 修改的标记
- 未读 Agent 更新高亮

UI 请求 `picture-in-picture`；宿主不支持时退化为 inline widget。PiP 的具体停靠位置由 Codex 宿主管理，不能保证固定在右侧。

UI 每两秒读取 snapshot；关闭 UI 不影响 Lead watcher。插件不依赖 UI 才能完成提醒。

### 5. 文档对齐

新增 Blackboard ADR，并同步更新架构、目标和项目状态文档：

- Lead 独占维护 task ID、任务名称和任务说明。
- Agent 只能维护自己的活动状态。
- 任务说明是实时范围基准。
- 黑板是事实与提醒平面，不是控制总线。
- Lead 不作为 Agent 卡片显示。
- Lead 纠偏继续使用既有 supervisor/intercom 路径。
- Executor 与 Reviewer 在验收前持续存在。
- 归档保留历史，MVP 不自动删除。

## Test Plan

### Deterministic tests

- Agent 无法创建任务或修改任务名称、说明。
- task ID 创建后不可修改。
- Lead 可以修改名称和说明，并产生正确修订记录。
- Agent 更新只能写入 active 任务。
- Agent 无法伪造 role、agent ID、时间、sequence 或 worktree。
- 状态枚举、字段长度和单行约束正确。
- 多 worktree 解析到相同 Git common directory。
- Executor/Reviewer 并发更新不会覆盖或丢失事件。
- cursor 不重复、不跳过事件。
- Lead 修改任务说明不产生自我提醒。
- 归档任务默认隐藏但历史可查询。
- 插件 manifest、MCP schema 和 UI resource 验证通过。
- PiP 缺失时正确退化为 inline。

### Causal live smoke

1. Lead 创建任务，写入名称和说明。
2. Lead 挂载 watcher。
3. Executor 更新“正在创建 BlackBoard 类”。
4. watcher 必须由该事件提前返回，并同时携带最新任务名称和说明。
5. Lead 修改任务说明，Executor 下次更新必须看到新说明。
6. Executor 发布一个故意偏离最新说明的动作。
7. Lead 必须被唤醒并通过既有通信路径纠正。
8. Executor 发布纠正后的 `working` 状态。
9. Reviewer 发布 `reviewing`，随后发布 `ready_for_acceptance`。
10. Lead 验收、归档并回收持久会话和 worktree。

负控制：

- 不调用 `blackboard_update` 时，watcher 只能超时，不得制造活动。
- 仅修改任务名称或说明时，不得错误触发 Agent 活动提醒。
- 禁用 watcher 但保留事件写入时，snapshot 应出现事件，但不能声称 Lead 被自动唤醒。
- 禁用事件写入时，不能因 Agent 实际做过工作而声称黑板具有可观测性。

live smoke 使用直接角色会话，不经过可能重写任务或增加 Scout 的 `runs.run` 路径。

## Assumptions

- 首版只支持本地 Windows Codex/Pi-team 环境。
- 插件作为仓库内团队插件维护。
- Agent 活动依赖显式手动更新，不推断文件操作或模型思考。
- Lead 负责保证任务名称和说明始终反映当前有效范围。
- Blackboard 降低目标漂移风险，但不把“调用过更新工具”视为目标一致性的证明。

## Handoff

实现位于 `plugins/agent-blackboard/` 与 `.pi/communication/extensions/blackboard-update.ts`。
新 session 应先读取本文件以及仓库根目录下的 `AGENTS.md`、`architect.md`、
`goal.md` 和 `project_state.md`，然后按照 Lead runbook 显式创建 Blackboard task，
再手动调用 `pi-team.cmd start <contract>`；创建泳道本身不会启动 Pi Team。
