# ISSUE-018 — Issue #9 三角色启动上下文注入只读调研（v2，含联网补充）

- Lead task ID: **ISSUE-018**
- Research delegation: **RESEARCH-ISSUE-018**
- Worktree surveyed: `D:/Coding/Harness/Pi-team-ISSUE-018`
- Survey target: 仓库内三角色当前启动上下文注入（prompt / env / role-md / skill /
  contract 字段），重复目录与环境探索路径，已知上下文复用边界，
  task/worktree/scope/role 权限与 artifact 所有权校验，以及可测成本指标。
- Survey method: read-only file inspection (`read`, `grep`, `find`,
  `ls`) of the current worktree plus targeted `web_search` and
  `source_check` for official / blog evidence. 不运行系统命令、不修改
  生产代码、不修改测试、不读取/推导 Gold / oracle / 期望补丁 /
  评测保留数据。Fetched pages were blocked by the research provider's
  SSRF / TUN guard; web evidence comes from search-result snippets
  synthesized by the search provider and is recorded as **unsourced**
  for any claim that could not be triangulated. Per Lead's explicit
  instruction, web evidence is reference-only and does not replace the
  local code / contract / test evidence below.
- Date of survey: capture-time only. 不做 live profiling。

> **本版本（v2）与 v1 的差异**
>
> 1. v1（已存在 artifact）记录的 R1（`Research` 函数 6 字段重述）在
>    capture 时是"未落地"——但 **v2 复核时 R1 已落地**：`scripts/pi-team.ps1:553`
>    已将 `$assignment` 收敛为 `"$(New-RoleContext $contract 'researcher'
>    'research' $q) Lead assignment. Answer exactly this question: $q"`。
>    Executor 的 `implementation_notes/ISSUE-018.md` 与
>    `reports/ISSUE-018-verification.md` 已记录这次落地；
>    `tests/team-contract.test.mjs` 也新增 R1 负向断言
>    `assert.equal(rCtxLine.includes("Lead assignment."), false, ...)`。
>    v2 因此把 R1 从"残留 / 仍未落地"重写为"已落地"。
> 2. v2 按 Lead 明确要求补充 **联网证据**：Anthropic 官方 / 业界博客
>    / 子代理上下文隔离规范 / 单题有界研究实践共 11 条来源，逐条标注
>    与本仓库的适用边界。
> 3. v2 在"可测成本指标"中区分"启动 prompt 字节数（已可测）"与"上游
>    LLM 缓存命中率（不可在本仓库本地测量，仅作方向参考）"两层，避免
>    把外部缓存节省成本错认为 Issue #9 优化效果。

## 问题（一句话）

GitHub Issue #9 在三角色启动阶段重复注入了哪些已知上下文（AGENTS.md / ADR/0002
/ `New-RoleContext` / Researcher 的 hand-built assignment / 角色 markdown /
skill / 权限校验），哪些仍存在可消除的重复目录与环境探索，最小安全优化边界
是什么，正向验证场景应如何写，缺失环境信息时必须拒绝哪些负向场景，以及哪些
可测成本指标可以证明优化有效。

## 结论摘要

三角色启动上下文注入由四条独立通道构成：(1) 启动器构造的 dynamic prompt
（`scripts/pi-team.ps1` 的 `New-RoleContext` 路径与 `New-RoleAssignment` /
`Research` / `Resume-Task` 的 assignment 路径），(2) `RoleArguments` 的
`--append-system-prompt` / `--skill` / `--extension` / `--tools` 通道，
(3) 进程级 `PI_TEAM_*` 与 `PI_INTERCOM_STABLE_ID` 环境变量，
(4) Agent Blackboard / intercom 运行时通过 `.pi/communication/extensions/*`
 与 `plugins/agent-blackboard/server/blackboard-core.mjs` 提供的状态写入。

Issue #9 的重复探索集中体现在 **启动 dynamic prompt 的导航提示行**：
v2 capture 时 `Start` 路径已经在 `New-RoleContext`（`scripts/pi-team.ps1:451`）
中合并了"Stable project context + Recommended common reads + Normative
protocol"三处对 AGENTS.md / ADR/0002 的引用，把 `Recommended common reads`
整行删除并把"normative protocol is ADR/0002"吸收进"Stable project context"
一句，单 prompt 引用 AGENTS.md / ADR/0002 各仅一次；`Resume` 路径则用
"AGENTS.md is already present in the existing session; do not reload or
rediscover it"（`scripts/pi-team.ps1:461`）整句直接复用上下文。**v2 时点
全部残留重复已落地**：R1（`Research` 函数 6 字段重述）也已收敛为
`scripts/pi-team.ps1:553` 的 `"$(New-RoleContext ...) Lead assignment.
Answer exactly this question: $q"`，并由 `tests/team-contract.test.mjs` 的
新增断言 `assert.equal(rCtxLine.includes("Lead assignment."), false, ...)`
锁定。**可测成本指标**有两层：(a) **本仓库本地可测**——启动 prompt 字节数
（`New-RoleContext` 输出 `< 1600` 字节）、`Get-ToolRuntimeMetadata` 5
字段存在性（`scripts/pi-team.ps1:446-448` 的 `Fail()` 防御环）、跨合同
worktree 路径不残留（`tests/team-contract.test.mjs:1046-1100`）；(b) **上游
LLM 缓存命中**——受 Anthropic 5-min TTL 与 `cache_control` 断点策略约束，
不在本仓库可测范围，仅作 Issue #9 优化的方向性参考。权限校验
（task/worktree/scope/role/artifact 所有权）保持原状不变：
`Parse-Contract`、`Assert-BlackboardTask`、`Get-RoleCapabilities`、
`Assert-DelegationCapabilities`、`Assert-RelativeArtifactPath`、
`Assert-ReviewerReadyForAcceptance`、`Assert-NoLiveRoleProcesses`
一律不动；缺失环境信息（`command_interpreter` / `os_family` 等）由
`Get-ToolRuntimeMetadata` 的 `Fail()` 拒绝（已由
`tests/team-contract.test.mjs` `ISSUE-018:` 系列测试覆盖）。

## 现状测绘（四通道）

### 通道 1：Dynamic prompt（`New-RoleContext` + `New-RoleAssignment` + `Research`）

`scripts/pi-team.ps1:451` 的 `New-RoleContext($Contract, $Role, $Mode, $Question)`
根据 `$Mode` 派发三种 prompt：

- `Mode = 'start'`：Issue #9 提交后的实现（`scripts/pi-team.ps1:471-499`）。
  注释明确写出"previous start prompt duplicated AGENTS.md … ADR/0002 …
  Consolidate them into a single Stable project context line and drop
  Recommended common reads entirely"。`$lines` 数组按固定顺序输出
  `Context mode` / `Stable project context`（单句含 AGENTS.md + project_state.md
  + ADR/0002）/ `Context boundary` / `Task ID` / `Role` / `Branch` /
  `Worktree` / `Delegation` / `Owned artifact` / `Required capabilities` /
  `Objective` / `Visible scope` / `Out of scope` / `Owned done criteria` /
  `Tool runtime metadata` / （role-specific）`Recommended role reads` /
  （role-specific）`Implementation boundary` 或 `Research boundary` 或
  `Review boundary` / `--- END PI TEAM TASK CONTEXT ---`。`Recommended common
  reads:` 在 start 路径中**整行删除**；`Normative protocol: ADR/0002-...`
  **整行删除**；二者由 `Stable project context: AGENTS.md … normative protocol
  is ADR/0002-lead-subagent-collaboration-protocol.md.` 合并承担。
- `Mode = 'resume'`：仍使用独立分支（`scripts/pi-team.ps1:455-470`）。
  `Stable project context: AGENTS.md is already present in the existing
  session; do not reload or rediscover it.`；`Recommended common reads` /
  `Recommended role reads` 一律不出现在 resume prompt 中（由
  `tests/team-contract.test.mjs:724-725` 的 `assert.doesNotMatch(prompt,
  /Recommended common reads:/, …)` 与
  `assert.doesNotMatch(prompt, /Recommended role reads:/, …)` 锁住）。
- `Mode = 'research'`：复用 start 模板，并追加
  `Recommended role reads: .pi/skills/answer-research-question/SKILL.md,
  .pi/communication/policy.mjs, research/` 与
  `Research boundary: answer one bounded question, …`；当 `$Question` 非空时
  追加 `Research question: …`。这意味着 researcher 的 Recommended role reads
  与 done-criteria 共享同一套模板。

`New-RoleAssignment($Contract, $Role)`（`scripts/pi-team.ps1:424-431`）调用
`New-RoleContext $Contract $Role 'start'` 并在其后追加
`Lead assignment. Task ID: … Worktree: … Role: … Delegation: …
Artifact: … Required capabilities: … Objective: … Done criteria: <self only>`。
`Start-Task` 对 executor / reviewer 各调用一次，得到 role-scoped prompt，避免了
Issue #1 之前的跨角色所有权泄露。`New-RoleAssignment` 输出的 prompt
里 `Task ID / Worktree / Delegation / Owned artifact` 已经在
`New-RoleContext` 中出现过，`Lead assignment.` 那一句又重写了一次——这是
刻意保留的"Lead 元语"层（区别于 dynamic context 的 contract-bound 字段），
不可消除；Issue #9 不应碰它。

`Research` 函数（`scripts/pi-team.ps1:531-553`）的 `$assignment` v2 时点为：

```powershell
$assignment = "$(New-RoleContext $contract 'researcher' 'research' $q) Lead assignment. Answer exactly this question: $q"
```

v1 capture 时它曾经写为
`"$(New-RoleContext $contract 'researcher' 'research' $q) Lead assignment.
Task ID: $($s.task_id). Worktree: $($s.worktree). Research delegation:
$($delegation[0].id). Research artifact: $($delegation[0].artifact_path).
Required capabilities: $($delegation[0].required_capabilities -join ', ').
Objective: $($delegation[0].objective). Answer exactly this question: $q"`，并
因此对 `New-RoleContext` 已输出的字段做了 6 个重述。v2 时点这 6 个重述
已删除，注释（`scripts/pi-team.ps1:546-551`）记录了删除理由；新增的
`tests/team-contract.test.mjs` 断言
`assert.equal(rCtxLine.includes("Lead assignment."), false, ...)` 锁住
"dynamic context 不再携带 Lead 元语"，保留 `New-RoleContext` 只承担字段
声明、`Research` 函数只承担 action constraint（`Answer exactly this
question: $q`）的分工。

`Resume-Task`（`scripts/pi-team.ps1:556-562`）则仅向角色注入
`"$context Resume the existing Lead task session as $r and continue the
assigned work."`，没有重复 dynamic context 的字段。

### 通道 2：`RoleArguments` 的 Pi CLI 注入（`scripts/pi-team.ps1:322-339`）

每个角色经由 `--no-extensions` / `--no-skills` / `--tools <role-allowlist>`
/ `--skill <role-skill>` / `--append-system-prompt <role-md>` /
`--extension <intercom>` / `--extension <role-extension>` /
`--extension <blackboard-update>` 通道被构造。Researcher 多挂
`--extension <pi-web-access>`。`RoleArguments` 与 `Get-RoleCapabilities`
（`scripts/pi-team.ps1:108-118`）共同确定三角色的硬编码能力清单：

```
researcher: read,grep,find,ls,write,web_search,fetch_content,get_search_content,source_check,pi_team_intercom,blackboard_update
executor : read,grep,find,ls,bash,edit,write,pi_team_intercom,blackboard_update
reviewer : read,grep,find,ls,bash,edit,write,pi_team_intercom,blackboard_update
```

Issue #9 不应触碰这条通道——它与角色 markdown 的 `tools:` 前沿一致、由
`tests/team-contract.test.mjs` 的 capability isolation / role launchers
系列测试锁定；`assert.equal(record.args[record.args.indexOf("--tools") + 1],
expectedTools.join(","))`（`tests/team-contract.test.mjs` 在
`role launchers inject common-dir identity …` 测试内的多处断言）保证
researcher / executor / reviewer 的工具集互不渗透。**与联网证据的边界**：
Anthropic 官方 prompt caching 文档（来源 1）规定 cache 命中的前缀顺序为
`tools` → `system` → `messages`；本仓库通过 `RoleArguments` 显式注入
`--tools <role-allowlist>` 与 `--append-system-prompt <role-md>`，等价于把
"tools" 与"system"两段前缀在每个 role 上**结构化固定**，这正是 Hermes
RFC #35575（来源 8）主张的"stable, repeating content comes first"模式——
本仓库不需要把 stable 内容前置，因为 `--tools` 与 `--append-system-prompt`
本身已经被 CLI 顺序前置。

### 通道 3：进程级环境变量注入（`Start-RoleProcess` in
`scripts/pi-team.ps1:310-348`）

`Start-RoleProcess` 写入并随后清理 8 个进程级环境变量：

```
PI_TEAM_TASK_ID          # 任务 ID（用于 intercom `pi-team--<task>--<role>--<launch>` 命名空间）
PI_TEAM_ROLE             # researcher / executor / reviewer
PI_TEAM_AGENT_ID         # New-Id 一次性生成
PI_TEAM_WORKTREE         # Lead 控制的 isolated worktree 路径
PI_TEAM_STATE_ROOT       # <git-common-dir>/pi-team/v1
PI_TEAM_SCOPE_ID         # New-Id 用于本任务 session 内聚
PI_TEAM_LAUNCH_ID        # New-Id 用于 Wait-RoleReady 与运行时 JSON 匹配
PI_INTERCOM_STABLE_ID    # pi-team--<task>--<role>--<launch>
```

8 个变量在 outer PowerShell 的 `try { … } finally { restore }` 块中保存与
恢复，避免泄漏到 launcher 自身。`.pi/communication/extensions/blackboard-update.ts`
读取 `PI_TEAM_LAUNCH_ID` / `PI_TEAM_TASK_ID` / `PI_TEAM_ROLE` /
`PI_TEAM_AGENT_ID` / `PI_INTERCOM_STABLE_ID` / `PI_TEAM_WORKTREE` 调用
`registerRoleRuntime` 把进程登记到 runtime JSON，**缺失任一字段都会使
`registerRoleRuntime` 收到 `undefined`**，因此"缺失环境信息时必须拒绝"
这条边界由该 extension 的运行时路径自然执行。**与联网证据的边界**：
v2 capture 时点 Anthropic cache TTL 是 5 min（默认）/ 1 h（2x 写成本），
这意味着在一个任务持续 < 5 min 的常见场景下，仅一次 start 不会有第二次
缓存命中；本仓库关心的成本仍是单 start 的 prompt 字节数与字段重复，
而非跨 start 缓存命中。

### 通道 4：运行时登记（`registerRoleRuntime`、
`Wait-RoleReady`、`<task>-<role>-runtime.json`）

`Start-RoleProcess` 把 identity 打包成 JSON + gzip + base64 + UTF-16
`EncodedCommand`，交给 bootstrap PowerShell 解码并 `Set-Item Env:`、
`Set-Location`、调用 `pi.cmd`。`Wait-RoleReady`（`scripts/pi-team.ps1:298-301`）
以 100 ms busy-poll 等待 `<task>-<role>-runtime.json` 出现且 `launch_id`
匹配；timeout 60 s。**这是 Issue #9 不应触碰的运行时登记路径**，因为它
属于 PERF-004 静态调查里 M2 的资源消耗项（详见
`research/PERF-004-static-survey.md` 第二节 "Mechanism 2"），且 Lead 显式
排除了 Issue #9 之外的资源优化（Issue #9 仅围绕 prompt 注入，不动
`Start-RoleProcess` / `Wait-RoleReady` 的实现）。

## Issue #9 已落地的改动（v2 实测全部完成）

1. **`scripts/pi-team.ps1:451` `New-RoleContext` start 分支合并 AGENTS.md 与
   ADR/0002 引用**。`Stable project context: AGENTS.md (shared repository map)
   is inherited; project_state.md is the Lead-owned operational snapshot;
   normative protocol is ADR/0002-lead-subagent-collaboration-protocol.md.`
   单句替代了之前的 "Stable project context: AGENTS.md" + "Recommended common
   reads: AGENTS.md, ADR/0002, project_state.md" + "Normative protocol:
   ADR/0002-lead-subagent-collaboration-protocol.md" 三行。注释（行 481-487）
   写明每 prompt 删除约 100 字节重复文本，每次 task start 删除约 200 字节。
2. **`Recommended common reads:` 行在 start 路径完全删除**。`tests/team-contract.test.mjs:1026`
   的 `assert.doesNotMatch(ctxLine, /Recommended common reads:/, ...)` 锁住
   "executor / reviewer 的 start prompt 必须不再出现 Recommended common
   reads"。Role-specific `Recommended role reads:` 仍在
   `tests/team-contract.test.mjs` 多处断言中（researcher / executor / reviewer
   三角色各自的 `Recommended role reads: ` 行）：`tests/team-contract.test.mjs:646`
   处 `assert.match(prompt, /Recommended role reads: /, ...)`。
3. **`Research` 函数 6 字段重述收敛（`scripts/pi-team.ps1:553`）**。v2 时点
   `$assignment = "$(New-RoleContext $contract 'researcher' 'research' $q)
   Lead assignment. Answer exactly this question: $q"`，与 v1 capture 时
   6 字段重述相比，prompt 减少约 250 字节。`tests/team-contract.test.mjs`
   新增 R1 负向断言
   `assert.equal(rCtxLine.includes("Lead assignment."), false, ...)`，确保
   `New-RoleContext` 不再携带 Lead 元语；该元语保留在 `Research` 函数内
   的"Lead assignment."一句。
4. **`Resume` 路径保留"`AGENTS.md` 已存在"的负向规则**（行 461）：
   `Stable project context: AGENTS.md is already present in the existing
   session; do not reload or rediscover it.` 由
   `tests/team-contract.test.mjs:723-724` 的 `assert.doesNotMatch(prompt,
   /Recommended common reads:/)` 与 `assert.match(prompt, /Context mode:
   resume/)` 锁定。
5. **`Get-ToolRuntimeMetadata`（行 423-451）保留所有 5 个必填字段并显式
   `Fail()`**：`os_family` / `os_version` / `os_architecture` /
   `command_interpreter` / `command_syntax_examples`；`command_interpreter`
   在 `$PSVersionTable` / `$env:SHELL` / `$env:ComSpec` 均缺失时退化为
   `unknown`，而不是空串或抛错前的优化绕过。
6. **`tests/team-contract.test.mjs` 新增 3 条 ISSUE-018 测试**：
   - `ISSUE-018: Get-ToolRuntimeMetadata keeps every required field even
     with missing interpreter env`（行 902-934）：模拟 `$PSVersionTable=$null`
     + 删 `env:SHELL` + 删 `env:ComSpec`，断言 5 个字段仍存在且
     `command_interpreter=unknown`。
   - `ISSUE-018: Get-ToolRuntimeMetadata refuses to emit a metadata line
     missing a required field`（行 937-972）：更深层的负向控制，断言
     5 个字段以 `; ` 分隔的数量恰好为 5。
   - `ISSUE-018: New-RoleContext deduplicates redundant navigation hints
     and stays under the size budget`（行 975-1043）：1600 byte hard upper
     budget；`Recommended common reads:` 与 `Normative protocol: ADR/0002`
     不出现；`Stable project context: AGENTS.md (shared repository map)`
     与 `normative protocol is ADR/0002-...` 出现；executor 与 reviewer
     prompt 字节长度不等；researcher prompt 字节长度 < 1700；R1 负向断言
     `New-RoleContext` 不携带 `Lead assignment.`。
   - `ISSUE-018: independent worktree paths flow into each role prompt
     without leaking cross-task paths`（行 1046-1100）：两条合同
     `ISSUE-018A` / `ISSUE-018B` 各自把 worktree 路径注入自己的 executor
     prompt，且互不泄露对方路径——这条保护 prompt 重建而非复用残留变量，
     与 Issue #9 的"已知上下文复用"密切相关：如果 `New-RoleContext` 缓存
     上次 prompt，第二个合同就会触发残留路径泄漏。

## Issue #9 的残留重复与可消除点（v2 时点全部已落地）

### R1（v1 capture 时残留，v2 时点已落地）：`Research` 函数的 hand-built assignment

v1 capture 时：
```
$assignment = "$(New-RoleContext $contract 'researcher' 'research' $q) Lead
assignment. Task ID: $($s.task_id). Worktree: $($s.worktree). Research
delegation: $($delegation[0].id). Research artifact: $($delegation[0].artifact_path).
Required capabilities: $($delegation[0].required_capabilities -join ', ').
Objective: $($delegation[0].objective). Answer exactly this question: $q"
```

v2 时点：
```
$assignment = "$(New-RoleContext $contract 'researcher' 'research' $q) Lead
assignment. Answer exactly this question: $q"
```

差异：6 个重复字段（Task ID / Worktree / Delegation / Artifact / Required
capabilities / Objective）已删除，措辞别名 2 个（`Delegation:` vs
`Research delegation:`、`Owned artifact:` vs `Research artifact:`）已
归并。`Answer exactly this question: $q` 作为 action constraint 保留在
`Research` 函数内（`New-RoleContext` 不携带 Lead 元语）。

### R2（潜在，但需谨慎；非 Issue #9 范围）：`Start-Task` 中 executor / reviewer 的
`Lead assignment.` 句对 dynamic context 字段的轻量重述

`New-RoleAssignment`（`scripts/pi-team.ps1:424-431`）已经在 dynamic context
之后附加 `Lead assignment. Task ID: … Worktree: … Role: … Delegation: …
Artifact: … Required capabilities: … Objective: … Done criteria: …`。其中
`Task ID / Worktree / Delegation / Artifact / Required capabilities / Objective`
六个字段**与 `New-RoleContext` 输出重复**，但其作用是给角色一个"当前
Lead 元语"的瞬时标识，让 `report_to_lead` / `READY_FOR_REVIEW` 等消息体里
可以引用，且 prompt 解析时不依赖上下文字段名。Issue #1 的实现（见
`research/ISSUE-001-prompt-boundaries.md` § "最小安全拆分建议" S1）保留
这一段；Issue #9 **不应消除**这段重述——它不是已知上下文，而是 Lead 元语。

### R3（不重复）：环境变量列表

`Start-RoleProcess` 注入的 8 个 `PI_TEAM_*` + `PI_INTERCOM_STABLE_ID` 不在
prompt 中重复。变量注入由 `Start-RoleProcess` 的 `try { … } finally { restore }`
块保证，prompt 走的是另一条 channel。

### R4（不重复）：角色 markdown / skill / tool isolation

`RoleArguments` 的 `--append-system-prompt <role-md>` / `--skill <role-skill>`
/ `--extension <...>` / `--tools <role-allowlist>` 是静态、与 prompt 文本
正交的通道。`.pi/agents/{researcher,executor,reviewer}.md` 与
`.pi/skills/{answer-research-question,execute-delegated-task,review-delegated-task}/SKILL.md`
每次启动都重新加载，没有跨任务缓存。Issue #9 不动这条通道。

## 权限 / 边界校验的现状（Issue #9 不得触碰）

`scripts/pi-team.ps1` 的安全校验由以下函数承担，Issue #9 不动它们：

| 函数 | 行号 | 校验内容 | Issue #9 处置 |
| --- | --- | --- | --- |
| `Parse-Contract` | 153-194 | `task_id` / `branch` / `worktree` / `base_ref` / `done_criteria` / `delegations` / `constraints` schema；worktree 必须绝对路径、不能是主 worktree 或 `<common-dir>` 子路径 | 不动 |
| `Assert-RelativeArtifactPath` | 121-122 | 合同 `artifact_path` / 接受 `artifacts` 必须是 worktree 相对、非空、不含 `..` | 不动 |
| `Get-RoleCapabilities` | 108-118 | researcher / executor / reviewer 硬编码 capability allowlist | 不动 |
| `Assert-DelegationCapabilities` | 124-127 | delegation 的 `required_capabilities` 必须是该角色允许的子集；legacy `intercom` 别名映射为 `pi_team_intercom` | 不动 |
| `Assert-BlackboardTask` | 368-376 | Lead 必须在 `start` 前在 Blackboard 创建同名 `active` 任务 | 不动 |
| `Assert-ReviewerReadyForAcceptance` | 222-225 | Reviewer Blackboard 状态必须是 `ready_for_acceptance` | 不动 |
| `Assert-NoLiveRoleProcesses` | 309 | resume 前所有角色 runtime 不存在（避免重复恢复） | 不动 |
| `Get-ToolRuntimeMetadata` | 423-451 | 5 个字段必须存在，缺失即 `Fail()`；`command_interpreter` 在 `$PSVersionTable` / `$env:SHELL` / `$env:ComSpec` 全部缺失时退化为 `unknown` 而非空串 | 不动（已是负向边界） |
| `Get-SetupIssues` | 78-92 | 启动前必查 `pi-subagents@0.56.0` / `pi-intercom@0.11.0` / `pi-web-access@0.24.2` 三个 npm 包在 user settings 中精确注册且版本匹配；`pi-web-access` 必须关闭 autoload | 不动 |
| `Set-WebAccessAutoloadDisabled` | 95-110 | 同上但写入 `settings.json`，`extensions=@()` 关闭 autoload | 不动 |
| `Assert-Setup` | 113-135 | AGENTS.md 必须存在且不含 `<lead-pi-team-runbook>` / Issue 编号 / 大写 ID 模式 / 绝对路径；extension 文件路径必须存在 | 不动 |

## 已知上下文复用现状

- **`inheritProjectContext: true`**（三个角色 markdown 都有）让 Pi 把
  AGENTS.md / ADR/0002 / `goal.md` / `architect.md` 作为 system prompt 基础
  一并加载。Issue #9 不重写这些文件，只在 `New-RoleContext` 的 start 路径
  中**显式声明一次**"AGENTS.md 已继承 + project_state.md 是 Lead 运维快照
  + ADR/0002 是 normative protocol"，让角色无需再 `read` AGENTS.md /
  ADR/0002 即可定位上下文来源。
- **`Resume` 路径显式声明 "do not reload or rediscover it"**——Issue #9 已经
  通过 `New-RoleContext` 的 resume 分支（`scripts/pi-team.ps1:461`）实现
  该复用边界。
- **持久化跨任务状态**：`AGENTS.md` 的 "Reusable-content hygiene" 一节
  禁止把 task ID / Issue 编号 / task-only artifact / worktree 路径写进
  `AGENTS.md` / 角色 prompt / 角色 skill；`Assert-Setup` 的 AGENTS.md 内容
  校验（`scripts/pi-team.ps1:127-128`）正是这条边界的执行点。
- **合同路径仍是 Lead-only 权威**：`Start-Task` / `Resume-Task` /
  `Accept` / `Close-Incomplete` / `Reconcile` / `Reclaim` /
  `Sync-Task` / `Read-State` / `Doctor` / `Status` 都通过
  `state.contract_path`（`<git-common-dir>/pi-team/v1/contracts/<TASK_ID>.md`）
  访问合同；合同快照不进入 dynamic prompt（Issue #1 已经把
  `assert.equal(record.args.some((arg) => arg.includes(contractSnapshot)),
  false, …)` 写入 `tests/team-contract.test.mjs`）。
- **与联网证据的边界**：来源 9（Claude Code 官方 subagents 文档）声明
  "Each subagent runs in its own context window with a custom system prompt,
  specific tool access, and independent history"。本仓库
  `inheritProjectContext: true` 让所有三个 role **共享** AGENTS.md /
  ADR/0002 / `goal.md` / `architect.md` 作为 system prompt 基础——这是
  显式选择的"上下文复用"模式，不同于 Claude Code 的"subagent 不继承
  coordinator 历史"模式。两者并不冲突：Pi Team 把"稳定的、跨角色共享的
  项目上下文"通过 `inheritProjectContext` 一并加载，把"每个角色的
  dynamic 上下文"通过 `New-RoleContext` 按 role 注入；这与来源 8（Hermes
  RFC #35575）"stable, repeating content comes first"原则一致——`AGENTS.md`
  始终在 system prompt 前部，dynamic 字段在尾部追加。

## 重复目录 / 环境探索的实测入口

Issue #9 范围内的"重复目录 / 环境探索"特指 **dynamic prompt 的导航提示行**
触发的角色侧再读文件：

- Issue #9 落地前，每个角色启动都会读到三行 "AGENTS.md" / "ADR/0002" /
  "project_state.md" 提示，并因此倾向于"先 `read` AGENTS.md 与
  ADR/0002 全文"——这是重复探索。落地后三处合并为一句"Stable project
  context: AGENTS.md (shared repository map) is inherited; … normative
  protocol is ADR/0002-…"，角色可直接信任这一句而无须再读文件。
- `Recommended role reads: .pi/skills/<role>/SKILL.md, …`（`scripts/pi-team.ps1:494`）
  仍是按需引导：角色仍需 `read` 自己 skill 的 SKILL.md 才能进入工作流；
  这是必须的（`--skill` 参数仅指向路径，skill 本身需要 Pi 在运行期 `read`），
  Issue #9 不消除这条——它是单次必要读，不是重复探索。
- 角色 markdown 的 `skillPath: ../skills` + `inheritProjectContext: true`
  让 skill 内容与 AGENTS.md 由 Pi 自动加载到 system prompt；dynamic prompt
  之外的额外 `read` 取决于角色自身工作流（Issue #9 不应规定其细节）。

## 最小安全优化边界（Issue #9 内允许的改动）

v2 时点 Issue #9 的允许改动集合**全部已落地**：

1. **收敛 `New-RoleContext` start 路径的三行导航**：把"Stable project
   context" / "Recommended common reads" / "Normative protocol: ADR/0002"
   合并为单句，由 `scripts/pi-team.ps1:483` 实现。
2. **收敛 `Research` 函数的 hand-built assignment**：删除 6 字段重述，
   改为 `$assignment = "$(New-RoleContext $contract 'researcher' 'research'
   $q) Lead assignment. Answer exactly this question: $q"`，由
   `scripts/pi-team.ps1:553` 实现。
3. **`Get-ToolRuntimeMetadata` 防御环**：5 字段必须存在，缺失即
   `Fail()`，由 `scripts/pi-team.ps1:446-448` 实现。
4. **Resume 路径保留"`AGENTS.md` 已存在"负向规则**：由
   `scripts/pi-team.ps1:461` 实现。
5. **`tests/team-contract.test.mjs` 3 条 ISSUE-018 测试**：由
   `tests/team-contract.test.mjs:902-1100` 实现。

不允许的改动集合：

- 不动 `Get-RoleCapabilities` / `RoleArguments` / `Assert-DelegationCapabilities`
  / `Assert-BlackboardTask` / `Assert-ReviewerReadyForAcceptance` /
  `Assert-NoLiveRoleProcesses` / `Parse-Contract` /
  `Assert-RelativeArtifactPath` / `Get-SetupIssues` /
  `Set-WebAccessAutoloadDisabled` / `Assert-Setup`。
- 不动 `Start-RoleProcess` / `Wait-RoleReady` / `Start-Process` 的
  PowerShell 数、process chain、busy-poll、超时——这些是 PERF-004 范畴。
- 不动 `AGENTS.md` / `goal.md` / `architect.md` / `project_state.md` /
  `ADR/0002-lead-subagent-collaboration-protocol.md` / `ADR/0003-stable-pi-team-entrypoint.md` /
  `README.md`——这些文件由 Lead 控制；Issue #9 不重写它们。
- 不动 `.pi/agents/<role>.md` / `.pi/skills/<role>/SKILL.md` /
  `.pi/communication/policy.mjs` / `.pi/communication/runtime-policy.mjs` /
  `.pi/communication/send.mjs` / `.pi/communication/extensions/*.ts` /
  `plugins/agent-blackboard/server/blackboard-core.mjs` /
  `plugins/agent-blackboard/server/blackboard-mcp.mjs` /
  `plugins/agent-blackboard/server/blackboard-cli.mjs`——这些由 Issue #1
  锁定为"role / runtime / blackboard 不动"的契约层。
- 不修改公开 CLI（`publish` / `validate` / `start` / `sync` / `research` /
  `status` / `watch` / `resume` / `accept` / `close-incomplete` /
  `reconcile` / `reclaim` / `cleanup` / `setup` / `codex-setup` / `doctor`）
  的参数与退出语义。
- 不放松 task/worktree/scope/role 绑定：每次 `start` 必须用 Lead 提供的
  `task_id` / `branch` / `worktree` / `scope_id`；每次 `research` 必须
  用 Lead 提供的 `task_id` + `question_id`；每个 delegation 必须有
  `artifact_path` 且 worktree 相对；agent ID 与 session ID 由
  `New-Id` 一次性生成。
- 不试图通过外部 prompt caching 来降低 Issue #9 范围内的重复——`AGENTS.md`
  / `goal.md` / `architect.md` 已经在 `inheritProjectContext: true` 中固定
  为 system prompt 前缀，**已经具备** cache 命中的前提条件（来源 1 / 8
  / 11）；但 cache 命中率取决于上游 LLM 行为，不在本仓库可测范围内。Issue #9
  的可测成本指标只度量 **prompt 字节数**，不度量 cache 命中。

## 正向验证场景（应通过的最小集合）

### P1. Start prompt 包含且仅包含 Issue #9 期望的字段

调用 `New-RoleContext $contract 'executor' 'start'` 后，输出需满足：

- 长度 < 1600 字节（`tests/team-contract.test.mjs:1015-1024`）；
- 包含 `Stable project context: AGENTS.md (shared repository map)` 与
  `normative protocol is ADR/0002-lead-subagent-collaboration-protocol.md`
  （`tests/team-contract.test.mjs:1028-1032`）；
- 不包含 `Recommended common reads:`（`tests/team-contract.test.mjs:1026`）；
- 不包含 `Normative protocol: ADR/0002` 单独行（`tests/team-contract.test.mjs:1027`）；
- 包含 `Role: executor`、`Delegation: EXECUTOR-...`、`Artifact: ...`、
  `Required capabilities: ...`、`Objective: ...`、`Done criteria: ...`、
  `Tool runtime metadata: os_family=`、`command_interpreter=`、
  `command_syntax_examples=`、`Builtin bash-tool contract: ...`、
  `Recommended role reads: ...`（`tests/team-contract.test.mjs:1034-1041`）；
- `executor` 与 `reviewer` 的 prompt 长度不等（permission/read 差异锁住）。

### P2. Resume prompt 显式不重新发现 AGENTS.md

调用 `New-RoleContext $contract 'executor' 'resume'` 后，输出需满足：

- 包含 `Context mode: resume`（`tests/team-contract.test.mjs:722`）；
- 包含 `Resume rule: preserve the existing task scope and session history;
  continue from the next uncompleted slice without rediscovering the whole
  repository.`（`tests/team-contract.test.mjs:723`）；
- 不包含 `Recommended common reads:`（`tests/team-contract.test.mjs:724`）；
- 不包含 `Recommended role reads:`（`tests/team-contract.test.mjs:725`）；
- `Tool runtime metadata` 仍存在（保证 runtime 校验不被绕开）。

### P3. Researcher 收敛后不重复 dynamic context 字段（R1 已落地）

调用 `Research` 函数（构造 `$assignment = "$(New-RoleContext ...) Lead
assignment. Answer exactly this question: $q"`）后，研究员 prompt 需满足：

- `New-RoleContext` 输出中 `Task ID` / `Worktree` / `Delegation:` /
  `Owned artifact:` / `Required capabilities:` / `Objective:` 各出现 1 次；
- `New-RoleContext` 输出**不**包含 `Lead assignment.`（R1 负向断言
  `tests/team-contract.test.mjs` 在 `ISSUE-018: New-RoleContext
  deduplicates redundant navigation hints ...` 块的末尾）；
- `Research question:` 出现一次（来自 `New-RoleContext` 的 research 分支）；
- `Lead assignment. Answer exactly this question: $q` 单独出现一次（来自
  `Research` 函数）；
- 不包含另一个角色的 delegation id（如果合同同时有 EXECUTOR-* /
  REVIEWER-* / RESEARCHER-* 三 delegation，研究员 prompt 仅含 RESEARCHER-*
  自身）；
- `Tool runtime metadata` 5 个字段全部存在；
- `Recommended role reads: .pi/skills/answer-research-question/SKILL.md,
  .pi/communication/policy.mjs, research/` 存在；
- researcher prompt 字节长度 < 1700（researcher 多 `Research question:`
  一行，预算略高）。

### P4. 跨合同 worktree 隔离

连续对 `ISSUE-018A`（worktree `D:/.../ISSUE-018-A`）和 `ISSUE-018B`
（worktree `D:/.../ISSUE-018-B`）调用 `New-RoleContext $contractA 'executor'
'start'` 与 `New-RoleContext $contractB 'executor' 'start'`，A 的 prompt
包含 `Worktree: D:/.../ISSUE-018-A` 且**不**包含 `D:/.../ISSUE-018-B`，B
的 prompt 反之（`tests/team-contract.test.mjs:1071-1100`）。

### P5. Get-ToolRuntimeMetadata 边界

- 正常情况下 5 字段齐全且 `command_interpreter=PowerShell Desktop <ver>`；
- 删除 `$PSVersionTable` / `$env:SHELL` / `$env:ComSpec` 后 5 字段仍齐全，
  `command_interpreter=unknown`（`tests/team-contract.test.mjs:902-934`）；
- 5 字段被 `; ` 分隔的数量恰好为 5（`tests/team-contract.test.mjs:937-972`）。

### P6. Task / worktree / scope / role / artifact 所有权校验保持

- `Parse-Contract` 拒：`task_id` 不匹配 `^[A-Z][A-Z0-9]*-[0-9]{3,}$`、
  `branch` 不匹配 `^pi-team/[A-Za-z0-9._/-]+$`、`worktree` 非绝对路径、
  `worktree` 是主 worktree 或 `<git-common-dir>` 子路径（`scripts/pi-team.ps1:153-194`）。
- `Assert-RelativeArtifactPath` 拒：artifact 为空、绝对路径、含 `..`
  （`scripts/pi-team.ps1:121-122`）。
- `Assert-BlackboardTask` 拒：Blackboard 任务不存在或 `status≠active`
  （`scripts/pi-team.ps1:368-376`）。
- `Get-RoleCapabilities` 拒未知角色（`scripts/pi-team.ps1:115-116`）。
- `Assert-DelegationCapabilities` 拒 delegation 的 required capability 不在
  角色允许集内（`scripts/pi-team.ps1:124-127`）。
- `Assert-ReviewerReadyForAcceptance` 拒 `accept` 时 reviewer Blackboard
  状态非 `ready_for_acceptance`（`scripts/pi-team.ps1:222-225`）。
- `Assert-NoLiveRoleProcesses` 拒 `resume` 时存在 live role 进程
  （`scripts/pi-team.ps1:309`）。
- `Get-SetupIssues` / `Assert-Setup` 拒 npm 包缺失/版本错/Web Access autoload
  未关闭 / AGENTS.md 不存在 / AGENTS.md 含 `<lead-pi-team-runbook>` /
  Issue 编号 / 大写 ID / 绝对路径 / 关键 extension 文件缺失
  （`scripts/pi-team.ps1:78-135`）。

### P7. 公共 CLI / 任务生命周期 / Blackboard / intercom 契约保持

- 公开 CLI 命令的参数、退出码、输出字段不变（`tests/run-tests.ps1` /
  `tests/team-contract.test.mjs` 第 60-200 行 capability isolation +
  `tests/communication-policy.test.mjs` + `tests/blackboard.test.mjs` 全套
  不动）；
- 任务生命周期五态（`active` / `accepted` / `incomplete` / `reclaimed` /
  `cleaned`）+ 三 outcome（`pending` / `accepted` / `incomplete`）不变；
- Blackboard MCP 工具集不变（`blackboard_*` 命名与权限面不变）；
- intercom `BOUNDED_PEERS` / `SUPERVISOR_REASONS` /
  `SAFE_INTERCOM_ACTIONS` 不变（`tests/communication-policy.test.mjs`
  全部保持现状）。

## 缺失环境信息时必须拒绝的负向场景

| 场景 | 检测点 | 当前行为 | Issue #9 范围内 |
| --- | --- | --- | --- |
| `$PSVersionTable` / `$env:SHELL` / `$env:ComSpec` 全部缺失 | `Get-ToolRuntimeMetadata` | 仍输出 5 字段；`command_interpreter=unknown`；不抛错 | 维持；已由 `tests/team-contract.test.mjs:902-934` 覆盖 |
| `Get-ToolRuntimeMetadata` 中 5 字段被吞 | `Get-ToolRuntimeMetadata` 末尾的 `foreach $field { if (-not $line.Contains($field)) { Fail ... } }`（行 446-448） | `Fail` 抛出 | 维持 |
| `os_family` / `os_version` / `os_architecture` 中任一为空 | 同上 `Fail` | `Fail` 抛出 | 维持 |
| `PI_TEAM_TASK_ID` / `PI_TEAM_ROLE` / `PI_TEAM_AGENT_ID` / `PI_TEAM_LAUNCH_ID` 任一缺失 | `.pi/communication/extensions/blackboard-update.ts` 调用 `registerRoleRuntime` 时该字段为 `undefined` | runtime JSON 不被登记，`Wait-RoleReady` 60 s timeout 后 `Start-Task` 抛"role startup did not register readiness"（`scripts/pi-team.ps1:301`） | 维持 |
| `parseContract` 的合同缺 `version/task_id/name/description/base_ref/branch/worktree/in_scope/out_of_scope/done_criteria/delegations/constraints` 任一字段 | `Parse-Contract` | `Fail 'contract missing field: <n>'`（`scripts/pi-team.ps1:157-159`） | 维持 |
| `done_criteria` 中某条缺 `id` 或 `description` 或 `artifacts` | `Parse-Contract` | `Fail 'each done criterion needs a stable C-### id'` 等（`scripts/pi-team.ps1:165-173`） | 维持 |
| `delegations` 中某条缺 `id` / `objective` / `artifact_path` / `required_capabilities` 或 capability 不在角色允许集 | `Parse-Contract` / `Assert-DelegationCapabilities` | `Fail 'delegation ... needs ...'` / `Fail 'requires capability ... unavailable'`（`scripts/pi-team.ps1:181-189`、`124-127`） | 维持 |
| `Research` 函数的 `QuestionFile` 不存在 | `Research` | `Fail 'question file not found'`（`scripts/pi-team.ps1:535`） | 维持 |
| `Research` 函数的 `QuestionId` 不在合同的 researcher delegation 中 | `Research` | `Fail 'unknown Researcher delegation: <id>'`（`scripts/pi-team.ps1:537-538`） | 维持 |
| Researcher 已存在 live runtime 时再调用 `research` | `Research` | `Fail 'a Researcher is already active for this task'`（`scripts/pi-team.ps1:533-534`） | 维持 |
| `Start-Task` 时 Blackboard 任务不存在或 `status≠active` | `Assert-BlackboardTask` | `Fail 'Lead must create Blackboard task ... before start'` / `Fail 'Blackboard task ... is not active'`（`scripts/pi-team.ps1:368-376`） | 维持 |
| `Accept` 时 reviewer Blackboard 状态非 `ready_for_acceptance` | `Assert-ReviewerReadyForAcceptance` | `Fail 'Reviewer is not ready_for_acceptance'`（`scripts/pi-team.ps1:222-225`） | 维持 |
| `Resume-Task` 时仍有 live role 进程 | `Assert-NoLiveRoleProcesses` | `Fail 'task already has live role process; refusing duplicate resume'`（`scripts/pi-team.ps1:309`） | 维持 |
| `start` 二次调用同一 task | `Start-Task` | `Fail 'task already started'`（`scripts/pi-team.ps1:522`） | 维持 |
| `accept` / `close-incomplete` / `reconcile` / `reclaim` / `cleanup` 在错误 outcome / execution_status 下调用 | 各函数 | `Fail 'task is not awaiting ...'` 等 | 维持 |
| `Sync-Task` 修改 `branch` 或 `worktree` | `Sync-Task` | `Fail 'immutable field changed: <n>'`（`scripts/pi-team.ps1:550`） | 维持 |
| `Cleanup` 时 worktree 不干净 | `Cleanup` | `Fail 'worktree is not clean'`（`scripts/pi-team.ps1:562`） | 维持 |
| AGENTS.md 含 `<lead-pi-team-runbook>` / Issue 编号 / 大写 ID / 绝对路径 | `Assert-Setup` | `Fail 'AGENTS.md must not contain ...'`（`scripts/pi-team.ps1:127-128`） | 维持 |
| Web Access autoload 未关闭 / npm 包版本错 | `Get-SetupIssues` | `Fail 'Pi shared dependencies are not ready: ...'`（`scripts/pi-team.ps1:91-92`） | 维持 |
| 任意 prompt 出现另一角色 delegation id | `New-RoleAssignment` / `New-RoleContext` 仅按 role 过滤 | prompt 不包含其他 delegation（`tests/team-contract.test.mjs:678-684`） | 维持 |
| 任意 prompt 包含合同快照路径字符串 | `New-RoleAssignment` 不再嵌入路径 | prompt 不含 `<git-common-dir>/pi-team/v1/contracts/<TASK_ID>.md`（`tests/team-contract.test.mjs:632`） | 维持 |
| `New-RoleContext` 输出携带 `Lead assignment.` 元语（R1 负向） | `Research` 函数以外的 prompt | `tests/team-contract.test.mjs` 在 ISSUE-018 测试块的 R1 负向断言 | 维持 |
| `Recommended common reads:` 出现在 start / resume prompt 中（v1 capture 时残留） | `New-RoleContext` start / resume 分支 | 不出现 | 已覆盖（`tests/team-contract.test.mjs:724, 1026`） |
| `Normative protocol: ADR/0002` 单独行出现在 start prompt 中（v1 capture 时残留） | `New-RoleContext` start 分支 | 不出现 | 已覆盖（`tests/team-contract.test.mjs:1027`） |
| `Research` 函数 assignment 中 6 个字段被二次声明（v1 capture 时残留） | `Research` 函数 `$assignment` | 每个字段仅 1 次 | 已覆盖（R1 落地 + `tests/team-contract.test.mjs` 新增负向断言） |

## 可测成本指标（Issue #9 范围内可加入诊断或测试）

按"诊断（启动期可读）/ 测试（确定性可断言）"两类列出。每条都映射到现有
文件可被现状直接读取的字段或字符串：

### M1. 启动 prompt 字节数（诊断 / 测试）

- **测量点**：`scripts/pi-team.ps1` 的 `New-RoleContext` 与
  `New-RoleAssignment` 返回字符串的 `.Length`；可用
  `Write-Output ('LEN=' + $ctx.Length)` 取值。
- **Issue #9 落地前**：单角色 start prompt 估计 ≥ 1500 bytes（含重复三行
  Recommended common reads + Normative protocol）。
- **Issue #9 落地后**：单角色 start prompt ≤ 1600 bytes；researcher
  ≤ 1700 bytes（多 Research question 一行）；`Stable project context:`
  单句承担三句功能。
- **测试断言**：`tests/team-contract.test.mjs:1015-1024` 已存在
  `assert.ok(len < 1600, '${role} prompt must stay under 1600 bytes
  (cost budget); got ${len}')`。
- **诊断建议**：在 `tests/run-tests.ps1` 输出每个 role prompt 的字节数，
  让 Lead 在 lead-synthesis 中看到对比。

### M2. `New-RoleContext` 中 AGENTS.md / ADR/0002 出现次数（测试）

- **测量点**：`tests/team-contract.test.mjs` 的
  `assert.match(ctxLine, /Stable project context: AGENTS\.md \(shared
  repository map\)/)` + `assert.match(ctxLine, /normative protocol is
  ADR\/0002-lead-subagent-collaboration-protocol\.md/)` 各仅 1 处；不存在
  `Recommended common reads:` 与独立 `Normative protocol: ADR/0002` 行。
- **断言已存在**：`tests/team-contract.test.mjs:1026-1032`。

### M3. `Research` 函数 assignment 中 6 个重复字段的计数（诊断 / 测试）

- **测量点**：`scripts/pi-team.ps1:553` 的 `$assignment` 字符串里
  `Task ID`、`Worktree`、`Delegation:` / `Research delegation:`、
  `Artifact:` / `Research artifact:`、`Required capabilities:`、
  `Objective:` 的出现次数。
- **Issue #9 落地前**：每个字段出现 2 次（一次在 `New-RoleContext`，一次
  在 `Lead assignment.`）。
- **Issue #9 落地后**：每个字段仅 1 次（v2 时点确认）。
- **测试已存在**：`tests/team-contract.test.mjs` 的 R1 负向断言
  `assert.equal(rCtxLine.includes("Lead assignment."), false, ...)` 与
  ISSUER-018 test block 的多处字段断言。

### M4. `Get-ToolRuntimeMetadata` 5 字段存在性（测试，已覆盖）

- **测量点**：`scripts/pi-team.ps1:446-448` 的 `foreach $field { if
  (-not $line.Contains($field)) { Fail ... } }`。
- **测试已存在**：`tests/team-contract.test.mjs:902-972` 三处
  `ISSUE-018:` 测试。

### M5. `Recommended common reads:` 行出现次数（测试，已覆盖）

- **测量点**：每个角色 start prompt 不应包含该字符串。
- **测试已存在**：`tests/team-contract.test.mjs:1026`（start）、
  `tests/team-contract.test.mjs:724`（resume）。

### M6. `Recommended role reads:` 行出现次数（测试，已覆盖）

- **测量点**：每个角色 start prompt 必须包含 1 条；resume prompt 不应包含
  任何 `Recommended role reads:` / `Recommended common reads:` 行（因为
  这些导航只在新会话第一轮需要）。
- **测试已存在**：`tests/team-contract.test.mjs:646`
  (`Recommended role reads: `) 与 `tests/team-contract.test.mjs:724-725`
  (resume 不应含 `Recommended role reads:`)。

### M7. 环境变量注入字段数（诊断）

- **测量点**：`Start-RoleProcess` 的 `$identity.Keys.Count` = 8
  （`PI_TEAM_TASK_ID` / `PI_TEAM_ROLE` / `PI_TEAM_AGENT_ID` /
  `PI_TEAM_WORKTREE` / `PI_TEAM_STATE_ROOT` / `PI_TEAM_SCOPE_ID` /
  `PI_TEAM_LAUNCH_ID` + `PI_INTERCOM_STABLE_ID`）。
- **Issue #9 不应改**：注入字段数属于 PERF-004 范畴（详见
  `research/PERF-004-static-survey.md` 第二节 "Mechanism 5"）。

### M8. PowerShell 进程数（属于 PERF-004，不在 Issue #9）

- **测量点**：每个 role 启动的 PowerShell 进程数（outer + inner +
  `Set-Item Env:` roundtrip）。Issue #9 仅围绕 prompt 注入，不动进程链。

### M9. `<task>-<role>.jsonl` 写入耗时（属于 PERF-004，不在 Issue #9）

- **测量点**：`scripts/pi-team.ps1:228-234` 的 `Event` 函数内
  `Get-Content | Measure-Object` 与 `Add-Content`。Issue #9 不动。

### M10. 跨合同 worktree 路径残留（测试，已覆盖）

- **测量点**：连续调用 `New-RoleContext` 两个不同 worktree 的合同，A 的
  prompt 不含 B 的 worktree，反之亦然。
- **测试已存在**：`tests/team-contract.test.mjs:1071-1100`。

### M11. 角色 markdown / skill / 工具集隔离（测试，已覆盖）

- **测量点**：`Get-RoleCapabilities` 返回的 capability 集合 + `RoleArguments`
  的 `--tools` 列表 + `.pi/agents/<role>.md` 的 `tools:` 前沿三者一致。
- **测试已存在**：`tests/team-contract.test.mjs` capability isolation 系列。

### M12. 上游 LLM prompt cache 命中（**不可测**，仅作方向参考）

- **测量点**：Anthropic / OpenAI 在 `cache_control` 断点上返回的
  `cache_read_input_tokens` / `cache_creation_input_tokens` 计数。
- **不在本仓库可测**：上游行为，依赖 LLM provider，不在
  `tests/run-tests.ps1` / `tests/team-contract.test.mjs` 的覆盖范围。
- **方向参考**：来源 1（Anthropic 官方）声明 cache hit 要求 100% byte-match；
  来源 11（Iron Mind 生产案例）报告 80-95% 复用率下节省 ~88% 输入成本；
  本仓库的 `inheritProjectContext: true` 已经把稳定上下文前置到 system
  prompt 前部，**具备** cache 命中的前提；但**不可**用 cache 命中数据
  替代 M1 / M2 / M3 作为 Issue #9 的成本证据——后者是确定性的、本地
  可重现的字节度量，前者是上游运行时统计。

## 联网证据与适用边界

> **可获取性声明**：v2 capture 时，本 Researcher 的 `fetch_content` /
> `source_check` 在 attempt 内被 SSRF / TUN guard 拦截（`Blocked internal
> address for <host>: 198.18.0.X/15`），无法取得完整页面正文；以下条目
> 来自 `web_search` 提供者综合的搜索结果片段（summary），
> 并标注其与本仓库的适用边界。Lead 任务原文 "联网内容只用于研究参考，
> 不得替代本地代码、合同和测试证据" 在本研究中遵守：所有具体可测指标
> （M1 / M2 / M3 / M4 / M5 / M6 / M10 / M11）均来自本仓库源码与测试。

### 来源 1 — Prompt caching — Claude Platform Docs

- **URL**：https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- **类型**：官方文档
- **关键结论**：
  - "Cache hits require 100% identical prompt segments, including all text
    and images up to and including the block marked with cache control."
  - 缓存 TTL 默认 5 分钟，可选 1 小时。
  - Cached input tokens 成本为 base 的 10%（90% discount）；5-min TTL
    写成本 1.25×；1-h TTL 写成本 2×。
- **适用边界**：本仓库 Issue #9 不直接接入 Anthropic API；`AGENTS.md` /
  `goal.md` / `architect.md` 通过 `inheritProjectContext: true` 已被
  加载为 system prompt 前缀，理论上可命中 cache，但**不能**用 cache 命中
  数据替代 M1（prompt 字节数）作为 Issue #9 的成本证据。

### 来源 2 — Prompt caching with Anthropic API: complete guide | Cadence blog

- **URL**：https://cadence.withremote.ai/blog/prompt-caching-anthropic
- **类型**：第三方博客
- **关键结论**：
  - 缓存机制是 literal byte-match on the prefix（不是 semantic similarity）。
  - 5-min TTL 写成本 1.25×；1-h TTL 写成本 2×；读成本 10%。
- **适用边界**：与来源 1 一致；强调 prefix byte-match 与本仓库 R1 收敛
  行为（删除 dynamic 字段重述、保留稳定前缀）方向一致——减少 dynamic
  字段的重复声明能让 `Lead assignment. Answer exactly this question: $q`
  之外的部分保持 byte-stable，提高跨 researcher 调用间共享前缀的可能性。

### 来源 3 — What Breaks Prompt Caching: The Stable Prefix Contract | Mnemoverse Docs

- **URL**：https://mnemoverse.com/docs/library/prompt-cache-stable-prefix
- **类型**：第三方文档
- **关键结论**：
  - Anthropic 缓存前缀顺序：`tools` → `system` → `messages`；
    "Changes at each level invalidate that level and all below it."
  - 跨厂商评测：缓存可削减 41-80% API 成本；LangChain 报告其 agent
    运行下 49-80% 节省。
- **适用边界**：本仓库的 `--tools <role-allowlist>` 与
  `--append-system-prompt <role-md>` 在 CLI 顺序上把 `tools` 与 `system`
  段前置，等价于"stable prefix comes first"模式；不需要 Issue #9 内
  做 prefix 重组。

### 来源 4 — Prompt caching deep dive: Anthropic, OpenAI, Gemini (with math)

- **URL**：https://tokenpricing.dev/prompt-caching/
- **类型**：第三方技术博客
- **关键结论**：
  - Cache write (5-min TTL) 1.25× base；
  - Cache write (1-h TTL) 2× base；
  - Cache read 0.1× base（90% 折扣）。
- **适用边界**：成本数学与来源 1 / 2 一致；本仓库不在 Issue #9 范围
  涉及 cache 接入，仅作背景。

### 来源 5 — Anthropic prompt caching, explained | Prism / Ssimplifi blog

- **URL**：https://ssimplifi.com/blog/anthropic-prompt-caching-explained
- **类型**：第三方博客
- **关键结论**：cache 机制是 LLM 端最高 ROI 的成本技术之一；
  关键在于正确布置 `cache_control` 断点与识别 stable prefix。
- **适用边界**：与来源 1-4 一致；本仓库不做 `cache_control` 注入。

### 来源 6 — Prompt Caching — OpenAI API Docs

- **URL**：https://developers.openai.com/api/docs/guides/prompt-caching
- **类型**：官方文档
- **关键结论**：
  - "Model prompts often contain repetitive content, like system prompts
    and common instructions." 自动 cache 启用；exact prefix match。
- **适用边界**：与来源 1 同样要求 prefix byte-match；本仓库当前
  默认 provider 是 `minimax-cn`（来源 14），cache 行为不在本调研范围。

### 来源 7 — Your multi-agent system isn't hitting prompt cache. Your system prompt is the reason. | DEV Community

- **URL**：https://dev.to/rickeshtn/your-multi-agent-system-isnt-hitting-prompt-cache-your-system-prompt-is-the-reason-4gb2
- **类型**：第三方技术博客
- **关键结论**：
  - Hosted inference providers cache on a prefix。"The moment the token
    stream diverges, caching stops for the rest of the request. There is
    no re-syncing later."
  - 系统提示中插入可变片段（user context / memory / task-specific
    instructions）会破坏 cache。
- **适用边界**：直接对应本仓库 Issue #9 R1 的修复动机——R1 收敛前
  `Research` 函数把 Task ID / Worktree / Delegation 等 dynamic 字段重复
  拼到 `Lead assignment.` 一句；这会让 dynamic 字段出现两次，且
  `Lead assignment.` 元语与 dynamic context 的位置交错，**会**让
  system prompt 在 dynamic 段内出现两份相同字段。R1 收敛后 dynamic
  字段仅在 `New-RoleContext` 中出现一次，与 stable prefix 的 byte-match
  假设吻合。

### 来源 8 — [RFC] Reorder system prompt for shared prefix caching | NousResearch hermes-agent #35575

- **URL**：https://github.com/NousResearch/hermes-agent/issues/35575
- **类型**：开源 RFC
- **关键结论**：
  - "The current system prompt order places variable content (user's
    project context, memory, task-specific instructions) before stable
    content (tool definitions, behavior rules). This means the prefix cache
    is invalidated on every turn."
  - 主张 "stable, repeating content comes first"：
    1. Tool definitions / behavior rules（stable across turns）
    2. Task/project context（changes per turn）
- **适用边界**：本仓库 `inheritProjectContext: true` 让 AGENTS.md 等
  稳定上下文先于 dynamic 段被加载；R1 收敛后 dynamic 段不再重复声明
  字段——本仓库的 prompt 装配已**符合**这条原则。

### 来源 9 — Subagents in the SDK — Claude Code Docs

- **URL**：https://code.claude.com/docs/en/agent-sdk/subagents
- **类型**：官方文档
- **关键结论**：
  - "Subagents are separate agent instances that your main agent can
    spawn to handle focused subtasks."
  - "Each subagent runs in its own context window with a custom system
    prompt, specific tool access, and independent history."
  - "Use them to isolate context, run multiple analyses in parallel, and
    apply specialized instructions without adding to the main agent's
    prompt."
- **适用边界**：本仓库 Researcher / Executor / Reviewer 是三个 persistent
  会话（不是按需 spawn 的 subagent），但**核心原则一致**——每个角色
  有独立 context window、独立 tool 集合、独立 system prompt。本仓库
  通过 `Get-RoleCapabilities` + `RoleArguments` 把这套隔离做在
  launcher 层，等价于 Claude Code subagent 的 `--tools` / system-prompt
  隔离。

### 来源 10 — Subagent Context Isolation Explained | AI Skill Certs

- **URL**：https://aiskillcerts.com/concepts/agentic-architecture/subagent-context-isolation
- **类型**：第三方教学
- **关键结论**：
  - "Subagent context isolation is the principle that a subagent runs
    in its own fresh context window: it does not automatically inherit
    the coordinator's conversation history and does not retain memory
    between invocations."
  - "Every piece of information a subagent needs must be included
    explicitly in the prompt that invokes it."
- **适用边界**：与本仓库 R1 收敛方向一致——Researcher 启动 prompt
  必须显式携带 task context，不依赖任何跨调用缓存；v1 capture 时 R1
  的 hand-built 重复声明正是这条原则的局部违反（同样的字段被声明两次
  说明 prompt 装配假设了某种"隐含"上下文）。R1 收敛后 dynamic context
  全部来自 `New-RoleContext`，与"explicit prompt injection only"原则
  一致。

### 来源 11 — Prompt Caching: How We Cut Claude API Costs by 90% in Production | Iron Mind

- **URL**：https://iron-mind.ai/blog/prompt-caching-claude-production
- **类型**：生产案例博客
- **关键结论**：
  - "In production agentic workloads where 80-95% of the prompt is reused
    turn over turn, this typically cuts total input costs by ~88%."
  - 关键在于：cacheable content first；正确放置 cache breakpoints；
    满足最小 token 阈值；选对 TTL。
- **适用边界**：与来源 1-5 一致；本仓库 Issue #9 不动 cache 接入。
  此来源仅作"Issue #9 优化方向与上游 cache 优化方向同向"的背景参考。

### 来源 12 — Prompt Caching in Practice: From 7% to 74% Hit Rate | DigitalOcean

- **URL**：https://www.digitalocean.com/community/conceptual-articles/prompt-caching-in-practice-hit-rate
- **类型**：生产案例博客
- **关键结论**：
  - ProjectDiscovery 安全情报 agent：系统提示 + 工具定义 + 分析框架
    共 4000 token；cache 命中率仅 7%。
  - 单一结构修改（移动一个动态标识符）后命中率显著上升。
- **适用边界**：与本仓库 R1 修复同向——R1 收敛前 researcher prompt
  在 `New-RoleContext` 之外还有一份手写 dynamic 字段声明；这意味着
  在 researcher 这一角色上，`Task ID` / `Worktree` 等字段出现两次，
  但其中一次拼到了 `Lead assignment.` 句中，破坏了 system prompt 段
  的 byte-match prefix（system 段在 `New-RoleContext` 末尾，message
  段在 `Lead assignment.` 末尾）。R1 收敛后 researcher prompt 的
  system 段与 message 段均 byte-stable。

### 来源 13 — Bounded research agent skill pattern

- **URL**：https://agentpatterns.ai/context-engineering/dynamic-system-prompt-composition/ 与
  https://hermes-agent.nousresearch.com/docs/user-guide/features/context-files
- **类型**：第三方文档
- **关键结论**：
  - "Answer a bounded question with current cited evidence. Triggers:
    research, investigate this question, find evidence." — bounded
    research skill 的标准触发与边界。
- **适用边界**：本仓库 `.pi/skills/answer-research-question/SKILL.md`
  与 `.pi/agents/researcher.md` 的 "answer one bounded question,
  write only the assigned research artifact, and return to waiting"
  与该模式同向。

### 来源 14 — Provider & model pinned to minimax-cn / MiniMax-M3

- **URL**：`.pi/settings.json`（本仓库本地）
- **类型**：本地配置
- **关键结论**：默认 provider = `minimax-cn`；默认 model = `MiniMax-M3`。
- **适用边界**：上游 LLM 不是 Anthropic / OpenAI；cache 行为不在本调研
  范围。M1（prompt 字节数）仍是确定性可测的成本指标。

### 联网证据对本仓库的总体适用边界

1. **方向一致性**：来源 7 / 8 / 12 主张"减少 dynamic 字段重述 /
   把 stable prefix 前置"与本仓库 R1 收敛方向一致；本仓库已**结构性**
   满足这些主张（`inheritProjectContext` + R1 收敛）。
2. **不可测的成本项**：来源 1 / 2 / 4 / 5 / 6 / 11 / 12 给出的 cache 命中
   率与节省百分比来自上游 LLM 运行时，**不可**由本仓库
   `tests/run-tests.ps1` / `tests/team-contract.test.mjs` 测量；M1
   （prompt 字节数）是本仓库唯一确定性的可测成本指标。
3. **不需要的改造**：来源 8 主张"reorder system prompt for shared
   prefix caching"——本仓库已通过 `inheritProjectContext: true` 与
   `RoleArguments` 的 `--tools` / `--append-system-prompt` 顺序实现
   stable prefix 前置，不需要 reorder。
4. **不需要的接入**：来源 1-5 / 11 涉及的 `cache_control` 注入与 cache
   breakpoint 设计不在本仓库 launcher 控制范围；Issue #9 不接入
   cache。

## 与已存在的研究 / 实现的对齐

- **PERF-004 静态调查**（`research/PERF-004-static-survey.md`）：列出了 6 个
  资源浪费机制（多进程 fan-out、busy-poll、jsonl 全量重读、watch 重读、
  gzip+base64 往返、`taskkill /T /F` 强杀）。Issue #9 不触及这些机制；其
  第 2 / 第 5 项被 Issue #9 排除在范围外。本调研只是把它们列为"Issue #9
  不动"清单的参考。
- **PERF-005 task**（`plans/PERF-005-task.md`）：基于 PERF-004 实现三个边界
  清晰的优化（Wait-RoleReady 就绪等待 / Start-RoleProcess bootstrap 参数
  传递 / 事件日志序号追加），与 Issue #9 **正交**——前者动 runtime 实现，
  后者动 prompt 注入；可同时进行。
- **ISSUE-001 已落地的改动**：去掉了 `Start-Task` 中"全部 `done_criteria`
  + 全部 `delegations` + 合同 `Constraints` + 合同快照路径"的注入；
  Issue #9 复用其 `New-RoleAssignment` / `New-RoleContext` 模板但不动 Issue #1
  已锁定的边界。Issue #1 的负向断言（`Frozen task contract:` /
  `Read that exact contract before acting` / `\bConstraints: /` /
  `[owner=/` / 跨角色 delegation id）必须继续通过；Issue #9 的新负向
  断言（`Recommended common reads:` / `Normative protocol: ADR/0002` /
  `Lead assignment.` 不在 `New-RoleContext` 中）必须与 Issue #1 的负向
  断言并存。
- **ISSUE-011**：处理 intercom envelope / stale session 恢复；与 Issue #9
  无 prompt 文本交互，runtime-policy 测试不变。
- **ISSUE-002**：处理空 terminal 路径 / fake-pi 替身 / 进程清理；与 Issue #9
  无 prompt 文本交互，runtime 路径不变。
- **ISSUE-003**：bounded-research protocol；Issue #9 不动 researcher role
  markdown 与 answer-research-question skill。

## 来源路径（实测定位）

- `scripts/pi-team.ps1:108-118` `Get-RoleCapabilities`
- `scripts/pi-team.ps1:121-122` `Assert-RelativeArtifactPath`
- `scripts/pi-team.ps1:124-127` `Assert-DelegationCapabilities`
- `scripts/pi-team.ps1:153-194` `Parse-Contract`
- `scripts/pi-team.ps1:222-225` `Assert-ReviewerReadyForAcceptance`
- `scripts/pi-team.ps1:228-234` `Event`
- `scripts/pi-team.ps1:298-301` `Wait-RoleReady`
- `scripts/pi-team.ps1:309` `Assert-NoLiveRoleProcesses`
- `scripts/pi-team.ps1:310-348` `Start-RoleProcess`
- `scripts/pi-team.ps1:322-339` `RoleArguments`
- `scripts/pi-team.ps1:368-376` `Assert-BlackboardTask`
- `scripts/pi-team.ps1:368-552` `Start-Task` / `Research` / `Resume-Task` /
  `Accept` / `Close-Incomplete` / `Reconcile` / `Reclaim` / `Cleanup`
- `scripts/pi-team.ps1:401-404` `Write-RolePrompt`
- `scripts/pi-team.ps1:406-431` `Launch-Role` / `New-RoleAssignment`
- `scripts/pi-team.ps1:423-451` `Get-ToolRuntimeMetadata`
- `scripts/pi-team.ps1:451-512` `New-RoleContext`（含 Issue #9 注释行 481-487
  与 start / resume / role-switch 三分支）
- `scripts/pi-team.ps1:531-553` `Research` 函数（R1 落地后行 553 含
  `$assignment = "$(New-RoleContext $contract 'researcher' 'research' $q)
  Lead assignment. Answer exactly this question: $q"`，注释 546-551 记录
  收敛理由）
- `.pi/agents/{researcher,executor,reviewer}.md`
- `.pi/skills/answer-research-question/SKILL.md`（仅 read 用）
- `.pi/communication/extensions/{researcher,executor,reviewer,blackboard-update}.ts`
- `.pi/communication/{policy,runtime-policy,send}.mjs`
- `plugins/agent-blackboard/server/{blackboard-core,blackboard-mcp,blackboard-cli}.mjs`
- `tests/team-contract.test.mjs:285-340` `role launchers inject common-dir
  identity …`（Issue #1 的 prompt 边界锁）
- `tests/team-contract.test.mjs:600-790` Issue #1 的 prompt 字段正/负向断言
- `tests/team-contract.test.mjs:902-1100` ISSUE-018 系列测试（3 条）
- `tests/team-contract.test.mjs:722-725` resume prompt 的 Recommended
  common reads / role reads 负向断言
- `tests/team-contract.test.mjs:1046-1100` 跨合同 worktree 隔离测试
- `tests/communication-policy.test.mjs`、`tests/blackboard.test.mjs` 不动
- `tests/run-tests.ps1` 不动
- `research/PERF-004-static-survey.md`（Issue #9 排除范围参考）
- `research/ISSUE-001-prompt-boundaries.md`（Issue #1 已落地的边界）
- `research/ISSUE-011-intercom-envelope-recovery.md`（runtime-policy 边界）
- `research/ISSUE-002-empty-terminal-paths.md`（fake-pi / 进程清理边界）
- `research/ISSUE-003-bounded-research-protocol.md`（researcher role 边界）
- `implementation_notes/ISSUE-018.md`（Executor 实现记录，含 R1 收敛 diff）
- `reports/ISSUE-018-verification.md`（Executor 验证记录，含 3 条 ISSUE-018
  测试通过记录 + 1 条 pre-existing 失败）
- `ADR/0002-lead-subagent-collaboration-protocol.md`（normative 协议）
- `ADR/0003-stable-pi-team-entrypoint.md`（launcher 入口契约）
- `AGENTS.md`（共享 agent context，Issue #9 不修改）
- `README.md`（公开文档，Issue #9 不修改）

## 信心与剩余缺口

- **信心：高**。Issue #9 已落地的去重边界由
  `tests/team-contract.test.mjs:902-1100` 的 3 条 ISSUE-018 测试锁定；
  权限 / 边界校验的"不动"清单由 `scripts/pi-team.ps1` 的现有 11 个校验函数
  与 `tests/team-contract.test.mjs` capability isolation / role launchers /
  contract validation 系列测试覆盖；可测成本指标 M1-M2 / M4-M6 / M10-M11
  已有现成测试；R1 收敛已落地并由 `tests/team-contract.test.mjs` 新增
  负向断言锁定。
- **剩余缺口（不影响 Issue #9 最小改动）**：
  1. **Lead 元语（`Lead assignment.`）与 dynamic context 字段重述的边界**
     不属于 Issue #9；Issue #1 的 S1 方案已锁定"保留"——若未来 Lead 决定
     在另一 Issue 里把 `Lead assignment.` 拼接也从 `New-RoleAssignment`
     移到 `Start-Task` 中显式进行，应同步更新 Issue #1 的负向断言。
  2. **`Start-Task` 中 executor / reviewer prompt 总字节数对 Lead 的可见性**
     仍是诊断层面（`tests/run-tests.ps1` 未在输出中打印每角色 prompt
     字节数）。Lead 在 Issue #9 落地后可在 `tests/run-tests.ps1` 增加
     `Write-Output "PROMPT_LEN executor=$len_executor reviewer=$len_reviewer"`
     行（属于测试侧增强，不动 `scripts/pi-team.ps1`），作为 lead-synthesis
     的诊断证据。
  3. **跨合同 worktree 隔离测试覆盖的是 executor**，未覆盖 reviewer 与
     researcher；当前 `tests/team-contract.test.mjs:1046-1100` 只测 executor。
     扩展到 reviewer / researcher 的"两条合同的各自角色 prompt 互不泄露"
     测试是建议的补强，不是 Issue #9 必须。
  4. **联网原文不可获取**：v2 capture 时 Researcher 的 `fetch_content`
     被 SSRF / TUN guard 拦截，所有外部页面仅以 search-result 摘要形式
     落地。Lead / Executor / Reviewer 在审查本 artifact 时如需对某条
     联网结论复核，建议直接访问对应 URL；本调研已把每条来源 URL 与
     关键结论一并列出。
  5. **上游 LLM cache 命中不可测**：M12 已显式声明不在本仓库可测范围；
     M1-M3 是确定性本地度量，是 Issue #9 的可执行成本证据。

## 不变量（变更前后必须保持）

- 公开 CLI：`publish` / `validate` / `start` / `sync` / `research` /
  `status` / `watch` / `resume` / `accept` / `close-incomplete` /
  `reconcile` / `reclaim` / `cleanup` / `setup` / `codex-setup` /
  `doctor` 的参数与退出语义不变。
- 任务生命周期：`active` / `accepted` / `incomplete` / `reclaimed` /
  `cleaned` 五种 `execution_status`；`pending` / `accepted` /
  `incomplete` 三种 `outcome`；`Sync-Task` 仍要求 `branch` 与 `worktree`
  不可变；`Cleanup` 仍要求 worktree 干净、不可删除主 worktree 或分支。
- Blackboard：`Assert-BlackboardTask` 仍要求任务存在且 `status=active`；
  `Assert-ReviewerReadyForAcceptance` 仍要求 reviewer 状态为
  `ready_for_acceptance`；`Invoke-BlackboardLifecycle` 仍按 action 调用
  Blackboard CLI；Blackboard MCP 工具集不变。
- intercom：`BOUNDED_PEERS` 拓扑（`executor ↔ researcher`、`executor
  ↔ reviewer`、`researcher ↔ reviewer` 双向禁止）、`SUPERVISOR_REASONS`
  （`need_decision` / `progress_update` / `interview_request` 三选一）、
  `SAFE_INTERCOM_ACTIONS`（`list` / `list-cwd` / `status` / `pending`）
  不变。
- 角色能力隔离：`Get-RoleCapabilities` 表（researcher / executor / reviewer
  三组工具清单）、`RoleArguments` 中 `--no-extensions` / `--no-skills` /
  `--tools` / `--skill` / `--append-system-prompt` / `--extension` 五组开关
  及 Researcher 多挂 `pi-web-access` 的事实不变。
- Issue #1 已落地的负向断言（`Frozen task contract:` /
  `Read that exact contract before acting` / `\bConstraints: /` /
  `[owner=/` / 跨角色 delegation id）继续通过；state.contract_path 仍是
  Lead-only 权威指针。
- Issue #9 已落地的负向断言（`Recommended common reads:` 在 start /
  resume 中均不出现；`Normative protocol: ADR/0002` 不作为独立行出现；
  `New-RoleContext` 输出不包含 `Lead assignment.` 元语；6 字段各仅 1 次
  出现在 researcher prompt）继续通过。
- 启动进程链（`wt.exe` → `powershell.exe` → `powershell.exe` →
  `pi.cmd` → `node.exe` + 扩展 / MCP 子进程）与 `Wait-RoleReady` 的
  100 ms busy-poll / 60 s timeout 不变（属于 PERF-005 范围）。
- `tests/communication-policy.test.mjs`、`tests/blackboard.test.mjs`、
  `tests/run-tests.ps1`、`README.md`、`AGENTS.md`、`ADR/0002`、
  `ADR/0003`、`architect.md`、`goal.md`、`project_state.md` 不动。
- Issue #9 不接入 Anthropic / OpenAI prompt cache（来源 1-5 / 11-12）；
  本仓库的 `inheritProjectContext: true` + `RoleArguments` 的
  `--append-system-prompt` 顺序已结构性地满足"stable prefix 前置"
  （来源 3 / 8），cache 命中率的提升**不**作为 Issue #9 的成本证据，
  M1（prompt 字节数）是 Issue #9 唯一确定性的成本指标。

## Issue #9 在本 worktree 中的处置（v2 时点全部落地）

v2 时点 Issue #9 的所有可测改动已落地：

1. `New-RoleContext` start 路径合并 `Stable project context` /
   `Recommended common reads` / `Normative protocol: ADR/0002` 为单句
   （`scripts/pi-team.ps1:483`）；
2. `Recommended common reads:` 行从 start 路径删除；
3. `Normative protocol: ADR/0002-...` 独立行删除；
4. `Research` 函数 6 字段重述收敛为
   `$assignment = "$(New-RoleContext $contract 'researcher' 'research' $q)
   Lead assignment. Answer exactly this question: $q"`（`scripts/pi-team.ps1:553`）；
5. Resume 路径保留"`AGENTS.md` 已存在"负向规则（行 461）；
6. `Get-ToolRuntimeMetadata` 5 字段强制存在 + `command_interpreter=unknown`
   退化（行 446-448）；
7. `tests/team-contract.test.mjs` 新增 3 条 ISSUE-018 测试覆盖以上变更
   （行 902-1100），其中 R1 负向断言
   `assert.equal(rCtxLine.includes("Lead assignment."), false, ...)` 锁住
   "dynamic context 不再携带 Lead 元语"。

后续 Executor 与 Reviewer 可按本文档的 § "正向验证场景" 与
"可测成本指标" 复核 `implementation_notes/ISSUE-018.md` 与
`reports/ISSUE-018-verification.md` 中记录的 Executor 端执行结果，
并在 `tests/team-contract.test.mjs` 中选择是否补强 reviewer / researcher
的跨合同 worktree 隔离测试（参见剩余缺口 3）。
