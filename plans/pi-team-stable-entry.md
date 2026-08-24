# Pi Team 稳定入口实施计划

## 目标

建立项目级 Windows 原生入口 `.\pi-team.cmd`，直接启动 Pi Agent，不经过 `pi-subagents`、`runs.run` 或二次任务规划。

- Executor 与 Reviewer 在同一任务 worktree 中持续存在，使用固定会话和直接 intercom 通信。
- Researcher 按具体问题临时启动。
- 模型统一由项目 `.pi/settings.json` 固定为 `minimax-cn / MiniMax-M3`，启动命令不得覆盖模型。
- Pi 内置 `bash` 工具通过 `shellPath` 固定到 Windows PowerShell；禁止自动选择 Git Bash、WSL 或其他 `bash.exe`。
- 先实现轻量 Lead 汇报事件和 CLI watcher；黑板 UI、Codex 插件和 MCP 不在本次范围内。

## 公共接口

### 任务契约

Lead 在 `tasks/<task-id>.md` 中维护正式契约。文件包含一个带版本标记的 JSON fenced block：

```json
{
  "version": 1,
  "task_id": "TASK-001",
  "name": "简短任务名称",
  "description": "当前任务说明",
  "base_ref": "main",
  "branch": "pi-team/TASK-001",
  "worktree": "D:/Coding/Harness/Pi-team-TASK-001",
  "in_scope": [],
  "out_of_scope": [],
  "done_criteria": [],
  "constraints": []
}
```

`task_id` 创建后不可修改；Lead 可修改名称、说明、范围、完成条件和约束。分支、worktree 和会话身份在启动后不可通过 `sync` 修改。

### CLI

```text
.\pi-team.cmd doctor
.\pi-team.cmd validate tasks/<task-id>.md
.\pi-team.cmd start tasks/<task-id>.md
.\pi-team.cmd sync tasks/<task-id>.md
.\pi-team.cmd research <task-id> <question-id> <question-file>
.\pi-team.cmd status [task-id]
.\pi-team.cmd watch [task-id] [--timeout 55]
.\pi-team.cmd resume <task-id>
.\pi-team.cmd accept <task-id>
.\pi-team.cmd reclaim <task-id>
.\pi-team.cmd cleanup <task-id>
```

- `doctor` 只检查 Git、Pi、Windows Terminal、PowerShell、MiniMax 配置、角色资源和扩展，不安装、更新或下载任何内容。
- `start` 验证契约，执行 `git worktree add`，然后在 Windows Terminal 同一任务窗口内启动 Executor 与 Reviewer 分栏。
- `research` 在同一任务通信域内新增 Researcher 标签页；问题文件的完整 UTF-8 内容作为问题，输出为 `research/<question-id>.md`。
- `resume` 使用原有 Pi session ID，不创建新会话；已有进程存活时拒绝重复启动。
- `accept` 要求 Reviewer 最新状态为 `ready_for_acceptance`。
- `reclaim` 只在验收后终止任务进程，不操作 worktree。
- `cleanup` 要求任务已验收、进程已回收且 worktree 干净；只执行非强制 `git worktree remove`，不 stash、不删除分支、不使用 force。

### Agent 汇报工具

三个角色获得：

```text
report_to_lead({
  state,
  activity,
  blocker?,
  next?
})
```

运行时注入 `task_id`、`role`、`agent_id`、`worktree`、单调递增 sequence 和时间，不允许 Agent 修改 Lead 所有的任务元数据。工具返回当前任务名称和说明，使 Agent 更新状态时重新对齐目标。

状态限制：

- 通用：`working | waiting | blocked`
- Researcher：额外支持 `completed`
- Executor：额外支持 `ready_for_review`
- Reviewer：额外支持 `reviewing | changes_requested | ready_for_acceptance`

## 实现要求

- 以 `.cmd` 作为薄入口，PowerShell 脚本负责契约校验、Git 操作、运行时登记和 Windows Terminal 参数组装；所有外部程序均使用参数数组或 encoded command，避免逗号工具列表和路径被 shell 拆分。
- 在项目 Pi 配置中固定 `defaultProvider`、`defaultModel` 和标准 Windows PowerShell `shellPath`。角色启动参数绝不包含 `--provider` 或 `--model`。
- 从现有角色定义装载 system prompt、skill、role-policy extension 和严格工具 allowlist；移除直接会话中实际不可用的 `contact_supervisor`。保留 `intercom`，并用每任务随机 scope UUID 隔离通信。
- Executor 与 Reviewer 使用持久化随机 session UUID、固定 peer 名称和同一 worktree。结束一次响应后保持 Pi TUI 存活并进入 idle；不做 stop/resume 循环，不反复 discovery。
- 运行状态保存在 `<git-common-dir>/pi-team/v1/`，包括任务快照、会话 UUID、进程 PID/启动时间和不可覆盖的逐 Agent 事件。不得使用应用层 hash。
- `reclaim` 根据登记的 PID、启动时间和进程类型验证目标后终止对应 PowerShell/Pi 进程树；异常关闭后由 `resume` 复用原会话。
- 同步更新 Pi Team ADR、协作协议、角色 prompts、skills、`architect.md`、`goal.md` 和 `project_state.md`。明确 Reviewer 可以使用 Git 做 diff、历史和状态检查；Agent 不得自动 stash、提交、切换分支或清理 worktree。
- 保持现有 Researcher 的普通定向调研能力，不引入 deep-research MCP、Scout、额外子任务分解或 `runs.run`。
- Blackboard 未来直接消费 `pi-team/v1` 事件；本次不实现黑板 UI、Codex 悬浮插件、MCP 或主动桌面通知。

## 测试与验收

- 契约测试：有效契约、非法 task ID、重复 JSON block、字段缺失、启动后修改不可变字段、危险 worktree 路径均有覆盖。
- 启动参数测试：使用 fake Pi/WT/Git 验证工具列表作为单一参数传递，模型未出现在 CLI，PowerShell 被固定，参数中不存在 WSL、`runs.run` 或额外 Agent。
- 临时 Git 仓库集成测试：创建 worktree、重复启动拒绝、原 session 恢复、Executor–Reviewer 共用 worktree、Researcher 加入相同通信 scope。
- 生命周期测试：只有 Reviewer `ready_for_acceptance` 后可验收；验收前不能 reclaim；脏 worktree、存活进程或主 worktree 不能 cleanup；不执行 stash、force 或分支删除。
- 事件测试：角色状态枚举、字段长度、身份注入、逐 Agent sequence、任务非 active 时拒绝写入、`status/watch` 能读取新事件。
- CRLF 防护：不批量转换换行；验证既有文件行尾被保留，并运行 `git diff --check` 检查意外换行和空白变化。
- 最终运行 `tests/run-tests.ps1`；另提供显式启用的真实 MiniMax smoke test，用于人工确认两个可见终端会话能直接互发 `READY_FOR_REVIEW`/反馈，不作为默认离线测试的一部分。

## 执行边界与假设

- 在 `D:\Coding\Harness\Pi-team-bootstrap-protocol` 的现有协议变更基础上继续，保留已有未提交变更，不覆盖用户工作。
- `.pi/legacy` 必须保持不变。
- Windows PowerShell 5.1、Windows Terminal、Git 和 `pi.cmd` 已安装；缺失时 `doctor` 失败并给出修复说明，不自行安装。
- Lead 仍由 Codex 与用户共同承担；Pi Team 不启动额外 Lead Agent。
- Agent 报告阻塞后结束当前 turn 并保持 idle。黑板完成前，Lead 通过 `pi-team watch/status` 获知事件，并在对应终端中给出后续指令。
- 本计划只覆盖 Pi Team 稳定入口；不得顺带实现 Blackboard，也不得重新引入 Architect Agent、Scout 或 deep research 工作流。

## 新 Session 执行提示

新 session 应先读取本计划、`ADR/0002-lead-subagent-collaboration-protocol.md`、`AGENTS.md` 和当前 `git status`，然后在本 worktree 内实现。现有变更均视为用户工作；不得 reset、stash 或清理。完成后报告修改文件、测试证据、未解决风险，并等待用户决定是否提交。
