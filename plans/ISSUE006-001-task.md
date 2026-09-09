# Issue #6 retry — Blackboard update discipline

```json
{
  "version": 3,
  "task_id": "ISSUE006-001",
  "name": "处理 GitHub Issue #6：完善 Pi Agent Blackboard 生命周期更新",
  "objective": "让 Pi Agent 在关键生命周期节点和长时间工作期间持续发布有意义、可验证的 Blackboard 状态、进度、下一步与阻塞信息，同时保持 Blackboard 仅为观察面而非控制总线。",
  "context": [
    "GitHub Issue #6 报告 Agent 状态、进度、下一步和阻塞信息可能长时间不更新，导致 Lead 依据过期状态进行干预、复核和验收。",
    "此前 ISSUE-006 任务因 Pi compression 单位 bug 在首次工具调用后中止；该底层问题已在 develop 修复，本任务应验证修复后的 Pi Team 并继续处理原 Issue #6。",
    "当前 Pi Team 已有 blackboard_update 工具和状态事件；本任务应基于现有角色、扩展、launcher、Blackboard server 与测试补足协议和执行约束。"
  ],
  "base_ref": "develop",
  "branch": "pi-team/ISSUE006-001-blackboard-update",
  "worktree": "D:/Coding/Harness/Pi-team-ISSUE006-001",
  "acceptance": [
    "现有三个活动角色的 Blackboard 更新协议明确规定开始 slice、关键进展、阻塞、完成或等待新指令等可观察节点，并要求事件包含事实、下一步和阻塞信息的适当语义。",
    "实现或运行时约束能让上述生命周期节点产生可验证事件；长时间工作路径有合理的有意义进度更新，不以无意义高频心跳替代进展。",
    "新增正向和负向回归测试，证明阻塞与完成状态可被 Lead 观察，且 Blackboard 更新不会获得任务控制、验收或通信总线权限。",
    "完整测试集通过，Reviewer 独立复核实现范围、事件证据、角色边界和既有 Pi Team 生命周期没有回归。"
  ],
  "deliverables": [
    "implementation notes",
    "regression tests",
    "review and verification reports"
  ]
}
```
