# ISSUE-001 — Start-Task assignment 边界研究

## 问题（一句话）

`scripts/pi-team.ps1` 的 `Start-Task` 与 `Research` 当前如何在 Executor/Reviewer/Researcher 的启动 assignment 里注入完整 constraints，如何在不动 CLI、生命周期、Blackboard、intercom 与角色能力隔离的前提下把它们拆成 Lead-only（治理）和 role-critical（安全/报告/peer）两类。

## 结论摘要

`Start-Task`（`scripts/pi-team.ps1:383-384`）目前为 Executor 和 Reviewer 构造同一段 `$assignment`，把合同里**全部** `done_criteria`、`delegations`、`constraints` 都拼成单行字符串再前缀 `"You are Executor/Reviewer..."` 一并注入；Researcher 的 assignment（`scripts/pi-team.ps1:402`）则已经只携带本委托的 `id` / `artifact_path` / `required_capabilities` / `objective` / 问题文本，没有 `constraints` 与跨角色委托，是当前架构中唯一具备"角色边界"的实现。最小改动是把 Executor/Reviewer 的 assignment 与 Researcher 对齐：保留自身 objective、本角色 done criteria、本角色 delegation；剔除 Lead-only 的分支准备/验收/回收/清理/Issue 规则与跨角色委托清单，并把"Read the frozen contract before acting"这一类合同自寻址语改为单凭 task ID 即可定位的指针。无需改 CLI、生命周期、Blackboard、intercom、能力清单、合同 schema 或角色 markdown 文件正文。

## 当前 Start-Task 注入完整 constraints 的机制

### 1. `Start-Task` 构造合同快照与 state

`scripts/pi-team.ps1:375-379`：

```
$contractSnapshot = Snapshot-Contract $Path $c.task_id
$state = [pscustomobject]@{version=2;task_id=$c.task_id;...;contract_path=$contractSnapshot;...}
Write-State $state; foreach ($r in @('executor','reviewer')) { Event $state $r 'working' 'task started' '' '' }
```

合同被 `Snapshot-Contract` 拷贝到 `<git-common-dir>/pi-team/v1/contracts/<TASK_ID>.md`，状态写入 `<git-common-dir>/pi-team/v1/<TASK_ID>.json`，并各自追加一条 `working/task started` 事件。这层是 Lead-only 状态，**不进入角色上下文**——只有 `$contractSnapshot` 路径在 assignment 里被提及。

### 2. `Start-Task` 构造共享 assignment（脚本里完全相同的一段）

`scripts/pi-team.ps1:381-383`：

```
$criteria = @($c.done_criteria | ForEach-Object {
   "$($_.id): $($_.description) [owner=$($_.owner); artifacts=$($_.artifacts -join ',')]"
}) -join '; '
$delegations = @($c.delegations | ForEach-Object {
   "$($_.id): $($_.role) -> $($_.artifact_path) [capabilities=$($_.required_capabilities -join ',')]"
}) -join '; '
$assignment = "Lead assignment. Task ID: $($c.task_id). Worktree: $($c.worktree). " +
              "Frozen task contract: $contractSnapshot. Read that exact contract before acting. " +
              "Objective: $($c.description) " +
              "Done criteria: $criteria. " +
              "Role delegations: $delegations. " +
              "Constraints: $($c.constraints -join '; ')."
```

逐项语义：

| 段落 | 来源 | 当前受众 |
| --- | --- | --- |
| `Lead assignment. Task ID: …` | Lead 治理标签 | 三角色共有，但 `Lead assignment` 是面向角色自我定位的元语，不是合同内容 |
| `Worktree: …` | `c.worktree` | 三角色共有，**role-critical** |
| `Frozen task contract: $contractSnapshot. Read that exact contract before acting.` | `Snapshot-Contract` 输出 | 当前给三角色"自寻址"合同全文；属于 Lead-only 治理（合同自寻址 + 强制读合同是 Lead 的合规护栏），合同本身只在 Lead 流程里被 Accept/Reclaim/Close-Incomplete 复核 |
| `Objective: $c.description` | `c.description`（**整张合同的描述**） | 当前无差别地推给 Executor 与 Reviewer；Reviewer 通常只需要"被审的目标"，但合同描述可能含有分支/验收/Issue 规则 |
| `Done criteria: $criteria`（含 `[owner=…; artifacts=…]`） | **所有** `done_criteria` | 当前 Reviewer 会读到含 `owner=executor` 的 criteria，Executor 会读到 `owner=reviewer` 的 criteria——跨角色暴露 |
| `Role delegations: $delegations`（含其它角色 id/capabilities） | **所有** `delegations` | Reviewer 会知道 Researcher 的 capability 列表，反之亦然；Lead-only 编排内容 |
| `Constraints: $c.constraints -join '; '` | **所有**合同 `constraints` | 当前是合同里全部约束的明文；按 Issue #1 描述，这些通常是 Lead 侧的分支准备/验收/回收/清理/Issue 规则 |

### 3. `Start-Task` 给 Executor / Reviewer 各加一句角色定位语

`scripts/pi-team.ps1:384`：

```
Launch-Role $state 'executor' "$assignment You are Executor. Perform only the assigned slice and report progress through the configured tools." $state.sessions.executor.session_id
Launch-Role $state 'reviewer' "$assignment You are Reviewer. Inspect the delegated work as it becomes available and report progress through the configured tools." $state.sessions.reviewer.session_id
```

差异仅为句尾追加角色身份一句；前缀 `$assignment` 对两者完全一致。

### 4. Researcher 的 assignment 已经是角色边界版本（对照基线）

`scripts/pi-team.ps1:397-404`：

```
$out = Join-Path $s.worktree $delegation[0].artifact_path; ...
$q = Get-Content -Raw -Encoding UTF8 $QuestionFile
$researcherId = New-Id
$assignment = "Lead assignment. Task ID: $($s.task_id). Worktree: $($s.worktree). " +
              "Research delegation: $($delegation[0].id). " +
              "Research artifact: $($delegation[0].artifact_path). " +
              "Required capabilities: $($delegation[0].required_capabilities -join ', '). " +
              "Objective: $($delegation[0].objective). " +
              "Answer exactly this question: $q"
...
Launch-Role $s 'researcher' $assignment ''
```

Researcher 的 assignment 已经只携带本委托的字段，**没有** `constraints`、**没有**其它角色的 delegation、**没有**全部 done criteria。这是 Issue #1 期望的对齐模板。

### 5. `Resume-Task` 的 assignment 同样是简版

`scripts/pi-team.ps1:407-414`：

```
Launch-Role $s $r "Resume Lead task $($s.task_id) as $r. Re-read the frozen task contract at $($s.contract_path) and continue the assigned work." $s.sessions.$r.session_id $true
```

`Resume-Task` 已经把合同路径作为指针而不是把合同内容塞进 prompt——这是另一份"边界"的现成参考。Resume 路径不影响 Issue #1 的最小改动，但说明"指针式引用"已经存在并被测试覆盖。

### 6. `RoleArguments` 注入的内容（与 assignment 无关的另一条通道）

`scripts/pi-team.ps1:322-339`：`RoleArguments` 通过 `--tools`、`--skill <SKILL.md>`、`--append-system-prompt <role.md>`、`--extension` 列表把**角色 markdown**与**私有 skill**注进 Pi CLI。其中：

- `--append-system-prompt` 指向 `.pi/agents/<role>.md`，即角色本体（executor/reviewer/researcher.md 全文）。
- `--skill` 指向 `.pi/skills/<role>/SKILL.md`，与角色 markdown 内的 `skillPath: ../skills` + `skills: <role-skill>` 共同决定该轮的工作流。
- `--tools` 列表来自 `Get-RoleCapabilities`，在 `RoleArguments` 与 `Get-RoleCapabilities`（`scripts/pi-team.ps1:108-118`）两处都硬编码三角色清单。
- `--no-extensions` / `--no-skills` 阻止环境级 ambient extension。
- Researcher 多挂一条 `~/.pi/agent/npm/node_modules/pi-web-access/index.ts`；executor/reviewer 不挂。

**结论：能力隔离已经由 `RoleArguments` 完整接管。** Issue #1 涉及的是 assignment 文本层面的注入，不是能力层面。Issue #1 明确要求"保持…角色能力隔离契约不变"——这正是 `RoleArguments` 与 `Get-RoleCapabilities` 的契约，**不能动**。

### 7. 当前角色 markdown 与 skill 的安全/报告/peer 段落（role-critical 的真正载体）

这些不是 assignment 的字段，但**正是 Issue #1 要保留的 role-critical 内容**——它们已经写在角色 markdown 里，被 `--append-system-prompt` 注入，不依赖 `$assignment`：

- `.pi/agents/executor.md`：Required inputs from Lead（task ID + worktree + scoped objective + done criteria）、`blackboard_update` 节律、bounded `RESEARCH_REQUEST` 给 Researcher、`READY_FOR_REVIEW`/`FIX_READY` 给 Reviewer、`implementation_notes/<task-id>.md`、idle/event-driven、`use the worktree's native command environment; On Windows, never invoke WSL unless Lead explicitly authorizes it`、`do not create a Scout, repeat unbounded discovery, or decompose unassigned subtasks`。
- `.pi/agents/reviewer.md`：`never edit production code`、`failures/<task-id>-<finding-id>.md`、`Read-only Git operations such as status, diff, log, show, and blame are allowed`、`Commit, stash, reset, checkout, rebase, cleanup, and other worktree-changing Git operations require explicit Lead authorization`、`On Windows, never invoke WSL unless Lead explicitly authorizes it`、`Peer policy: direct communication is allowed only with the paired Executor… refuse before invoking intercom send or ask for all other targets, including Researcher, and route through Lead`。
- `.pi/agents/researcher.md`：`use the explicitly selected answer-research-question skill`、`research/<task-id>-<slug>.md` 路径契约、`Peer policy: direct communication is allowed only with the paired Executor`、`Report Lead-facing material through the configured report_to_lead tool`、`never edit production code`、`Never use application-layer hashes and never treat intercom cancel as task cancellation` 等安全/peer 条款。

这些段落已经是 role-critical——它们不依赖 `$assignment` 的内容，Issue #1 不需要往角色 markdown 里新增任何"role-critical"条款；只需保证 `$assignment` 文本不再注入 Lead-only 内容即可。

## Lead-only 与 role-critical 拆分清单

### Lead-only（应从所有角色的 `$assignment` 中排除）

1. **合同快照路径字符串**与"Read that exact contract before acting"指令——属于 Lead 编排护栏，合同自寻址在 `Accept`/`Close-Incomplete`/`Reclaim`/`Sync-Task` 内已使用 `$s.contract_path`（`scripts/pi-team.ps1:374, 388, 430, 443, 452, 460`），不需要推给角色。
2. **`Constraints` 字段全文**（`$c.constraints -join '; '`）——合同 schema 规定它是 Lead-only 治理字段（如分支准备、base_ref、验收、清理、Issue 跟踪、文档对齐 checkpoint）。当前会被无差别注入 Executor/Reviewer 的 prompt，违反 Issue #1 的最小保留原则。
3. **全部 `done_criteria` 清单**——角色只需要自己作为 `owner` 的 criteria；其它角色的 criteria 暴露会导致角色自我授权越界（例如 Reviewer 拿到 `owner=executor` 的 criteria 后可能在 prompt 层产生"自行实现"的歧义）。
4. **全部 `delegations` 清单**——Reviewer 不需要 Researcher 的 `required_capabilities`，Researcher 不需要 Reviewer 的 `failures/` 路径。Researcher 的 assignment 已经按本委托筛选，是直接对齐模板。
5. **合同整体 `description`**（当合同 description 包含 Lead 治理叙述，例如"先建分支→再实现→再交 Reviewer→再由 Lead 验收→再 reclaim"）——这是 Lead 的故事，不是角色的事。最小改动里可以保留 description 的纯 objective 段，但需要 Lead 在合同层就只写 objective；或者按 delegation objective 替代（后者更稳，见下文"最小拆分建议"）。
6. **`Frozen task contract: …`** 句子里的合同路径——与第 1 项重叠，必须一起删除。`Resume-Task`（`scripts/pi-team.ps1:412`）已经把合同路径保留给 Resume 用，但 Resume 不属于 Issue #1 的最小改动范围。
7. **任何"Lead acceptance only"、"Lead owns acceptance/reclaim/cleanup"** 之类的措辞——这些已经写在 `AGENTS.md` 与 `ADR/0002-lead-subagent-collaboration-protocol.md` 里，角色通过 `inheritProjectContext: true` 已经继承，**不需要在 assignment 里重复**。

### Role-critical（必须保留在 `$assignment` 或通过其它渠道给到角色）

1. **Task ID**（peer 路由的 `pi-team--<task-id>--<role>--<launch-id>` 命名空间需要）——当前已注入，必须保留。
2. **Worktree 路径**（角色 bash/edit 都在这里执行）——当前已注入，必须保留。
3. **本角色 objective**——必须保留为一句话自然语言目标。来源应是 `delegations[*].objective`（按 role 过滤后唯一一条），不是合同 `description`。
4. **本角色的 done criteria**——`done_criteria | Where-Object owner -eq $Role`，每条带 `id`、`description`、`artifacts`。**不含** `owner=` 前缀（已经隐含）。
5. **本角色 delegation 摘要**——`delegations[*] | Where-Object role -eq $Role` 后的 `id`、`artifact_path`、`required_capabilities`（一份能力清单是研究/执行的边界标识，与 capability 工具隔离契约互补）。
6. **角色定位后缀**——`You are Executor…` / `You are Reviewer…` 一句保留；Researcher 没有这句也无碍（Researcher 的 objective 已是单一委托），但为了一致可保留。

> 上述 6 项 role-critical 全部**已经**通过角色 markdown + skill + `$assignment` 现有 channel 至少其中之一提供；最小改动只需要在 `$assignment` 里把 `Constraints` / 全部 `delegations` / 全部 `done_criteria` / 合同快照路径 / `Read that exact contract before acting` / 合同整体 description 移除/替换，**不动角色 markdown、不动 skill、不动能力清单、不动 `RoleArguments`**。

## 兼容性风险

### R1. 测试断言 "initial assignment must name the frozen contract path"

`tests/team-contract.test.mjs:319`：

```
assert.equal(record.args.some((arg) => arg.includes(contractSnapshot)), true, "initial assignment must name the frozen contract path");
```

这条断言把合同快照路径嵌在角色启动参数（Pi CLI 的 `--append-system-prompt`/初始 prompt 参数）里。Issue #1 的最小改动会删除该嵌入 → 这条断言必须**改写**为"合同快照路径不出现在普通角色 prompt 中、但 state.json 的 `contract_path` 字段仍指向它"。改写位置：`tests/team-contract.test.mjs`，与"role launchers inject common-dir identity and isolate Executor/Reviewer environments"同测试内。注意黑板 (`blackboard-core.mjs`) 与 Accept/Reclaim 仍依赖 `state.contract_path`，所以"不出现在 prompt、仍存在于 state"是唯一兼容形态。

### R2. Resume 复用同一合同快照路径

`tests/team-contract.test.mjs:339` 的 `assert.match(resumeRecords.map(...).join("\n"), new RegExp(executorSessionId))` 验证 Resume 注入的是 session id，而 Resume 仍向角色 prompt 注入合同路径（`scripts/pi-team.ps1:412`）。Issue #1 范围仅含 Start-Task/Research 的 assignment；Resume 不动。但需新增一条约束：**未来若把 Resume 也按 Issue #1 改写，必须保持 `state.contract_path` 仍是唯一权威指针**，避免双重来源。

### R3. Researcher 已是边界版本，对齐后会"看起来变化小"

Researcher 当前不传 `Constraints`、不传其它 delegations、不传全部 criteria，结构本身就是最小拆分的样板。Issue #1 的最小改动主要落在 Executor/Reviewer 的 `$assignment` 构造。Reviewer 的角色 markdown 已经显式禁止直连 Researcher、对 Executor 之外的 peer 全部 route through Lead（`agents/reviewer.md` 第 16 行）——这意味着即便 `$assignment` 现在"误给" Reviewer 看 Researcher 的 `required_capabilities`，Reviewer 的 markdown 会拦下；同理 Executor 的 markdown 拦下 Researcher 之外的 peer 行为。**安全冗余已存在**，所以"误给"是 prompt 噪声而非安全漏洞。但 Issue #1 的目标是"不再整体注入"，噪声也要清掉。

### R4. 合同 `description` 可能含分支/验收叙述

合同 schema（`scripts/pi-team.ps1:158`）仅要求 `description` 非空。Issue #1 的最小改动若仅剔除 `Constraints`、跨角色 criteria、跨角色 delegations，合同 `description` 仍会被注入；Issue #1 描述里专门点了"不再把 Lead 专属的分支准备、验收、回收、清理和 Issue 管理规则整体注入角色上下文"。因此**改写建议里要求把"Objective 段"改为本角色 `delegations[*].objective`**（Researcher 已是这个模型），而不是 `c.description`。这同时把 `$assignment` 的"Objective"与 delegation 合并，使 Lead 治理叙述留在 Lead。

### R5. `state.contract_path` 仍是唯一权威

`Accept`（`scripts/pi-team.ps1:430-449`）、`Close-Incomplete`（`scripts/pi-team.ps1:451-462`）、`Reclaim`（`scripts/pi-team.ps1:464-466`）、`Sync-Task`（`scripts/pi-team.ps1:390`）、`Resume-Task`（`scripts/pi-team.ps1:407-414`）都通过 `state.contract_path` 访问合同。把合同路径从角色 `$assignment` 移除不影响这些 Lead 路径。

### R6. 角色 markdown / skill / 黑板 / intercom 不动

`RoleArguments`（`scripts/pi-team.ps1:322-339`）、`Get-RoleCapabilities`（`scripts/pi-team.ps1:108-118`）、`Assert-DelegationCapabilities`（`scripts/pi-team.ps1:124-127`）、`.pi/agents/<role>.md`、`.pi/skills/<role>/SKILL.md`、`.pi/communication/extensions/<role>.ts`、`.pi/communication/policy.mjs`、`.pi/communication/runtime-policy.mjs`、`.pi/communication/send.mjs`、黑板 `plugins/agent-blackboard/server/blackboard-core.mjs`、启动器 `Assert-BlackboardTask`（`scripts/pi-team.ps1:368-376`）、`Setup-Codex` 等**全部不动**。Issue #1 的契约"保持…intercom 和角色能力隔离契约不变"就指这些。

### R7. Issue #1 acceptance criteria 与合同约束的对应

C-002 要求"Lead-only 的 branch/worktree preparation、acceptance、reclaim、cleanup 和 Issue 记录规则不再进入普通角色提示词；每个角色仍获得自身 objective、artifact、required capabilities、相关安全约束和 peer/report 边界"。对应的**排除项**（必须在最小改动中验证不出现在 assignment）：

- 分支/工作树准备叙述（合同 `description` 中的 base_ref / branch / worktree 治理叙事）——通过把"Objective"换成 `delegations[*].objective` 排除
- 验收叙述（合同里含 "Lead acceptance only"、"accept"、"verify with Reviewer before Lead acceptance"）——通过排除 `c.description` 而采用 `delegations[*].objective` 排除
- 回收叙述（reclaim、`Cleanup`、archive）——合同 `constraints` 字段里如有，已被排除
- 清理叙述（worktree remove、branch -D）——同上
- Issue 记录规则（GitHub Issues、`fix/issue-<n>-<slug>`）——同上

对应的**保留项**（必须仍出现在 assignment 或已通过角色 markdown / skill 提供）：

- 自身 `objective`、`artifact_path`、`required_capabilities`——assignment 保留前 3 项的精确子集
- 安全约束（不能编辑测试隐藏失败、不能编辑生产代码、不能 commit、不能 WSL、不能用 content hash 当 ID、bounded peer 拓扑）——已经在 `.pi/agents/*.md` 通过 `--append-system-prompt` 注入
- 报告约束（`blackboard_update` 节律、`report_to_lead`、idle/event-driven、ready_for_acceptance 状态名）——同上
- peer 边界（拒绝未授权 peer、对 Researcher/Reviewer/Executor 的允许方向、异步 `send` 不用 `ask`/`reply`）——同上

### R8. Issue #1 acceptance criteria C-003 / C-004 的验证复用路径

C-003 要求 Reviewer 独立复核；C-004 要求 Lead 可复现跑过测试。Reviewer 的角色 markdown 已经要求"Reproduce Executor's validation with `bash`"并验证 scope，因此**新增的正/负向测试落在 `tests/team-contract.test.mjs` 同测试内**即可，Reviewer 自动按现有工作流复核。Lead 的 `accept` 流程（`scripts/pi-team.ps1:430-449`）已经会要求每个 `C-###` 的 artifact，因此 Lead 复现验证通过 `tests/run-tests.ps1` 一行即可。

## 负向场景（最小改动后必须仍能阻止）

1. **角色越权访问其它角色的 criteria**：例如 Executor 启动参数里出现 `[owner=reviewer; artifacts=failures/...]`。Issue #1 排除项要求这类 owner 不出现在 assignment。
2. **角色暴露其它角色的 capability 列表**：例如 Reviewer 启动参数里出现 `[capabilities=web_search,fetch_content,...]`（Researcher 专属）。排除项要求 `$assignment` 里 `Role delegations` 段只含自身 delegation。
3. **合同 `Constraints` 段注入角色 prompt**：例如出现 `"use the common Git directory"` 或 `"use clean base_ref"`。Issue #1 排除项要求 Constraints 整段从 assignment 移除。
4. **合同 `description` 中的 Lead 治理叙述被原样注入**：例如包含"Lead acceptance only after Reviewer pass"、"reclaim and cleanup after acceptance"。最小改动的应对是 `Objective` 改为 `delegations[*].objective`。
5. **角色 prompt 出现合同快照路径字符串**：例如包含 `<git-common-dir>/pi-team/v1/contracts/<TASK_ID>.md`。Issue #1 排除项要求 `Frozen task contract: …` 与 `Read that exact contract before acting` 整句移除。
6. **角色 markdown / skill / 工具被悄悄改动**：测试 `tests/team-contract.test.mjs` 第 60-200 行关于 `inheritSkills`、`skillPath`、`tools`、`subagentOnlyExtensions` 的断言、`tests/communication-policy.test.mjs` 关于 `BOUNDED_PEERS` / `authorizePeer` / `contact_supervisor` reasons 的断言**全部不变**——这正是"保持能力隔离契约不变"的硬约束。
7. **Resume 路径被顺手改写**：Resume 不在 Issue #1 范围。负向验证：Resume 后的合同快照指针仍指向 `state.contract_path`，resume 自身测试 `tests/team-contract.test.mjs:285-340` 不动。
8. **Blackboard 流程被影响**：`scripts/pi-team.ps1:368-376` 的 `Assert-BlackboardTask`、`Invoke-BlackboardLifecycle`、黑板 MCP 工具均不动。负向验证：`tests/blackboard.test.mjs` 全部不变。

## 最小安全拆分建议（保持 CLI/生命周期/Blackboard/intercom/角色能力不变）

### S1. 把 `$assignment` 构造拆为角色本地模板

在 `scripts/pi-team.ps1:380-384` 之间插入一个角色本地构造函数，例如 `New-RoleAssignment $c $Role`：

```
function New-RoleAssignment($Contract, [string]$Role) {
   $delegation = @($Contract.delegations | Where-Object { $_.role -eq $Role })
   if ($delegation.Count -ne 1) { Fail "$Role delegation is required in contract" }
   $criteria = @($Contract.done_criteria | Where-Object { $_.owner -eq $Role } |
     ForEach-Object { "$($_.id): $($_.description) [artifacts=$($_.artifacts -join ',')]" }) -join '; '
   return "Lead assignment. Task ID: $($Contract.task_id). Worktree: $($Contract.worktree). " +
          "Role: $Role. Delegation: $($delegation[0].id). " +
          "Artifact: $($delegation[0].artifact_path). " +
          "Required capabilities: $($delegation[0].required_capabilities -join ', '). " +
          "Objective: $($delegation[0].objective). " +
          "Done criteria: $criteria."
}
```

`Start-Task` 调用：

```
$executorAssignment = New-RoleAssignment $c 'executor'
$reviewerAssignment = New-RoleAssignment $c 'reviewer'
Launch-Role $state 'executor' "$executorAssignment You are Executor. Perform only the assigned slice and report progress through the configured tools." $state.sessions.executor.session_id
Launch-Role $state 'reviewer' "$reviewerAssignment You are Reviewer. Inspect the delegated work as it becomes available and report progress through the configured tools." $state.sessions.reviewer.session_id
```

Researcher 的 `$assignment`（`scripts/pi-team.ps1:402`）已经按 `delegation[0]` 字段构造，可以保留原样或调用同一个函数（参数换成 `objective=$question` 而非 `delegation.objective`，路径换成 `artifact_path=$delegation[0].artifact_path`，并追加 `Answer exactly this question: $q`）。

### S2. 合同 schema 与 `Constraints` 处理

合同 schema 要求 `constraints` 非空（`scripts/pi-team.ps1:158`）。最小改动**保留 schema**（保持合同兼容），仅把 `$c.constraints` 从 `$assignment` 移除。合同 `description` 仍合法可填，但不再注入角色 prompt。

### S3. 角色 markdown / skill / 工具隔离

完全不动。`Get-RoleCapabilities`、`RoleArguments`、`.pi/agents/*.md`、`.pi/skills/*/SKILL.md`、`.pi/communication/extensions/*.ts`、`.pi/communication/policy.mjs`、`.pi/communication/runtime-policy.mjs`、`Assert-BlackboardTask`、`Invoke-BlackboardLifecycle` 均保持原状。

### S4. Resume / Accept / Reclaim / Sync-Task / Close-Incomplete / Doctor

全部不动。这些函数本来就只通过 `state.contract_path` 访问合同，未把合同内容注入角色 prompt。

### S5. 测试侧最小改动

`tests/team-contract.test.mjs:319` 的合同路径断言改写为：

```
assert.equal(record.args.some((arg) => arg.includes(contractSnapshot)), false, "initial assignment must not name the frozen contract path; state.contract_path remains the Lead-side pointer");
```

新增正/负向断言（在同测试块内追加）：

- 正向：每个角色的 prompt 中包含 `"Objective: <delegation.objective>"`、包含 `"Required capabilities: <delegation.required_capabilities>"`、包含 `"Artifact: <delegation.artifact_path>"`、包含 `"Role: <role>"`。
- 负向：每个角色的 prompt **不包含** `"Frozen task contract:"`、不包含 `"Constraints:"`、不包含其它角色的 `owner=` token、不包含其它角色的 delegation id。

新增一条独立测试（避免污染现有大测试）：`test("start-task assignment excludes Lead-only governance text and includes only role-scoped data", async () => {...})`。该测试复用现有 `RoleArguments` 路径与 fake 启动器（`tests/team-contract.test.mjs:285-340`），无需新增 fixture。

`tests/communication-policy.test.mjs` 与 `tests/blackboard.test.mjs` 不动；`tests/run-tests.ps1` 不动。

### S6. 验收 evidence

Lead `accept <task-id>` 时除了现有 `implementation_notes/ISSUE-001.md`、`reports/ISSUE-001-verification.md`、`reports/ISSUE-001-review.md` 外，需要新增 `failures/ISSUE-001-*.md` 仅当真实失败出现（角色 markdown 已经禁止无失败时编造）；新增/改动的 `tests/team-contract.test.mjs` 行要可被 Reviewer 直接 `Read` 复核。

## 可复现的验证命令

下列命令在 `D:/Coding/Harness/Pi-team-ISSUE-001`（即 worktree 根）执行，不运行系统外部命令、不使用 web_search、不修改生产代码。

### V1. 静态确认：`Start-Task` 已经按新构造

```
Get-Content scripts/pi-team.ps1 | Select-String -Pattern 'New-RoleAssignment|Lead assignment\.|Frozen task contract:|Constraints: \$'
```

期望：

- 出现 `New-RoleAssignment` 或等价的角色本地构造点；
- 仍出现 `Lead assignment.`（保留 task ID 前缀）；
- **不再**出现 `Frozen task contract:`；
- **不再**出现 `Constraints: $`。

### V2. 静态确认：合同约束字段已从 assignment 移除

```
Select-String -Path scripts/pi-team.ps1 -Pattern '\$c\.constraints'
```

期望：仅在 `Parse-Contract`（`scripts/pi-team.ps1:158`）的 schema 校验处出现；**不**出现在 `$assignment` 构造处（行号 380 附近）。

### V3. 静态确认：角色 markdown 不被改动

```
git diff -- scripts/pi-team.ps1 .pi/agents .pi/skills .pi/communication/policy.mjs .pi/communication/runtime-policy.mjs .pi/communication/send.mjs plugins/agent-blackboard/server/blackboard-core.mjs
```

期望：`.pi/agents/`、`.pi/skills/`、`.pi/communication/`、`plugins/agent-blackboard/` 五个目录**无改动**（diff 输出为空）。仅 `scripts/pi-team.ps1` 与 `tests/team-contract.test.mjs` 有改动。

### V4. 动态验证：合同测试通过

```
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File tests/run-tests.ps1
```

期望：

- `team-contract.test.mjs` 全套通过；
- 新增的正向断言（角色 prompt 含 Role / Delegation / Artifact / Required capabilities / Objective / Done criteria）全部命中；
- 新增的负向断言（不含 Frozen task contract:、不含 Constraints:、不含其它角色 owner token、不含其它角色 delegation id）全部命中；
- 改写后的合同路径断言（`must not name the frozen contract path`）命中；
- `communication-policy.test.mjs` 全套不变；
- `blackboard.test.mjs` 全套不变。

### V5. 静态确认：`Resume-Task` / `Accept` / `Reclaim` / `Sync-Task` / `Close-Incomplete` / `Doctor` 仍引用 `state.contract_path`

```
Select-String -Path scripts/pi-team.ps1 -Pattern 'contract_path'
```

期望：出现在 `Read-State`、`Snapshot-Contract`、`Start-Task`、`Resume-Task`、`Sync-Task`、`Accept`、`Close-Incomplete`、`Reconcile`、`Reclaim`、`Doctor` 等函数体；**不**出现在 `Launch-Role` / `New-RoleAssignment` / `$assignment` 构造处。

### V6. 静态确认：`RoleArguments` 与 `Get-RoleCapabilities` 未变

```
node --input-type=module -e "import { readFileSync } from 'node:fs'; const src = readFileSync('scripts/pi-team.ps1','utf8'); const m1 = src.match(/function Get-RoleCapabilities[\s\S]+?return @\(\$capabilities\[\$Role\]\)\s+}/)[0]; const m2 = src.match(/function RoleArguments[\s\S]+?return \$args\s+}/)[0]; console.log(m1 === m1); console.log(m2 === m2);"
```

期望：两段函数仍存在，且 Researcher 仍多挂 `~/.pi/agent/npm/node_modules/pi-web-access/index.ts`（在 `RoleArguments` 的 `if ($Role -eq 'researcher')` 分支内，`scripts/pi-team.ps1:336`）。

### V7. 静态确认：黑板 MCP / `Assert-BlackboardTask` 未变

```
git diff -- plugins/agent-blackboard/
```

期望：diff 为空。

### V8. Issue #1 验收映射（手动核对）

按 `plans/ISSUE-001-task.md` 的 C-001 / C-002 / C-003 / C-004 各自的人工复核：

- C-001：本研究 artifact 即 `research/ISSUE-001-prompt-boundaries.md`。
- C-002：`implementation_notes/ISSUE-001.md` + `reports/ISSUE-001-verification.md`，由 Executor 编写。
- C-003：`reports/ISSUE-001-review.md`，由 Reviewer 编写。
- C-004：`reports/ISSUE-001-verification.md`，含 V1–V8 的逐项输出。

## 与 Issue #1 验收标准的对应表

| 验收条目 | 本研究的对应位置 | 处置 |
| --- | --- | --- |
| Lead-only 文本不再出现在普通角色启动 assignment | 拆分清单"Lead-only" 1-7；最小改动 S1、S2 | 排除 |
| 自身 objective、artifact、required capabilities 仍出现在角色 prompt | 拆分清单"Role-critical" 3-5；最小改动 S1 | 保留 |
| 相关安全约束仍在角色边界内 | 拆分清单"Role-critical" 6；角色 markdown 已通过 `--append-system-prompt` 注入；最小改动 S3 | 保留（不依赖 assignment） |
| 报告约束仍在角色边界内 | 同上 | 保留 |
| peer 边界仍在角色边界内 | 同上 + `.pi/communication/policy.mjs` `BOUNDED_PEERS` 不变 | 保留 |
| 公开 CLI 不变 | 拆分"S3/S4"；`RoleArguments` 与 `Get-RoleCapabilities` 不动 | 保留 |
| 任务生命周期不变 | `Start-Task` / `Resume-Task` / `Accept` / `Close-Incomplete` / `Reconcile` / `Reclaim` / `Cleanup` 全部不动 | 保留 |
| Blackboard 不变 | `Assert-BlackboardTask` / `Invoke-BlackboardLifecycle` / 黑板 MCP 不动；V7 diff 为空 | 保留 |
| intercom 不变 | `.pi/communication/policy.mjs` / `runtime-policy.mjs` / `send.mjs` 不动；`tests/communication-policy.test.mjs` 不动 | 保留 |
| 角色能力隔离契约不变 | `Get-RoleCapabilities` + 角色 markdown + skill + 工具清单不动；V6 静态确认 | 保留 |

## 来源路径

- `scripts/pi-team.ps1:108-118` `Get-RoleCapabilities`
- `scripts/pi-team.ps1:124-127` `Assert-DelegationCapabilities`
- `scripts/pi-team.ps1:153-194` `Parse-Contract`（合同 schema）
- `scripts/pi-team.ps1:322-339` `RoleArguments`
- `scripts/pi-team.ps1:368-386` `Start-Task` + `$assignment` 构造
- `scripts/pi-team.ps1:397-405` `Research` + Researcher `$assignment` 构造
- `scripts/pi-team.ps1:407-414` `Resume-Task`
- `scripts/pi-team.ps1:430-449` `Accept`
- `scripts/pi-team.ps1:451-462` `Close-Incomplete`
- `scripts/pi-team.ps1:464-466` `Reclaim`
- `.pi/agents/executor.md`、`reviewer.md`、`researcher.md`
- `.pi/communication/policy.mjs`、`runtime-policy.mjs`、`send.mjs`、`extensions/*.ts`
- `tests/team-contract.test.mjs:285-340` 现有角色启动器集成测试
- `tests/team-contract.test.mjs:319` 待改写的合同路径断言
- `tests/communication-policy.test.mjs` 与 `tests/blackboard.test.mjs`（不应被改动）
- `tests/run-tests.ps1`（V4 的入口）
- `ADR/0002-lead-subagent-collaboration-protocol.md`（Authority / Persistent pair lifecycle / Communication 章节作为 Lead-only/role-critical 划分的依据）
- `AGENTS.md`、`goal.md`（项目级 Lead 流程说明，作为 Lead-only 治理叙述的源头；`inheritProjectContext: true` 已经把项目上下文继承给所有角色，不需要在 assignment 重复）

## 信心与剩余缺口

- **信心：高**：拆分依据直接来自 `scripts/pi-team.ps1` 的当前实现与现有角色 markdown；最小改动只触及 `Start-Task` 的 `$assignment` 构造（`scripts/pi-team.ps1:381-384`）与一条测试断言（`tests/team-contract.test.mjs:319`），其余均为"不动"清单。Issue #1 的契约"保持公开 CLI、任务生命周期、Blackboard、intercom 和角色能力隔离契约不变"被逐条映射到 V1–V8 验证命令。
- **剩余缺口（不影响 Issue #1 最小改动，仅供 Executor 参考）**：
  1. `Resume-Task` 的 `"Re-read the frozen task contract at $($s.contract_path)"`（`scripts/pi-team.ps1:412`）仍在 prompt 里指向合同——属于 Resume 范畴，**不**属于 Issue #1 范围；若 Lead 后续要把 Resume 也按 Issue #1 改写，可参考 S5 的负向断言扩展。
  2. Researcher 的 `$assignment` 没有句尾 `"You are Researcher..."`，而 Executor/Reviewer 有；为了一致可在 S1 中给 Researcher 也加一句，但属于风格调整而非 Issue #1 必须。
  3. `state.contract_path` 是否需要在 README/AGENTS 里新增一段"角色不应从 prompt 推断合同，应通过 state.json 访问"的提醒——属于文档同步，不在 Issue #1 范围内；若 Lead 决定加，按 AGENTS.md 的 `<lead-pi-team-runbook>` 流程更新。

## 不变量（变更前后必须保持）

- 公开 CLI：`publish` / `validate` / `start` / `sync` / `research` / `status` / `watch` / `resume` / `accept` / `close-incomplete` / `reconcile` / `reclaim` / `cleanup` / `setup` / `codex-setup` / `doctor` 的参数与退出语义不变。
- 任务生命周期：`active` / `accepted` / `incomplete` / `reclaimed` / `cleaned` 五种 `execution_status`，`pending` / `accepted` / `incomplete` 三种 `outcome`，`Sync-Task` 仍要求 `branch` 与 `worktree` 不可变。
- Blackboard：`Assert-BlackboardTask` 仍要求任务存在且 `status=active`；`Invoke-BlackboardLifecycle` 仍按 action 调用黑板 CLI；黑板 MCP 工具集不变。
- intercom：`BOUNDED_PEERS` 拓扑（`executor ↔ researcher`、`executor ↔ reviewer`、`researcher ↔ reviewer` 双向禁止）、`SUPERVISOR_REASONS`（`need_decision`/`progress_update`/`interview_request` 三选一）、`SAFE_INTERCOM_ACTIONS`（`list`/`list-cwd`/`status`/`pending`）保持不变。
- 角色能力隔离：`Get-RoleCapabilities` 表（researcher / executor / reviewer 三组工具列表）、`RoleArguments` 中 `--no-extensions` / `--no-skills` / `--tools` / `--skill` / `--append-system-prompt` / `--extension` 五组开关及 Researcher 多挂 `pi-web-access` 的事实不变。
