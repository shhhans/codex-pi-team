# EEF-04：任务分类与综合评审

日期：2026-10-22。

## 实现

Coordinator 首次提交 task 时声明 `task_type=non_change|small_change|large_change`，与既有 `planning=direct|plan|review` 分开记录，提交后冻结。分类随版本化工作上下文注入；`base_commit` 同时显式提供给角色。

非变更类允许当前任务目录中的记录、分析和独立验证产物，不允许修改产品代码、测试、配置或模块文档。Validator 审查结果及实际 diff；运行时在 pass 时再次检查基线至交付版本的产品差异，错配必须 blocked，通过现有 Coordinator resolution/Lead 范围决策处理，不能静默改分类。

两种变更类按影响和不确定性区分。Validator 在同一 code_review 工作内先审代码与测试，再检查文档清单；可对明确授权的 Markdown 做对齐，并在同一 code-review-NN.md 中说明修改或无需修改的依据。运行时在 pass 时提交授权 Markdown，绑定精确代码/文档版本并直接创建 delivery 工作；不创建两个独立文档工作或额外报告。Coordinator 在交付时检查验收、版本与未决事项，Lead 仍单独验收、集成和检查共享知识。

保留既有文档元数据结构与最终集成检查。首次 task 提交未声明分类的任务继续旧文档阶段；不迁移已有工作，不删除历史产物。角色卡、技能、工具描述、ADR、AGENTS 和 README 已同步。

提示词同时要求：派单提交成功后不再完整 team_send 转述；按当前报告引用或目录结果读取证据，不猜测历史 junit.xml/probe.mjs；独立日志和探针按需生成；所有过程提交省略 body。必要的只读 Git 核验仍允许。

## 确定性验证

完整入口 `node tests/run-tests.mjs`：103/103 通过，194.930 秒，exit 0。覆盖分类与路线、分类冻结/恢复、非变更错配、文档越权/空索引约束/提交重试、版本漂移、返工、重复提交、旧路线、普通及联合集成和共享知识发布。实际 Pi 扩展加载测试验证了变更类评审可编辑授权 Markdown、非变更类与其他路径不能编辑。

首次沙箱内完整运行因进程观察权限限制停滞，未计为通过；确认并清理该轮假角色后，在允许进程观察的环境完成上述完整运行。日志保存在 EEF-04 成功运行证据目录的 deterministic-tests.log。

## 真实验证

EEF-04 使用此前 EFF-1/2/3 的隔离项目，保持 result=2、现有测试、产品文件不变和当前 epoch 共享知识的验收目标。指令变化先重新 onboarding，再执行 non_change + direct；只将首次任务通知至 Lead delivery 通知计入任务指标。

第一次前置重初始化遇到旧 PID 被无关进程复用，运行时正确拒绝停止；任务尚未开始。失败记录保留在 `.traces/EEF-04-20261022/`。第二次先按 OS start stamp 核实身份，只清除隔离项目中过期的 Validator 登记，保留无关进程；记录在 `.traces/EEF-04-20261022-run02/preflight-process-recovery.json`。这不是框架进程恢复功能的改动。

EEF-04 通过综合评审、Lead 验收与必需集成测试，驱动 exit 0。代码/文档提交均为 `e95a9b7e6765dda70fd991af15888c41e24e3aba`，集成提交为 `98cb21a1490c33618cd39bb5895fd3640fa2590d`。产品文件差异为空，摘要 v3 在 epoch 3 接受并集成后发布，旧版本保留；三个角色 PID 均已停止。

实际工作项只有 task → implementation-1 → code_review-1 → delivery-1；两个独立文档工作项与报告均未生成。Coordinator 未调用 team_send，无工具错误，没有按历史名称猜读 junit.xml/probe.mjs。

## 与 EFF-3 的同口径对比

窗口均为 SQLite 首次任务通知至 Lead delivery 通知。EFF-3 为 05:58:40.075–06:04:54.605 UTC；EEF-04 为 08:33:00.455–08:38:51.803 UTC。响应数和 usage 只取此窗口内的 assistant 记录；不计 onboarding、任务后空闲回复、验收与清理。

| 指标 | EFF-3 | EEF-04 | 变化 |
|---|---:|---:|---:|
| 任务窗口（秒） | 374.530 | 351.348 | -6.2% |
| Coordinator 响应数 | 22 | 10 | -54.5% |
| Coordinator 工具调用 | 42 | 19 | -54.8% |
| Coordinator 输入 token | 99,984 | 55,214 | -44.8% |
| Coordinator 输出 token | 11,799 | 6,080 | -48.5% |
| Coordinator 缓存读取 token | 647,738 | 200,667 | -69.0% |
| Coordinator 响应窗口合计（秒） | 107.871 | 48.808 | -54.8% |
| Executor 响应窗口合计（秒） | 155.379 | 250.316 | +61.1% |
| Validator 响应窗口合计（秒） | 118.246 | 56.148 | -52.5% |
| 三角色响应数 | 43 | 31 | -27.9% |
| 三角色工具调用 | 77 | 51 | -33.8% |
| 三角色输出 token | 27,722 | 17,077 | -38.4% |

“响应窗口”按 assistant message.timestamp 到 entry.timestamp 计算，包括服务等待与生成，不是纯思考时间、CPU 时间或完整角色活动时间。输入和缓存分别统计，不将相加结果解释为唯一内容或费用。单次实测存在 provider 波动、新 epoch 会话与摘要重建影响，不能当作严格受控性能结论；但工作项消失、调用减少和本轮 Coordinator token/耗时下降都有直接证据。

EEF-04 的阶段时间为：Coordinator 准备 23.989 秒、Executor 247.871 秒、Validator 55.265 秒、Coordinator 交付 24.223 秒。Coordinator 的 48.808 秒响应窗口进一步拆为：上下文/历史发现 11.828 秒，task 写作与提交 10.261 秒，派单后空闲回复 2.826 秒，综合评审与实际模块阅读 2.923 秒，delivery/共享知识写作与提交 20.970 秒。没有另写文档复核报告。两份文档写作本身合计 27.167 秒，仍占其响应窗口约 56%。

因此，本轮已实现“先减少 Coordinator 本身开销”的目标；端到端只缩短约 23 秒，与 Executor 响应窗口增加约 95 秒同时发生，不能据此否认 Coordinator 改善，也不能声称整体速度提升了一半。

## 剩余观察与边界

- task.md 为 1334 字符，比 EFF-3 的 1773 更短，但仍超过 1200 上限且未解释超长；delivery 主体 1288 字符，符合 1500 预算。知识节 1115 字符。
- Executor 猜读根目录 group.md，得到 ENOENT；首次 implementation 提交误带仅允许 task 使用的 task_type，被拒绝后 team_read 恢复并成功提交，约增加 21.5 秒恢复窗口。没有绕过校验或丢弃失败记录。
- Executor 的过程提交 body 从 EFF-3 的 3046 字节降为 0；Validator 仍附带 611 字节 body。这表明提示词篇幅与参数约束并未完全遵守，本轮没有用额外状态机或大规模接口重构继续扩张范围。
- 真实 EEF-04 验证的是非变更路径；变更类 Markdown 对齐、权限与联合集成由确定性测试覆盖。本轮没有进行原项目部署、迁移或长期运行验证，也未更换角色模型。

证据目录：`.traces/EEF-04-20261022-run02/`，包含 result.json、comparison.json、visible-call-analysis.json、delivery-review.json、角色原始 trace、SQLite 快照、源码及哈希清单、真实 onboarding 记录与确定性日志。EFF-3 基线来自 `.git/pi-team-verification/eff-3-structured-coordinator/`。原始 trace 仅作为证据保留；对比分析只使用时间、usage 和可见工具调用/回执字段，不引用隐藏推理内容。
