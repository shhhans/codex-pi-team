# Pi Team performance exploration on the integrated entrypoint

```json
{
  "version": 2,
  "task_id": "PERF-004",
  "name": "基于集成入口审阅 Pi Team 启动与运行性能",
  "description": "使用 integrate/pi-team-flow-lifecycle 分支的 pi-team.cmd 作为唯一入口，由 Researcher、Executor、Reviewer 审阅当前 Pi Team 的实现、启动流程和运行行为；在不修改生产代码或配置的前提下采集可复现基线，识别性能对象，并交付按收益、风险、实施成本排序的优化方案及测量方法、预期影响和验证标准。",
  "base_ref": "integrate/pi-team-flow-lifecycle",
  "branch": "pi-team/PERF-004",
  "worktree": "D:/Coding/Harness/Pi-team-PERF-004",
  "in_scope": ["集成分支 pi-team.cmd 与 scripts/pi-team.ps1", "压缩 bootstrap、启动就绪、运行时身份、session、进程树和回收路径", "角色配置、通信扩展、Pi Team state、Blackboard 观测和日志", "已启动 Executor/Reviewer/Researcher 的 CPU、RSS、线程、进程、I/O、空闲生命周期和磁盘基线", "至少一个负向或对照场景", "按收益、风险、实施成本排序的优化建议"],
  "out_of_scope": ["修改生产代码、配置、测试或规范文档", "部署、上线或应用优化", "复用旧入口或旧 PERF-003 的运行数据作为本任务基线", "创建 Scout 或额外未分配子任务", "从 Gold、oracle、期望补丁或答案派生数据推导结论", "单一示例硬编码"],
  "done_criteria": [
    {"id": "C-001", "description": "Researcher 完成 bounded 静态机制调查，明确代码路径、资源类型、事实/推断、可测指标和负向/对照场景。", "owner": "researcher", "artifacts": ["research/PERF-004-static-survey.md"]},
    {"id": "C-002", "description": "Executor 在集成入口启动的角色范围内完成只读运行基线（或记录明确环境限制），并形成候选优化的收益、风险、成本、测量、预期影响和验证标准。", "owner": "executor", "artifacts": ["implementation_notes/PERF-004.md", "reports/PERF-004-performance-options.md"]},
    {"id": "C-003", "description": "Reviewer 独立复核集成入口、基线证据、对照场景、资源回收建议和工作树，确认没有生产代码或配置修改。", "owner": "reviewer", "artifacts": ["reports/PERF-004-review.md"]},
    {"id": "C-004", "description": "交付物包含可按路径和命令复现的实验矩阵，并区分当前观测值、历史背景、推断和待测指标；不实施任何优化。", "owner": "executor", "artifacts": ["reports/PERF-004-performance-options.md"]}
  ],
  "delegations": [
    {"id": "RESEARCH-004", "role": "researcher", "objective": "回答一个 bounded 静态问题：从集成分支的启动器、角色配置、通信扩展和状态存储中识别最多 6 个最可能造成资源浪费的机制；只读、不运行系统命令、不使用 web_search。", "artifact_path": "research/PERF-004-static-survey.md", "required_capabilities": ["read", "grep", "find", "ls", "write"]},
    {"id": "EXECUTOR-004", "role": "executor", "objective": "在集成入口启动的当前 Executor/Reviewer/Researcher 范围内做低扰动只读基线，审阅实现和运行行为，整理排序后的性能优化方案、实施成本、测量方法、预期影响、验证标准和实验矩阵；不修改生产代码或配置。", "artifact_path": "reports/PERF-004-performance-options.md", "required_capabilities": ["read", "grep", "find", "ls", "bash", "write"]},
    {"id": "REVIEW-004", "role": "reviewer", "objective": "独立复核 Executor 的性能探索产物和集成入口实现，重跑安全诊断，检查证据、负向/对照场景、归因边界、零生产变更和资源回收建议，并写出审查记录。", "artifact_path": "reports/PERF-004-review.md", "required_capabilities": ["read", "grep", "find", "ls", "bash", "write"]}
  ],
  "constraints": ["只读探索，禁止编辑生产代码、配置、测试和规范文档", "只能使用 D:/Coding/Harness/Pi-team-INTEGRATE-FLOW-003/pi-team.cmd 启动本任务；不得调用旧入口", "不得把旧 PERF-003 的 prompt 拆分或文件找不到现象当作集成入口结论", "不得伪造未采集的数值，必须标注观测值/推断/待测指标", "基线采集限于已启动角色和安全本地诊断，不额外启动并发角色", "Researcher 不使用 web_search、不运行系统命令、不创建子任务", "Executor/Reviewer 不提交 commit、stash、reset、checkout、cleanup", "在 Lead 验收前保持 Executor/Reviewer pair 资源存活"]
}
```
