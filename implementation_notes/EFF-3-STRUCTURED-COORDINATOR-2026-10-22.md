# EFF-3：结构化 Coordinator prompt 与精简文档验证

日期：2026-10-22。

Coordinator 角色卡重组为七部分：职责权限、当前状态、正常任务流程、团队共享知识、工具沟通、异常恢复、输出规范。沿用上一轮加入的 task.md / delivery.md 模板和篇幅预算。本轮未改变运行时代码或角色模型。

## 真实验证

继续使用 EFF-1/EFF-2 的隔离项目 `C:/Users/Hans/AppData/Local/Temp/pi-live-efficiency-Cft0RX/main`。指令版本变化按现有规则触发真实重新入组，definition epoch 从 1 升至 2，旧会话和摘要保留为历史。入组完成后执行 EFF-3：使用既有命令验证 result=2、生产行为不变、文档准确，并提出当前 epoch 的精简共享知识。

任务通过独立代码审查、文档确认、Coordinator 复核、Lead 验收及项目必需集成命令；生产文件差异为空。代码提交 `1debb9d5c413ffda7f6abcceed7d9a31df10c6ca`，集成提交 `72c4d2b225d49e04e1b7fc474737dee717ca78c7`。摘要 v2 在成功集成后发布，来源为 EFF-3、epoch 2；旧 v1 保留。结束后三个角色 PID 均已退出，驱动 exit 0。

## 文档与调用结果

字符数包含空白，delivery 主体不含 Shared knowledge 节。

| 指标 | EFF-2 | EFF-3 |
|---|---:|---:|
| task.md 字符 | 4254 | 1773 |
| delivery.md 总字符 | 6217 | 2372 |
| delivery.md 主体字符 | 4667 | 1459 |
| Coordinator process submit 的 body 字节 | 5538 | 0 |
| Coordinator 响应 / 工具调用 | 16 / 32 | 22 / 42 |
| 全角色响应 / 工具调用 | 34 / 56 | 43 / 77 |
| 全角色 team_read | 3 | 5 |
| input / output / cacheRead | 178686 / 19120 / 954601 | 174882 / 27722 / 871354 |
| 派单到 Lead 交付 | 269.892 秒 | 374.530 秒 |

EFF-3 的 delivery 主体满足 1500 字符预算；task.md 超过 1200 字符预算，且没有说明超出理由。task.md 仍在 Context 重述角色交接流程；delivery 的 Risks 仍重述 Coordinator 没有 shell 的常规能力限制。约束仅部分落实，未修改已冻结的任务证据来美化结果。

Coordinator 三次 process submit 均省略 body，重复提交正文这一项得到改善。但派单之后又通过两条 team_send 向 Executor 转述任务与补充提交范围，共 1951 字节；完整任务转述与 task.md、运行时派单信息重叠。trace 位于 coordinator-session.jsonl 第 74、76 行（05:59:24.458Z、05:59:29.141Z）。

仍有可见返工：Coordinator 第 47、49、58 行猜测 worktree Git 路径时发生三次读取失败；Executor 第 37 行提交缺少 commit 参数被拒绝，随后刷新并重提。这些以及更多读取/验证动作与本轮耗时上升同时发生，不能把整个差值精确归因于某一项动作。

## 解释边界与证据

文档明显缩短：task.md 约减少 58%，delivery 总字符约减少 62%，delivery 主体约减少 69%。本轮整体响应、工具和耗时没有下降。EFF-3 是新 epoch、新会话，任务后重新启动角色进程，并且要重建摘要；EFF-2 使用持续会话并复用摘要，因此时间和 token 不是严格受控对照。不能把篇幅改善直接解释为总成本降低。

本轮不再新增实现改动，也未额外运行框架确定性 suite。隔离任务完成了独立验证和集成测试。

证据目录：`.git/pi-team-verification/eff-3-structured-coordinator/`，包含源指令快照与哈希、重新入组记录、任务阶段时间、文档长度、各角色 usage/工具统计、完整原始会话、SQLite 备份、run.log 和 result.json。分析只采用可见消息、工具调用/结果、时间和 usage 字段。
