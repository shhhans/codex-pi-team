# Issue #11 — Improve intercom transport ergonomics and stale-session recovery

```json
{
  "version": 2,
  "task_id": "ISSUE-011",
  "name": "处理 Issue #11：隐藏 intercom Base64 envelope 并改进 stale session 恢复",
  "description": "针对 GitHub Issue #11，降低 intercom transport envelope 对 agent 工作流的暴露，改进同一 task 配对 peer 的 stale session 重新发现与可恢复诊断，同时保持现有 envelope 兼容性、task/scope/role/peer ACL 和 Lead 观察边界。",
  "base_ref": "develop",
  "branch": "pi-team/ISSUE-011-intercom-envelope-recovery",
  "worktree": "D:/Coding/Harness/Pi-team-ISSUE-011-intercom-envelope-recovery",
  "in_scope": [
    "repo-local intercom policy、extension、role prompt/skill 和相关发送/诊断路径",
    "transport envelope 与 agent-facing 日志之间的摘要、脱敏和兼容适配",
    "同一 task 配对 role 的 stale session 重新发现、目标解析、投递失败和可恢复重试语义",
    "相关通信策略、生命周期、日志和回归测试，以及 Issue #11 的研究、实现、验证和评审 artifact"
  ],
  "out_of_scope": [
    "修改外部 pi-intercom npm 包本身或引入新的网络传输",
    "替换 agent-team/v1 wire envelope、取消 body encoding 校验或破坏现有消息兼容性",
    "扩大 BOUNDED_PEERS、task/scope/role 授权、Lead 权限或 artifact 所有权",
    "修改 Issue #1/#2/#3/#4/#5/#6/#7/#8/#9/#10 的独立决策或实现",
    "读取或推导 Gold、oracle、期望补丁、答案派生范围或评测保留数据",
    "向 GitHub Issue 写入原始 prompt、完整 envelope、audit、主机路径或运行时转储"
  ],
  "done_criteria": [
    {
      "id": "C-001",
      "description": "Researcher 只读比较现有 intercom envelope、agent-facing 输出、peer 解析和 stale session 恢复路径，给出保持 wire 兼容与权限边界的改进建议、风险、负向场景和待测项。",
      "owner": "researcher",
      "artifacts": ["research/ISSUE-011-intercom-envelope-recovery.md"]
    },
    {
      "id": "C-002",
      "description": "Executor 根据冻结契约和 Researcher 结果实现明确方案：正常 agent 工作流不暴露完整 Base64 body；stale session 能按同 task 配对 role 重新发现或返回明确可恢复诊断；现有 envelope 校验、peer ACL、task/scope 绑定和 Lead 观察边界保持可验证，并增加回归覆盖。",
      "owner": "executor",
      "artifacts": ["plans/ISSUE-011-decision.md", "implementation_notes/ISSUE-011.md", "reports/ISSUE-011-verification.md"]
    },
    {
      "id": "C-003",
      "description": "Reviewer 独立复核 Issue #11 的 transport/agent-facing 分层、stale session 恢复、兼容性、日志脱敏、权限边界和负向测试；发现问题时驱动同一 Executor 修复并复审。",
      "owner": "reviewer",
      "artifacts": ["reports/ISSUE-011-review.md"]
    },
    {
      "id": "C-004",
      "description": "Lead 可复现运行完整 tests/run-tests.ps1 和 Issue #11 针对性测试，确认结构化发送、摘要日志、旧 session、重新发现、投递失败/重试、既有 envelope 兼容性、权限隔离和现有生命周期均通过；没有将跨 task 或未授权恢复误判为成功。",
      "owner": "executor",
      "artifacts": ["reports/ISSUE-011-verification.md"]
    }
  ],
  "delegations": [
    {
      "id": "RESEARCH-ISSUE-011",
      "role": "researcher",
      "objective": "只读审阅当前 develop 中 repo-local intercom policy、extensions、role prompts/skills、测试和相关 README/ADR，梳理 Base64 envelope 暴露与 stale session 恢复路径；比较可行方案并明确 wire 兼容、日志摘要、peer 解析、失败重试和权限边界；不要运行系统命令、不要修改代码、不要创建子任务。",
      "artifact_path": "research/ISSUE-011-intercom-envelope-recovery.md",
      "required_capabilities": ["read", "grep", "find", "ls", "write", "report_to_lead", "blackboard_update"]
    },
    {
      "id": "EXECUTOR-ISSUE-011",
      "role": "executor",
      "objective": "在独立 worktree 中根据 frozen contract 和 Researcher 结果实现 Issue #11 的 intercom agent-facing 摘要与 stale session 恢复方案，更新必要的 repo-local 通信实现/规范和回归测试；保持 Lead 权限、task/scope/role/peer 绑定及现有 wire 兼容。",
      "artifact_path": "reports/ISSUE-011-verification.md",
      "required_capabilities": ["read", "grep", "find", "ls", "bash", "edit", "write", "intercom", "report_to_lead", "blackboard_update"]
    },
    {
      "id": "REVIEW-ISSUE-011",
      "role": "reviewer",
      "objective": "独立复核 Issue #11 的实现和协议边界，验证 Base64 body 不再污染正常 agent-facing 诊断、stale session 恢复不会越权、wire envelope 和现有生命周期保持兼容；发现问题时通过配对 intercom 要求同一 Executor 修复后复审，不自行修改生产代码或规范决定。",
      "artifact_path": "reports/ISSUE-011-review.md",
      "required_capabilities": ["read", "grep", "find", "ls", "bash", "edit", "write", "intercom", "report_to_lead", "blackboard_update"]
    }
  ],
  "constraints": [
    "只使用 D:/Coding/Harness/Pi-team/pi-team.cmd 当前稳定入口；不得使用旧入口或其他任务 worktree",
    "base_ref 必须是 develop；Lead 在 start 前预创建并验证任务分支，避免从调用目录当前 HEAD 派生",
    "Executor/Reviewer 不提交 commit、stash、reset、checkout、rebase 或 cleanup；Lead 验收前保持 persistent pair 存活",
    "Researcher 只读且不运行系统命令；研究结果必须区分观察事实、推断、方案取舍和待测项",
    "所有恢复和发送路径必须保持同一 task、scope、role、配对 peer 与 envelope 校验；不得通过日志摘要或重试绕过授权",
    "不得读取或推导 Gold、oracle、期望补丁、答案派生范围或评测保留数据",
    "GitHub Issue 只记录 Lead 审核后的精简行为、期望和复现信息，不上传原始 prompt、envelope、audit、主机路径或运行时报告"
  ]
}
```
