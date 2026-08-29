# Issue #1 — Keep Lead orchestration constraints out of role startup prompts

```json
{
  "version": 2,
  "task_id": "ISSUE-001",
  "name": "修复 Issue #1：隔离 Lead 编排约束与角色启动提示词",
  "description": "针对 GitHub Issue #1，修改 Pi Team 启动器，使 Executor、Reviewer 和 Researcher 的启动提示词只接收各自任务所需的目标、制品、能力和安全约束，不再把 Lead 专属的分支准备、验收、回收、清理和 Issue 管理规则整体注入角色上下文；保持公开 CLI、任务生命周期、Blackboard、intercom 和角色能力隔离契约不变。",
  "base_ref": "develop",
  "branch": "pi-team/ISSUE-001-role-prompt-boundaries",
  "worktree": "D:/Coding/Harness/Pi-team-ISSUE-001",
  "in_scope": [
    "scripts/pi-team.ps1 中 Start-Task、角色 assignment 构造和必要的角色专属提示词筛选",
    "tests/team-contract.test.mjs、tests/communication-policy.test.mjs 或与启动提示词直接相关的最小测试辅助代码",
    "对 Executor、Reviewer、Researcher 的 Lead-only 约束排除和 role-critical 约束保留的正向/负向测试",
    "Issue #1 所需的研究、实现说明、验证报告和评审报告"
  ],
  "out_of_scope": [
    "修改公开 pi-team.cmd 命令、任务合同字段或 Agent 通信协议",
    "改变真实角色的工具权限、Blackboard 唤醒机制或 Lead 到 Executor 的通信能力",
    "修改 GitHub Issue、运行归档、旧任务清理或无关性能优化",
    "从 Gold、oracle、期望补丁或答案派生数据推导实现或验收",
    "通过删除所有约束或硬编码单一示例来掩盖提示词边界问题"
  ],
  "done_criteria": [
    {
      "id": "C-001",
      "description": "Researcher 只读确认当前 Start-Task assignment 如何将完整 constraints 注入三类角色，区分 Lead-only 与 role-critical 约束，并提出保持生命周期/通信契约的最小安全拆分建议。",
      "owner": "researcher",
      "artifacts": ["research/ISSUE-001-prompt-boundaries.md"]
    },
    {
      "id": "C-002",
      "description": "Executor 实现角色专属启动提示词构造：Lead-only 的 branch/worktree preparation、acceptance、reclaim、cleanup 和 Issue 记录规则不再进入普通角色提示词；每个角色仍获得自身 objective、artifact、required capabilities、相关安全约束和 peer/report 边界。",
      "owner": "executor",
      "artifacts": ["implementation_notes/ISSUE-001.md", "reports/ISSUE-001-verification.md"]
    },
    {
      "id": "C-003",
      "description": "Reviewer 独立检查实际启动参数/提示词构造、排除与保留测试、公开生命周期和通信行为，确认没有通过提示词删减破坏角色安全边界，并记录复核结论。",
      "owner": "reviewer",
      "artifacts": ["reports/ISSUE-001-review.md"]
    },
    {
      "id": "C-004",
      "description": "Lead 可复现验证相关合同/通信测试通过；至少覆盖 Lead-only 文本不出现在普通角色启动 assignment、role-critical 内容仍保留、三角色启动路径和既有生命周期行为不回归。",
      "owner": "executor",
      "artifacts": ["reports/ISSUE-001-verification.md"]
    }
  ],
  "delegations": [
    {
      "id": "RESEARCH-ISSUE-001",
      "role": "researcher",
      "objective": "只读审阅 scripts/pi-team.ps1 的 Start-Task/assignment 构造、当前角色定义与相关测试，列出 Lead-only 和 role-critical 提示词内容，给出最小拆分、兼容性风险、负向场景和验证命令；不要运行系统命令、不要使用 web_search、不要修改生产代码、不要创建子任务。",
      "artifact_path": "research/ISSUE-001-prompt-boundaries.md",
      "required_capabilities": ["read", "grep", "find", "ls", "write", "report_to_lead", "blackboard_update"]
    },
    {
      "id": "EXECUTOR-ISSUE-001",
      "role": "executor",
      "objective": "在独立 worktree 中修复 Issue #1 的启动提示词边界问题，按角色筛选合同信息并增加能够证明排除 Lead-only 治理文本且保留 role-critical 约束的测试；保持公开 CLI、角色能力、生命周期、Blackboard 和 intercom 行为不变。",
      "artifact_path": "reports/ISSUE-001-verification.md",
      "required_capabilities": ["read", "grep", "find", "ls", "bash", "edit", "write", "intercom", "report_to_lead", "blackboard_update"]
    },
    {
      "id": "REVIEW-ISSUE-001",
      "role": "reviewer",
      "objective": "独立复核 Issue #1 的启动提示词构造、测试和范围边界；重跑相关验证，检查三类角色仍收到必要安全/通信信息且 Lead-only 编排规则被排除；发现问题时要求同一 Executor 修复后复审。",
      "artifact_path": "reports/ISSUE-001-review.md",
      "required_capabilities": ["read", "grep", "find", "ls", "bash", "edit", "write", "intercom", "report_to_lead", "blackboard_update"]
    }
  ],
  "constraints": [
    "只使用 D:/Coding/Harness/Pi-team/pi-team.cmd 当前稳定入口；不得使用旧入口或其他任务 worktree",
    "base_ref 必须是 develop；Lead 在 start 前预创建并验证任务分支，避免从调用目录当前 HEAD 派生",
    "Executor/Reviewer 不提交 commit、stash、reset、checkout、rebase 或 cleanup；Lead 验收前保持 persistent pair 存活",
    "Researcher 只读且不运行系统命令；研究结果必须落在独立 research 制品中",
    "不得读取或推导 Gold、oracle、期望补丁、答案派生范围或评测保留数据",
    "不得改变真实角色 Terminal 可见行为、Blackboard 不是控制总线的既有语义，或通过角色提示词绕过运行时策略",
    "原始 prompt、envelope、audit log、主机路径和运行时报告不进入 GitHub Issue；Issue 只使用 Lead 审核后的精简证据"
  ]
}
```
