# Pi Team performance and resource evaluation

```json
{
  "version": 1,
  "task_id": "PERF-001",
  "name": "评估 Pi team 性能与资源占用",
  "description": "由 Lead 委派 Researcher、Executor、Reviewer，评估多个 Pi agent 并行运行时的性能瓶颈与系统资源占用，并提出可验证的优化方案。",
  "base_ref": "feat/agent-blackboard-mvp",
  "branch": "pi-team/PERF-001",
  "worktree": "D:/Coding/Harness/Pi-team-PERF-001",
  "in_scope": ["CPU 与内存峰值", "进程/线程与并发上限", "I/O 与日志开销", "空闲 agent 生命周期", "调度与轮询", "工作树/缓存占用", "关闭与资源回收策略", "基线测量与对照场景"],
  "out_of_scope": ["未经 Lead 批准直接修改生产配置或代码", "以单一示例硬编码优化结论"],
  "done_criteria": ["Researcher 提供基线与瓶颈证据", "Executor 整理可实施的优化方案或实验脚本", "Reviewer 检查证据、风险、对照场景与资源回收建议", "三角色通过 Pi Team 通信路径向 Lead 汇报"],
  "constraints": ["先做只读评估", "保留可复现测量步骤", "完成前不回收 agent 资源"]
}
```
