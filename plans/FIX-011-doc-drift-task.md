# FIX-011-DOCS — Correct Issue #11 documentation drift

```json
{
  "version": 2,
  "task_id": "FIX-011-DOCS",
  "name": "修复 Issue #11 的验收后文档漂移",
  "description": "修正 Issue #11 交付文档中的测试数量、控制场景数量和新增测试清单，使文档与已验证的 76/76 测试结果一致；不修改生产代码、测试逻辑、Reviewer 报告或协议决定。",
  "base_ref": "develop",
  "branch": "fix/issue-011-doc-drift",
  "worktree": "D:/Coding/Harness/Pi-team-FIX-011-doc-drift",
  "in_scope": [
    "implementation_notes/ISSUE-011.md 中的测试数量、Files changed 清单和 C-002 证据文字",
    "reports/ISSUE-011-verification.md 中的 per-file test counts 和 C2/C3 控制场景数量",
    "FIX-011-DOCS 的实现、验证和评审 artifact"
  ],
  "out_of_scope": [
    "任何生产代码、测试逻辑、协议决定、角色 prompt、skill、README 或脚本",
    "reports/ISSUE-011-review.md 的内容修改",
    "改变 Issue #11 的接受结果、任务状态、GitHub Issue 状态或 master 分支",
    "向 GitHub Issue 写入原始 prompt、envelope、audit、主机路径或运行时转储"
  ],
  "done_criteria": [
    {
      "id": "C-001",
      "description": "Executor 将 Issue #11 两份交付文档中的 per-file test counts 更正为 communication-policy 50（16 pre-existing + 21 Issue #3 + 13 Issue #11）、team-contract 20、blackboard 6；并补全 implementation_notes 中遗漏的两个 runtime-path 测试，同时保持文档之外的实现和测试不变。",
      "owner": "executor",
      "artifacts": ["implementation_notes/FIX-011-doc-drift.md"]
    },
    {
      "id": "C-002",
      "description": "Reviewer 独立复核两份被修改文档的数字、测试清单和 diff 范围，确认没有修改生产代码、测试逻辑或 Reviewer 原报告；如发现问题，要求同一 Executor 修复并复审。",
      "owner": "reviewer",
      "artifacts": ["reports/FIX-011-doc-drift-review.md"]
    },
    {
      "id": "C-003",
      "description": "Lead 可复现运行完整 tests/run-tests.ps1 并确认 76/76 通过，确认工作树 diff 仅包含本任务允许的两份 Issue #11 文档和所需 artifact。",
      "owner": "executor",
      "artifacts": ["reports/FIX-011-doc-drift-verification.md"]
    }
  ],
  "delegations": [
    {
      "id": "EXECUTOR-FIX-011-DOCS",
      "role": "executor",
      "objective": "只修正 Issue #11 implementation_notes 与 verification 文档中的测试数量、C2/C3 数量和遗漏的两个 runtime-path 测试清单；不得修改代码、测试逻辑或 Reviewer 报告，并交付实现说明和验证报告。",
      "artifact_path": "reports/FIX-011-doc-drift-verification.md",
      "required_capabilities": ["read", "grep", "find", "ls", "edit", "write", "report_to_lead", "blackboard_update"]
    },
    {
      "id": "REVIEW-FIX-011-DOCS",
      "role": "reviewer",
      "objective": "独立复核 FIX-011-DOCS 的两份文档修改，核对所有数字和测试清单与实际测试文件、既有 Issue #11 结果一致，并确认没有越界代码或测试改动；发现问题时驱动同一 Executor 修复后复审。",
      "artifact_path": "reports/FIX-011-doc-drift-review.md",
      "required_capabilities": ["read", "grep", "find", "ls", "bash", "edit", "write", "intercom", "report_to_lead", "blackboard_update"]
    }
  ],
  "constraints": [
    "只使用 D:/Coding/Harness/Pi-team/pi-team.cmd 当前稳定入口；不得使用其他任务 worktree",
    "base_ref 必须是 develop；Lead 在 start 前预创建并验证任务分支",
    "Executor/Reviewer 不提交 commit、stash、reset、checkout、rebase 或 cleanup；Lead 验收前保持 pair 存活",
    "只允许修改 implementation_notes/ISSUE-011.md 和 reports/ISSUE-011-verification.md，以及本任务 artifact",
    "不能改变 Issue #11 的代码、测试逻辑、协议决定、Reviewer 原报告或 master 分支",
    "审计日志、运行时 trace、临时文件和未要求的 failure artifact 不提交"
  ]
}
```
