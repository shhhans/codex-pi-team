# LIFECYCLE-001 — Lead decision-oriented inspect and finalize

```json
{
  "version": 2,
  "task_id": "LIFECYCLE-001",
  "name": "重新定义 finalize 并新增 Lead inspect",
  "description": "为 Pi Team 增加只读 inspect 证据收集命令，并将 finalize 重构为 Lead 已验收后的确定性集成、资源回收和归档执行器。Blackboard 未收敛只作为 warning；代码范围、目标分支、合并冲突和测试失败仍为硬安全阻断。同步记录 Lead 决策权与生命周期边界的 ADR。",
  "base_ref": "develop",
  "branch": "pi-team/LIFECYCLE-001-inspect-finalize",
  "worktree": "D:/Coding/Harness/Pi-team-LIFECYCLE-001",
  "in_scope": [
    "scripts/pi-team.ps1",
    "pi-team.cmd",
    "tests/team-contract.test.mjs",
    "tests/communication-policy.test.mjs",
    "tests/blackboard.test.mjs",
    "ADR/0002-lead-subagent-collaboration-protocol.md",
    "ADR/0003-stable-pi-team-entrypoint.md",
    "ADR/0005-agent-blackboard-observability.md",
    "ADR/0006-lead-inspect-finalize-boundary.md",
    "plugins/agent-blackboard/skills/pi-team-lead/SKILL.md",
    "README.md",
    "AGENTS.md",
    "architect.md",
    "goal.md",
    "project_state.md",
    "implementation_notes/LIFECYCLE-001.md",
    "reports/LIFECYCLE-001-review.md",
    "reports/LIFECYCLE-001-verification.md"
  ],
  "out_of_scope": [
    "PERF-005",
    "ISSUE-031 and other historical task cleanup",
    ".pi/agents/",
    ".pi/communication/",
    "plugins/agent-blackboard/server/"
  ],
  "done_criteria": [
    {
      "id": "C-001",
      "description": "inspect provides read-only structured and human-readable lifecycle evidence, including scope, artifacts, tests, processes, reusable-content hygiene, Blackboard observations, and optional output persistence.",
      "owner": "executor",
      "artifacts": ["implementation_notes/LIFECYCLE-001.md", "reports/LIFECYCLE-001-verification.md"]
    },
    {
      "id": "C-002",
      "description": "finalize treats Lead acceptance as authorization, ignores Blackboard convergence as a hard gate, supports explicit target-branch override, reclaims task-owned resources, returns structured results, and remains phase-retryable without unsafe deletion.",
      "owner": "executor",
      "artifacts": ["implementation_notes/LIFECYCLE-001.md", "reports/LIFECYCLE-001-verification.md"]
    },
    {
      "id": "C-003",
      "description": "ADR and operator documentation define Lead decision authority, inspect evidence collection, finalize execution boundaries, hard safety gates, non-blocking warnings, develop target policy, and staged recovery.",
      "owner": "executor",
      "artifacts": ["ADR/0006-lead-inspect-finalize-boundary.md", "reports/LIFECYCLE-001-verification.md"]
    },
    {
      "id": "C-004",
      "description": "Tests cover inspect output and read-only behavior, stale Blackboard warnings, target branch policy, live resource reclamation, conflict/test failure preservation, retry idempotence, structured failures, and secret redaction.",
      "owner": "reviewer",
      "artifacts": ["reports/LIFECYCLE-001-review.md", "reports/LIFECYCLE-001-verification.md"]
    }
  ],
  "delegations": [
    {
      "id": "EXECUTOR-LIFECYCLE-001",
      "role": "executor",
      "objective": "Implement inspect, decision-oriented finalize, staged recovery, documentation, and focused tests in the assigned worktree.",
      "artifact_path": "implementation_notes/LIFECYCLE-001.md",
      "required_capabilities": ["read", "write", "edit", "bash", "pi_team_intercom", "blackboard_update"]
    },
    {
      "id": "REVIEW-LIFECYCLE-001",
      "role": "reviewer",
      "objective": "Review the same worktree, add or update focused tests, verify Lead/finalizer boundaries, and record independent evidence.",
      "artifact_path": "reports/LIFECYCLE-001-review.md",
      "required_capabilities": ["read", "write", "edit", "bash", "pi_team_intercom", "blackboard_update"]
    }
  ],
  "constraints": [
    "Use one task sequentially; do not start parallel Pi Team tasks.",
    "Do not modify Blackboard, heartbeat, or task concurrency mechanisms.",
    "Do not restore static capability allow-list validation.",
    "Do not use git add -A; finalizer must stage only contract-scoped paths.",
    "Do not include API keys, Authorization headers, or other credentials in code, artifacts, logs, or reports.",
    "Blackboard observations and archive failures are non-blocking finalizer warnings; scope, branch safety, conflicts, and failed tests remain hard failures."
  ]
}
```
