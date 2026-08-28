# Fix repeated empty terminals in the Pi Team test suite

```json
{
  "version": 2,
  "task_id": "FIX-001",
  "name": "修复 Issue #2：测试运行时弹出空 Terminal",
  "description": "针对 GitHub Issue #2，定位并修复 Pi Team 测试套件在正常执行时频繁弹出空 Terminal 的问题。修复应优先作用于测试替身和测试进程生命周期，不改变真实角色 Terminal 的可见行为；验证测试过程无不必要的可见窗口、无残留进程，并保持现有测试语义和生产启动契约。",
  "base_ref": "master",
  "branch": "pi-team/FIX-001-issue-2-empty-terminals",
  "worktree": "D:/Coding/Harness/Pi-team-FIX-001",
  "in_scope": [
    "tests/run-tests.ps1 和 tests/team-contract.test.mjs 的测试进程启动与 fake WT/fake Pi 生命周期",
    "与 Issue #2 直接相关的 Start-RoleProcess 测试替身、窗口可见性和清理路径",
    "必要的测试断言、诊断记录和最小测试辅助文件",
    "通过现有测试和受控 process/window 诊断证明修复效果"
  ],
  "out_of_scope": [
    "改变真实 wt.exe 角色 Terminal 的产品行为",
    "PERF-005 的 Wait-RoleReady、bootstrap 编码或事件序号优化",
    "重新设计 Pi Team 生命周期、Blackboard 或 intercom 协议",
    "无关测试失败、旧任务清理或 GitHub Issue #3",
    "从 Gold、oracle、期望补丁或答案派生数据推导实现或验收",
    "只通过隐藏所有真实生产窗口来掩盖测试问题"
  ],
  "done_criteria": [
    {
      "id": "C-001",
      "description": "Researcher 只读确认可见窗口的实际触发路径，区分 run-tests.ps1 包装器、team-contract 测试、fake launcher 和真实 wt.exe，并给出负向/对照场景。",
      "owner": "researcher",
      "artifacts": ["research/FIX-001-window-path.md"]
    },
    {
      "id": "C-002",
      "description": "Executor 实现最小测试侧修复，保持测试覆盖的启动、research、resume、超时和参数边界语义；测试执行不再产生不必要的可见 Terminal 或残留 fake launcher 进程。",
      "owner": "executor",
      "artifacts": ["implementation_notes/FIX-001.md", "reports/FIX-001-verification.md"]
    },
    {
      "id": "C-003",
      "description": "Reviewer 独立复核 Issue #2 根因、修复 diff、测试结果、窗口/进程对照证据，并确认真实 wt.exe 的产品行为没有被测试修复误改。",
      "owner": "reviewer",
      "artifacts": ["reports/FIX-001-review.md"]
    },
    {
      "id": "C-004",
      "description": "Lead 可复现验证：tests/run-tests.ps1 通过；测试期间 fake launcher 使用无窗口或等价隔离方式；测试结束后无该测试新增的残留窗口/进程；真实启动路径的窗口可见性测试或静态证据保持原契约。",
      "owner": "executor",
      "artifacts": ["reports/FIX-001-verification.md"]
    }
  ],
  "delegations": [
    {
      "id": "RESEARCH-FIX-001",
      "role": "researcher",
      "objective": "只读审阅 Issue #2 涉及的 tests/run-tests.ps1、tests/team-contract.test.mjs 和 scripts/pi-team.ps1，确定哪些测试调用会创建可见 console/window，给出最小安全测试侧修复建议、对照场景和验证命令；不运行系统命令、不使用 web_search、不创建子任务。",
      "artifact_path": "research/FIX-001-window-path.md",
      "required_capabilities": ["read", "grep", "find", "ls", "write", "report_to_lead", "blackboard_update"]
    },
    {
      "id": "EXECUTOR-FIX-001",
      "role": "executor",
      "objective": "修复 GitHub Issue #2 的测试窗口问题。优先修改 fake launcher/test process 的可见性和清理，禁止通过隐藏真实 wt.exe 或改变生产角色窗口契约来掩盖问题；增加必要断言和验证记录，完成后报告给 Lead 并交 Reviewer。",
      "artifact_path": "reports/FIX-001-verification.md",
      "required_capabilities": ["read", "grep", "find", "ls", "bash", "edit", "write", "intercom", "report_to_lead", "blackboard_update"]
    },
    {
      "id": "REVIEW-FIX-001",
      "role": "reviewer",
      "objective": "独立复核 Issue #2 的测试侧修复，检查实际窗口/进程证据、现有测试语义、失败清理和真实 wt.exe 行为边界；发现问题时要求同一 Executor 修复后复审。",
      "artifact_path": "reports/FIX-001-review.md",
      "required_capabilities": ["read", "grep", "find", "ls", "bash", "edit", "write", "intercom", "report_to_lead", "blackboard_update"]
    }
  ],
  "constraints": [
    "只使用 D:/Coding/Harness/Pi-team/pi-team.cmd 当前稳定入口，不使用旧入口或 PERF-003 工作树",
    "base_ref 必须是 master；Lead 在 start 前预创建并验证任务分支，避免从调用目录 HEAD 派生",
    "修复必须保持真实 wt.exe 角色 Terminal 的产品可见行为不变",
    "Executor/Reviewer 不提交 commit、stash、reset、checkout、rebase、cleanup；Lead 验收前保持 pair 存活",
    "不读取或推导 Gold、oracle、期望补丁、答案派生范围或评测保留数据",
    "测试证据区分观测值、推断和待测，不伪造窗口或进程数据",
    "运行报告和原始进程/主机细节不进入 GitHub Issue；Issue 只保留已提交的摘要和必要证据"
  ]
}
```
