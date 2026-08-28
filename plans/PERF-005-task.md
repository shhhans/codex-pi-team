# Pi Team performance optimization implementation

```json
{
  "version": 2,
  "task_id": "PERF-005",
  "name": "基于 PERF-004 落地 Pi Team 启动与事件路径性能优化",
  "description": "基于当前 master 和 PERF-004 的已验证排序，使用 Pi Team 实现三个边界清晰的优化：Wait-RoleReady 就绪等待路径、Start-RoleProcess 的 bootstrap 参数传递路径、以及事件日志序号追加路径。保持现有 CLI、任务生命周期、通信和状态契约不变；通过测试与可复现实验确认行为不回归和性能收益，不实现 PERF-004 的其他候选项。",
  "base_ref": "master",
  "branch": "pi-team/PERF-005",
  "worktree": "D:/Coding/Harness/Pi-team-PERF-005",
  "in_scope": [
    "scripts/pi-team.ps1 的 Wait-RoleReady 就绪等待实现及其安全超时/回退行为",
    "scripts/pi-team.ps1 的 Start-RoleProcess bootstrap 参数传递实现",
    ".pi/communication/role-events.mjs 的事件序号追加实现",
    "与上述路径直接相关的单元测试、集成测试、基准或诊断脚本",
    "实现前后可复现的性能测量和验证记录"
  ],
  "out_of_scope": [
    "PERF-004 Option 2 的 legacy 事件路由收敛",
    "PERF-004 Option 5 的 Blackboard snapshot/watch 索引",
    "PERF-004 Option 6 的失败回收策略改造",
    "改变公开 pi-team.cmd 命令、任务契约字段或 Agent 通信协议",
    "修改 GitHub Issue、运行归档或无关规范文档",
    "从 Gold、oracle、期望补丁或答案派生数据推导实现或验收",
    "单一示例硬编码或只依赖静态日志证明性能收益"
  ],
  "done_criteria": [
    {
      "id": "C-001",
      "description": "Researcher 完成 bounded 只读设计核查，明确三个优化点的现有代码路径、兼容性约束、可观测指标、负向场景和测试建议；不修改生产代码。",
      "owner": "researcher",
      "artifacts": ["research/PERF-005-design-review.md"]
    },
    {
      "id": "C-002",
      "description": "Executor 实现三个选定优化，保留现有命令和状态语义；为等待超时、bootstrap 参数边界、首次/旧事件日志及并发追加等关键行为增加或更新测试，并记录实现前后测量结果。",
      "owner": "executor",
      "artifacts": ["implementation_notes/PERF-005.md", "reports/PERF-005-performance.md"]
    },
    {
      "id": "C-003",
      "description": "Reviewer 独立检查生产 diff、测试、性能测量和回退路径，确认没有扩大到 PERF-004 其他候选项、没有破坏协议，并在发现问题时驱动同一 Executor 修复后复审。",
      "owner": "reviewer",
      "artifacts": ["reports/PERF-005-review.md"]
    },
    {
      "id": "C-004",
      "description": "Lead 可按路径和命令复现关键验证：现有测试通过；事件序号连续且并发安全；等待路径不会忙轮询至超时且仍有有界超时；bootstrap 可传递现有身份、目录、可执行文件和参数；性能记录区分观测值、推断和待测项。",
      "owner": "executor",
      "artifacts": ["reports/PERF-005-performance.md"]
    }
  ],
  "delegations": [
    {
      "id": "RESEARCH-005",
      "role": "researcher",
      "objective": "只读审阅当前 master 中三个目标路径及其测试，回答如何在不改变 CLI、状态和通信契约的前提下实现 Option 1、Option 3、Option 4；列出兼容性风险、负向场景和可复现验证命令。不要运行系统命令、不要使用 web_search、不要创建子任务。",
      "artifact_path": "research/PERF-005-design-review.md",
      "required_capabilities": ["read", "grep", "find", "ls", "write", "report_to_lead", "blackboard_update"]
    },
    {
      "id": "EXECUTOR-005",
      "role": "executor",
      "objective": "在 PERF-005 独立工作树中实现 PERF-004 Option 1、Option 3、Option 4。保持现有公开命令、任务契约、身份注入、生命周期和 intercom 行为；增加必要测试和可复现性能记录。不得实施 Option 2、5、6 或其他未授权优化，不得提交 Git 操作。",
      "artifact_path": "reports/PERF-005-performance.md",
      "required_capabilities": ["read", "grep", "find", "ls", "bash", "edit", "write", "intercom", "report_to_lead", "blackboard_update"]
    },
    {
      "id": "REVIEW-005",
      "role": "reviewer",
      "objective": "独立复核 PERF-005 Executor 的实现和测量，重跑相关测试与安全诊断，检查等待回退、bootstrap 参数边界、事件序号并发/兼容性、性能证据和范围约束；通过 paired intercom 要求修复并复审，不自行修改生产代码。",
      "artifact_path": "reports/PERF-005-review.md",
      "required_capabilities": ["read", "grep", "find", "ls", "bash", "edit", "write", "intercom", "report_to_lead", "blackboard_update"]
    }
  ],
  "constraints": [
    "只使用 D:/Coding/Harness/Pi-team/pi-team.cmd 这一当前稳定入口；不得使用旧入口或 PERF-003 工作树",
    "base_ref 必须是 master；Lead 在 start 前预创建并验证 pi-team/PERF-005 分支，避免启动器当前未强制 base_ref 而从调用目录 HEAD 派生",
    "Researcher 只读且不运行系统命令；Executor/Reviewer 不提交 commit、stash、reset、checkout、rebase、cleanup",
    "不得读取或推导 Gold、oracle、期望补丁、答案派生范围或评测保留数据",
    "不得修改 GitHub Issue、运行产物归档或与三个目标路径无关的规范文档",
    "基线和结果必须标注观测值、推断或待测，不得伪造性能数字",
    "在 Lead 验收前保持 Executor/Reviewer persistent pair 存活；验收后才允许 reclaim 和 cleanup"
  ]
}
```
