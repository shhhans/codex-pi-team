# Issue #3 — Define bounded Executor-to-Researcher delegation

```json
{
  "version": 2,
  "task_id": "ISSUE-003",
  "name": "处理 Issue #3：定义 Executor 向 Researcher 委派 bounded research 的协议",
  "description": "针对 GitHub Issue #3，基于当前 Pi Team 角色、intercom、Researcher 生命周期和 Lead 权限边界，决定并落地 Executor 是否可以向配对 Researcher 发起同任务 bounded research；若允许，定义授权、消息、artifact、冲突、忙碌和越界规则；若禁止，定义 Lead-mediated 替代路径。",
  "base_ref": "develop",
  "branch": "pi-team/ISSUE-003-bounded-research",
  "worktree": "D:/Coding/Harness/Pi-team-ISSUE-003",
  "in_scope": [
    "当前 .pi/agents、.pi/skills、communication policy、intercom 和 Researcher/Executor 生命周期中与同任务 bounded research 相关的规范与实现",
    "Executor、配对 Researcher、Lead 对请求、结果、阻塞和拒绝的权限与可观察性定义",
    "RESEARCH_REQUEST、RESEARCH_RESULT、RESEARCH_BLOCKED 的字段、任务/范围绑定、artifact 所有权、忙碌与冲突处理规则",
    "必要的规范文档、角色说明、通信实现和回归测试，以及 Issue #3 研究、实现、验证和评审制品"
  ],
  "out_of_scope": [
    "扩大 Researcher 的工具权限、引入新的角色或子任务类型",
    "改变 Lead 对任务契约、范围、验收、回收和最终决策的所有权",
    "修改真实 Terminal 行为、窗口生命周期或 Issue #2 的测试隔离修复",
    "Issue #1 的启动提示词边界、Issue #4/5/6/7/8 的独立问题",
    "未由研究证据支持的任意 Executor→Researcher 访问放宽或跨任务委派",
    "读取或推导 Gold、oracle、期望补丁、答案派生范围或评测保留数据",
    "向 GitHub Issue 写入原始 prompt、envelope、audit、主机路径或运行时转储"
  ],
  "done_criteria": [
    {
      "id": "C-001",
      "description": "Researcher 只读梳理当前 Executor、Researcher、Lead、intercom 和 artifact 生命周期，比较允许与禁止两种方案，给出有证据的协议建议、字段约束、授权/范围/冲突规则、负向场景和待测项。",
      "owner": "researcher",
      "artifacts": ["research/ISSUE-003-bounded-research-protocol.md"]
    },
    {
      "id": "C-002",
      "description": "Executor 根据冻结契约和 Researcher 结果落地一个明确且可执行的 Issue #3 协议决定，更新必要的规范/角色/通信实现并增加回归覆盖；Lead 权限、任务绑定、artifact 所有权、忙碌/越界/拒绝语义保持可验证。",
      "owner": "executor",
      "artifacts": ["plans/ISSUE-003-decision.md", "implementation_notes/ISSUE-003.md", "reports/ISSUE-003-verification.md"]
    },
    {
      "id": "C-003",
      "description": "Reviewer 独立复核 Issue #3 的协议决定、授权和范围边界、消息/结果形状、artifact 冲突处理、负向测试及 Lead 可观察性；发现问题时驱动同一 Executor 修复并复审。",
      "owner": "reviewer",
      "artifacts": ["reports/ISSUE-003-review.md"]
    },
    {
      "id": "C-004",
      "description": "Lead 可复现运行完整 tests/run-tests.ps1 和 Issue #3 针对性测试，确认正向与负向通信路径、任务/范围绑定、权限隔离和现有生命周期均通过；没有将跨任务或未授权委派误判为成功。",
      "owner": "executor",
      "artifacts": ["reports/ISSUE-003-verification.md"]
    }
  ],
  "delegations": [
    {
      "id": "RESEARCH-ISSUE-003",
      "role": "researcher",
      "objective": "只读审阅当前 develop 中 .pi/agents、.pi/skills、communication policy、intercom 规则、README 和相关测试，比较允许或禁止 Executor 向配对 Researcher 发起同任务 bounded research 的方案，明确授权、消息字段、artifact 冲突、Lead 观察、忙碌、重复、越界和拒绝处理；不要运行系统命令、不要修改代码、不要创建子任务。",
      "artifact_path": "research/ISSUE-003-bounded-research-protocol.md",
      "required_capabilities": ["read", "grep", "find", "ls", "write", "report_to_lead", "blackboard_update"]
    },
    {
      "id": "EXECUTOR-ISSUE-003",
      "role": "executor",
      "objective": "在独立 worktree 中根据 frozen contract 和 Researcher 结果实现 Issue #3 的明确协议决定，更新必要规范/通信实现和回归测试；严格保持 Lead 权限、任务/范围绑定、artifact 归属和现有角色能力边界。",
      "artifact_path": "reports/ISSUE-003-verification.md",
      "required_capabilities": ["read", "grep", "find", "ls", "bash", "edit", "write", "intercom", "report_to_lead", "blackboard_update"]
    },
    {
      "id": "REVIEW-ISSUE-003",
      "role": "reviewer",
      "objective": "独立复核 Issue #3 的协议和实现，验证 Executor→Researcher 的授权/范围/消息/artifact/Lead 观察边界、正向与负向测试和现有生命周期；发现问题时通过配对 intercom 要求同一 Executor 修复后复审，不自行修改生产代码或规范决定。",
      "artifact_path": "reports/ISSUE-003-review.md",
      "required_capabilities": ["read", "grep", "find", "ls", "bash", "edit", "write", "intercom", "report_to_lead", "blackboard_update"]
    }
  ],
  "constraints": [
    "只使用 D:/Coding/Harness/Pi-team/pi-team.cmd 当前稳定入口；不得使用旧入口或其他任务 worktree",
    "base_ref 必须是 develop；Lead 在 start 前预创建并验证任务分支，避免从调用目录当前 HEAD 派生",
    "Executor/Reviewer 不提交 commit、stash、reset、checkout、rebase 或 cleanup；Lead 验收前保持 persistent pair 存活",
    "Researcher 只读且不运行系统命令；研究结果必须区分观察事实、推断、方案取舍和待测项",
    "所有 Executor→Researcher 请求必须绑定同一 task_id、frozen scope、唯一 artifact 路径和配对身份；不得越权或跨任务",
    "不得读取或推导 Gold、oracle、期望补丁、答案派生范围或评测保留数据",
    "GitHub Issue 只记录 Lead 审核后的精简行为、期望和复现信息，不上传原始 prompt、envelope、audit、主机路径或运行时报告"
  ]
}
```
