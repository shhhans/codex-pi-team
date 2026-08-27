# PERF-004 Lead 综合报告（集成入口）

## 状态

本报告只读探索，不包含优化实施。任务使用的唯一入口是 `D:/Coding/Harness/Pi-team-INTEGRATE-FLOW-003/pi-team.cmd`，启动时 worktree 基于提交 `45c5077e2391a8bceb3a91efb8c5879ac6998cd8`。`publish`、`validate`、`start` 和 `research` 均成功；没有使用旧入口或旧 PERF-003 运行数据。

任务已完成 Lead 验收：`execution_status=reclaimed, outcome=accepted`。Researcher、Executor、Reviewer 均已交付；Reviewer 发出 `REVIEW_PASS` 并提交独立复核报告。验收证据为 `plans/PERF-004-acceptance.json`。由于交付物仍是未跟踪报告文件，未执行 `cleanup`，以保留本次探索结果。

## 已采集的集成入口基线

- `start` 返回成功，启动链使用 `wt.exe` 的 `powershell.exe -EncodedCommand` 压缩 bootstrap；Executor runtime ready 为 `2026-08-27T03:44:32.683Z`，Reviewer 为 `03:44:34.955Z`，相对 task start `03:44:28.417Z` 分别约 4.3 s、6.5 s。
- Researcher runtime ready 为 `03:44:42.244Z`，相对 `research` 启动约 2.0 s。
- 2026-08-26 20:53:21–20:53:29 PDT 的 5 点采样中，Executor node RSS 192.8–193.0 MiB、33 threads、CPU 1.88–1.92 s、242 handles；Reviewer node RSS 137.3 MiB、33 threads、CPU 0.58 s、233 handles；Researcher node RSS 129.3 MiB、33 threads、CPU 2.27 s、237 handles。
- 以上是角色 node 的观测值，不含 WindowsTerminal 宿主、cmd wrapper、Blackboard MCP 或其他历史任务进程；不能把它们简单相加为 task 总成本。
- Researcher 的静态调查明确没有采集 CPU、内存、进程、I/O、日志或磁盘的实时数值；实时 gap 是事实，不应以推断填充。

## 候选性能对象（按优先级）

### P0：运行租约、健康和重复树

集成 `scripts/pi-team.ps1` 已有 runtime 文件、`runtime_pid`、启动时间比较和 `Assert-NoLiveRoleProcesses`，但仍需验证 state、runtime 文件、Windows 进程树和 BlackBoard 事件在异常退出时的收敛。目标是消除陈旧 PID、重复 resume 和 role 进程泄漏。

测量：对每个 task/role 记录 launcher PID、runtime PID、父子树、session、launch ID、ready/exit 时间；在 role 存活时重复 `resume`、只杀 runtime、PID 复用和 ready 超时作为负向场景。验证标准：重复启动被拒绝、异常退出可见、回收后无 task 后代进程。

### P0：压缩 bootstrap 的端到端参数完整性与启动延迟

集成入口通过 `Start-RoleProcess` 将 payload JSON gzip/base64 后编码为 PowerShell `-EncodedCommand`，再由 bootstrap 设置环境并调用 Pi；这是为修复旧入口长 prompt 边界问题而存在的当前机制。集成运行已证明启动成功，但还没有证明复杂 assignment 的内容完整性。

测量：短 prompt 与含空格、引号、中文、分号、尾部反斜杠的长 prompt，各重复至少 5 次；记录 start→ready p50/p95、首轮有效事件、碎片 turn 数、bootstrap CPU/RSS。验证标准：每角色收到一条完整 assignment；不出现旧入口的拆分或 `The system cannot find the file specified`；启动成功率不低于短 prompt 对照。

### P1：等待 ready 的轮询成本

`Wait-RoleReady` 每 100 ms 读取并 JSON 解析 runtime 文件，最长 60 s；`Start-Task` 对 Executor 和 Reviewer 各等待一次。机制在 `scripts/pi-team.ps1` 的 `Wait-RoleReady` 与 `Launch-Role` 路径中可直接核验。

测量：记录每角色循环次数、runtime 文件读取次数、等待期间 parent PowerShell CPU 和 wall-clock。负向场景为 ready 超时，对照为立即 ready。验证标准：等待超时受控，正常 ready 的 parent CPU/I/O 随 ready 时间近似线性且不产生无界轮询。

### P1：事件日志和 Blackboard 全量重读

集成分支的 `role-events.mjs`、`blackboard-core.mjs` 对 JSONL 事件计算 sequence 时会读取/解析历史内容；snapshot/watch 会重读 state root 中的事件文件。Researcher 将其标为潜在 CPU、I/O、内存和磁盘成本。

测量：事件数 1、10²、10³、10⁴、10⁵ 下测 append、snapshot、watch 的 p50/p95、bytes read、heap delta 和文件大小；负向场景为多任务高频事件，对照为单任务单事件。验证标准：追加和 watch 不随历史事件数呈二次增长，日志保留有界且状态仍可追溯。

### P2：多层进程与资源归因

每个 role 至少经过 WindowsTerminal、PowerShell、Pi CLI/Node；Researcher 还加载 Web Access。角色 node 本身已在本次采样中约 129–193 MiB RSS、33 threads。WindowsTerminal/MCP 宿主必须单独计量，避免把共享宿主成本错误归给一个 task。

测量：做 Executor-only、Executor+Reviewer、再加 Researcher 的阶梯实验，分别记录 task-private RSS 与 shared-host RSS、进程数、threads、handles 和启动延迟。验证标准：每项成本都有明确归属，按 1/2/3 task 扩展时触发可解释的并发预算/backpressure。

### P2：失败回收与状态一致性

`Stop-RoleTree` 在启动异常路径使用 `taskkill /T /F`；需验证它是否会留下 runtime/state/worktree 残余或误杀共享后代。该方案风险中等，收益主要是降低失败重试后的资源泄漏。

测量：注入 ready timeout、第二角色启动失败和 runtime 文件缺失，记录 taskkill 次数、清理 wall-clock、残余 PID、state 文件和可恢复性。验证标准：失败可见、无孤儿、不会把未授权的共享进程作为 task 子树杀掉。

## 排序后的优化建议

| 排名 | 方案 | 收益 | 风险 | 成本 | 预期影响 |
|---:|---|---|---|---|---|
| 1 | 完善 task+role+scope lease、heartbeat、进程树核验和 stale 恢复 | 高 | 高 | 中高 | 减少重复启动、陈旧 PID、异常泄漏和 RSS 峰值 |
| 2 | 为压缩 bootstrap 增加复杂参数端到端 smoke 与首轮消息完整性检查 | 高 | 中 | 中 | 保留修复后的 prompt 边界，同时可量化启动延迟和失败率 |
| 3 | 把 ready 等待改成事件驱动或自适应退避，并保留 60 s 超时 | 中高 | 中 | 中 | 降低等待期间 PowerShell CPU/I/O |
| 4 | 为 JSONL sequence、snapshot/watch 增加增量索引/缓存和轮转策略 | 中高 | 中 | 中高 | 长生命周期任务下稳定 append/watch CPU、I/O 和磁盘 |
| 5 | 对 idle pair、临时 Researcher、Terminal tab 设定有界保活/按需唤醒 | 高 | 中高 | 中高 | 降低长期 idle RSS/threads，但必须保持 review/fix 恢复语义 |
| 6 | 增加按 task/host 的进程、RSS、并发和 pagefile 预算与 backpressure | 中高 | 中 | 中 | 避免资源耗尽后才出现 spawn/VirtualAlloc 失败 |
| 7 | 细化 task-private/shared-host 资源报表与失败回收诊断 | 中 | 低 | 低中 | 提升归因质量和实验可复现性 |

## 可复现实验矩阵

1. 冷启动：从集成入口运行 `publish → validate → start`，记录 start→每个 runtime ready 和首个有效事件。
2. 参数边界：短 prompt vs. 含特殊字符的长 prompt，重复 5 次以上，检查是否只有一条完整 assignment。
3. 角色阶梯：Executor-only、Executor+Reviewer、再加一个 bounded Researcher；每 10 s 采样 2 min 的 RSS/CPU/threads/handles/进程数。
4. 重复 resume：角色存活时调用 `D:/Coding/Harness/Pi-team-INTEGRATE-FLOW-003/pi-team.cmd resume PERF-004`；预期拒绝且进程数不增加。
5. 事件增长：在隔离的只读诊断 harness 中生成不同规模 JSONL，比较 append/snapshot/watch 延迟和 bytes read。
6. 失败回收：仅在专用测试任务中注入启动/ready 失败，记录 taskkill、残余 PID、runtime/state 和 worktree 一致性。

## 验证边界

- 已完成：集成入口发布、契约校验、压缩 bootstrap 启动、三个 runtime readiness、Researcher 静态调查。
- 已完成：Reviewer 独立复核、最终验收和角色进程回收。未执行优化，也未执行 worktree cleanup；交付物保留在 PERF-004 worktree 中。
- 旧 PERF-003 的 prompt 拆分和 `The system cannot find the file specified` 现象只属于旧入口，已明确排除，不能否定集成分支修复。
- 在用户明确授权前，不实施上述任何优化。
