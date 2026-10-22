# 通知唤醒与共享知识实施记录

日期：2026-10-22。实施范围为已商定的通知上下文、团队共享知识和按风险选择流程。

## 实现

- 运行时在角色开始工作前注入持久会话消息，使用与 `team_read` 相同的版本化投影。工作卡包含提交 ID、标准路径、轮次、相关任务/评审文件以及精确代码与文档提交。唤醒和处理中途消息不再要求模型固定追加一次 `team_read`。
- 稳定任务契约按版本提供；注入失败恢复上下文游标，消息交付失败仍可重试。`team_read` 保留给缺失信息、拒绝恢复、诊断和 compact 后刷新。仍需读取引用文件，提交仍受身份、工作归属、消息和不可变交付检查约束。
- Coordinator 在初次分发前准备 `task.md`，后续通过消息或已分配的决策文档记录变化。角色续接仍使用自动 compact。
- Coordinator 在 `delivery.md` 的 `## Shared knowledge` 节维护完整、精简的团队共享知识，通过 `shared_context:{mode:"update"}` 提议更新，或通过 `{mode:"reuse",version:N}` 复用当前版本。内容上限为 6000 字符；兼容省略字段的旧调用。
- SQLite 冻结摘要内容、哈希、定义 epoch、来源任务/轮次/文件与代码/文档提交。Lead 在现有验收中检查变更内容；仅接受且成功完成集成后发布版本及集成提交。普通集成和联合集成都支持幂等发布。失败、未完成和被退回的交付不发布；定义 epoch 改变后保留历史，当前摘要需重新建立。
- 通知默认携带摘要引用；角色在相关且版本变化时通过 `team_read shared_context:true` 读取正文。
- 更新 ADR0009、AGENTS、README、三角色提示、私有技能和 Lead 验收工具说明：按具体风险选择 direct/plan/review，额外验证应对应风险、失败或新假设，区分验收要求与建议。独立代码审查、文档对齐/复核及 Lead 验收继续执行。

## 验证

最终确定性 suite：`node tests/run-tests.mjs`，94/94，169.438 秒，exit 0。覆盖通知直接提交、注入失败重试、消息来源、compact 恢复、真实 Pi 扩展加载、摘要冻结/复用校验、旧调用兼容、epoch 历史、集成失败不发布、普通及联合集成发布和重试。后续只整理记录及 live harness 的进程清理，不再更改受测运行时代码。

日志：`.git/pi-team-verification/token-efficiency-final-tests.log`。补充恢复检查日志：`token-efficiency-recovery.log`。随后增加了真实扩展的持久消息/重复上下文断言和 steering 注入失败重试断言，定向复跑通过（1/1，日志 `token-efficiency-extension-final.log`）；运行时代码未再改变。

显式运行 `node tests/live-group-efficiency.mjs`，exit 0：在全新隔离项目中完成真实三角色入组及两个连续 direct 任务，保留同一批角色会话。EFF-1 将数值接口改为 2，经代码审查、文档对齐、Coordinator 复核及 Lead 集成后发布摘要 v1；EFF-2 验证已集成接口并复用 v1，完成同样的审查和集成，摘要仍为 v1。结束后核查三个角色 PID 均已退出。

| 本次运行的观测值 | EFF-1 | EFF-2 |
|---|---:|---:|
| 任务耗时（毫秒） | 453548 | 276957 |
| 模型响应 | 45 | 35 |
| 模型主动 team_read | 3 | 3 |
| 注入/steering 上下文字节 | 9927 | 11363 |
| 模型报告 input token | 111973 | 179713 |
| 模型报告 output token | 25530 | 19637 |
| 模型报告 cacheRead token | 711883 | 1006697 |

计数按持久会话日志的任务前后差值计算，排除入组阶段。字节统计包含持久的 `pi-team-context` 消息及可识别的上下文 steering，不代表网络请求总字节。cacheRead 是流量指标，不等同账户费用。两个任务工作内容不同，没有受控旧版对照；第二次 input/cacheRead 更高，因此本次没有证实总 token 降幅，也没有消除长历史成本。

真实运行启动后补充了摘要的 source_round/source_hash/documentation_commit 及 Lead 通知元数据；这些补充经过最终确定性 suite，未另跑一次完整付费生命周期。上述实际流量只代表该次运行。

## 证据与边界

归档：`.git/pi-team-verification/token-efficiency-20261022/`，包含 result.json、verification.json、SQLite 备份及三角色原始会话/RPC 日志。原隔离项目和固定工作树保留在 `C:/Users/Hans/AppData/Local/Temp/pi-live-efficiency-Cft0RX/`。

本轮未修改原始 Rooster 或先前的隔离集成项目，未做原项目部署、全局配置迁移、push 或长期无人值守验收。框架改动留在当前工作区供审阅；历史收官报告与 project_state.md 保持原有证据边界。
