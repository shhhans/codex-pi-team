# Issue #2 — Investigate repeated empty terminal windows during Pi Team runs

```json
{
  "version": 2,
  "task_id": "ISSUE-002",
  "name": "处理 Issue #2：消除 Pi Team 测试中的空 Terminal",
  "description": "针对 GitHub Issue #2，定位并修复 Pi Team 测试或受控运行过程中反复出现的空 Terminal/空 pane 及残留 fake launcher 进程问题。修复优先作用于测试替身、测试进程生命周期和清理路径，不改变真实角色 wt.exe 的产品可见行为；保持现有 CLI、任务生命周期、Blackboard、intercom、角色能力和测试语义不变。",
  "base_ref": "develop",
  "branch": "pi-team/ISSUE-002-empty-terminals",
  "worktree": "D:/Coding/Harness/Pi-team-ISSUE-002",
  "in_scope": [
    "tests/run-tests.ps1、tests/team-contract.test.mjs 以及与 Issue #2 直接相关的 fake WT/fake Pi 启动与清理路径",
    "scripts/pi-team.ps1 中仅影响测试替身或测试隔离的最小修复；真实 wt.exe 角色窗口契约必须保持不变",
    "启动、research、resume、超时、失败恢复和参数边界相关的必要测试与诊断断言",
    "Issue #2 所需的研究、实现说明、验证报告和评审报告"
  ],
  "out_of_scope": [
    "改变真实角色 Terminal 的产品可见行为或通过隐藏真实窗口掩盖测试问题",
    "修改 Pi Team 的公开 CLI、任务契约、Blackboard、intercom 或角色能力协议",
    "Issue #1 的角色启动提示词边界、Issue #3 研究授权、Issue #4/5/6/7 的问题",
    "无关任务清理、旧任务状态修复或 GitHub Issue 内容改写",
    "从 Gold、oracle、期望补丁或答案派生数据推导实现或验收",
    "只根据单一示例硬编码窗口或进程结果"
  ],
  "done_criteria": [
    {
      "id": "C-001",
      "description": "Researcher 只读梳理 Issue #2 涉及的测试包装器、fake launcher、真实 wt.exe 边界和进程/窗口清理路径，给出可复现的正向与负向场景及最小安全修复建议。",
      "owner": "researcher",
      "artifacts": ["research/ISSUE-002-empty-terminal-paths.md"]
    },
    {
      "id": "C-002",
      "description": "Executor 实现最小测试侧修复，保持启动、research、resume、超时和参数边界测试语义；受控测试不再产生不必要的可见空 Terminal 或残留 fake launcher 进程。",
      "owner": "executor",
      "artifacts": ["implementation_notes/ISSUE-002.md", "reports/ISSUE-002-verification.md"]
    },
    {
      "id": "C-003",
      "description": "Reviewer 独立复核 Issue #2 根因、修复 diff、窗口/进程证据、测试清理路径和真实 wt.exe 行为边界；发现问题时驱动同一 Executor 修复后复审。",
      "owner": "reviewer",
      "artifacts": ["reports/ISSUE-002-review.md"]
    },
    {
      "id": "C-004",
      "description": "Lead 可复现验证 tests/run-tests.ps1 通过；测试期间 fake launcher 使用无窗口或等价隔离方式；测试结束及失败启动恢复后无该测试新增的残留窗口/进程；真实启动路径的窗口可见性证据保持原契约。",
      "owner": "executor",
      "artifacts": ["reports/ISSUE-002-verification.md"]
    }
  ],
  "delegations": [
    {
      "id": "RESEARCH-ISSUE-002",
      "role": "researcher",
      "objective": "只读审阅当前 develop 中 tests/run-tests.ps1、tests/team-contract.test.mjs 和 scripts/pi-team.ps1，确定哪些测试调用会创建可见 console/window 或残留 fake launcher，区分测试替身与真实 wt.exe，并提出最小测试侧修复、对照场景和验证命令；不要运行系统命令、不要使用 web_search、不要创建子任务。",
      "artifact_path": "research/ISSUE-002-empty-terminal-paths.md",
      "required_capabilities": ["read", "grep", "find", "ls", "write", "report_to_lead", "blackboard_update"]
    },
    {
      "id": "EXECUTOR-ISSUE-002",
      "role": "executor",
      "objective": "在独立 worktree 中修复 Issue #2 的测试窗口/进程生命周期问题，优先处理 fake launcher 的可见性和清理，增加必要的进程/窗口断言和验证记录；禁止改变真实 wt.exe 角色 Terminal 的产品行为或扩大到其他 Issue。",
      "artifact_path": "reports/ISSUE-002-verification.md",
      "required_capabilities": ["read", "grep", "find", "ls", "bash", "edit", "write", "intercom", "report_to_lead", "blackboard_update"]
    },
    {
      "id": "REVIEW-ISSUE-002",
      "role": "reviewer",
      "objective": "独立复核 Issue #2 的测试侧修复，检查窗口/进程证据、启动和失败清理、现有测试语义以及真实 wt.exe 行为边界；通过配对 intercom 要求同一 Executor 修复并复审，不自行修改生产代码。",
      "artifact_path": "reports/ISSUE-002-review.md",
      "required_capabilities": ["read", "grep", "find", "ls", "bash", "edit", "write", "intercom", "report_to_lead", "blackboard_update"]
    }
  ],
  "constraints": [
    "只使用 D:/Coding/Harness/Pi-team/pi-team.cmd 当前稳定入口；不得使用旧入口或其他任务 worktree",
    "base_ref 必须是 develop；Lead 在 start 前预创建并验证任务分支，避免从调用目录当前 HEAD 派生",
    "Executor/Reviewer 不提交 commit、stash、reset、checkout、rebase 或 cleanup；Lead 验收前保持 persistent pair 存活",
    "Researcher 只读且不运行系统命令；证据必须区分观察值、推断和待测项",
    "不得读取或推导 Gold、oracle、期望补丁、答案派生范围或评测保留数据",
    "原始 prompt、envelope、audit log、主机路径和运行时报告不进入 GitHub Issue；Issue 只使用 Lead 审核后的精简证据"
  ]
}
```
