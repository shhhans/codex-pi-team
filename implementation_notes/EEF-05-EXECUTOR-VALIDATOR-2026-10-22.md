# Executor / Validator 精简与 EEF-05

## 实施范围

角色提示词重组为职责权限、当前工作、执行步骤、证据与输出、交付、异常恢复六部分。明确 groups/<group>/group.md 路径、先选择正确测试入口、按具体问题进行 Git/历史探索、重复测试需新增理由，保留两角色独立验证。Executor 只提供新事实与来源，不重复共享知识全文。

技能提供 implementation.md 1500 字符和 code-review-NN.md 1800 字符模板（含空白，必要超长说明理由）。过程提交省略 body，提交后只给简短回执。

Pi 扩展按角色注册静态 team_submit schema：Executor onboarding/plan/implementation；Validator onboarding/plan_review/code_review/legacy documentation；Coordinator 保留自身种类。两执行角色不展示 task_type/planning/shared_context，保留 onboarding body 和身份/版本字段。没有改动状态机或服务端授权校验，没有新增工具名。

## 确定性验证

相关测试 43/43 通过；完整套件 103/103 通过，193.042 秒。实际安装的 Pi 扩展加载测试检查各角色种类、字段、onboarding body、权限和恢复。原分类/旧文档/联合集成测试继续通过。

沙箱内首轮相关测试阻塞，核实本轮进程身份后停止，沙箱外重跑通过；初次阻塞不计成功。日志保留在 .traces/eef05-targeted.log、eef05-targeted-escalated.log、eef05-full-tests.log。

## 真实验证

EEF-05 使用既有隔离效率项目与同一角色模型、result=2 目标、non_change + direct 路线。指令变更触发有限 onboarding；任务计时独立于 onboarding。证据目录 .traces/EEF-05-20261022/。结果与对比见下文。

## EEF-05 结果与 EEF-04 对比

真实生命周期通过：task → implementation-1 → code_review-1 → delivery-1，non_change + direct，无额外文档阶段。交付 commit `42ecbe4d01c41331d36033acf952c9f038d59bf6`，隔离项目集成 commit `eb284dc6467834290aa5fd5ffb4fbc57fcbd65a9`，集成测试通过，共享知识 v4 / epoch 4 在接受集成后发布，三个角色停止。源码哈希与运行前快照一致；本仓库仍未提交、未部署。

统计窗口按 SQLite 首个 task 通知至 Lead delivery 通知，onboarding、集成和闲置尾部不计入。EEF-05 为 2026-10-22T09:13:19.682Z–2026-10-22T09:18:34.446Z，314.764 秒；EEF-04 为 351.348 秒，下降 10.4%。准确起止以 result.json 为准。

| 角色 / 指标 | EEF-04 | EEF-05 | 变化 |
|---|---:|---:|---:|
| Executor 响应数 | 13 | 14 | +7.7% |
| Executor 工具调用 | 19 | 16 | -15.8% |
| Executor 输入 token | 17,227 | 32,076 | +86.2% |
| Executor 输出 token | 7,169 | 6,321 | -11.8% |
| Executor 缓存读取 token | 155,456 | 135,616 | -12.8% |
| Executor 响应窗口秒 | 250.316 | 218.594 | -12.7% |
| Validator 响应数 | 8 | 7 | -12.5% |
| Validator 工具调用 | 13 | 11 | -15.4% |
| Validator 输入 token | 35,671 | 26,775 | -24.9% |
| Validator 输出 token | 3,828 | 2,843 | -25.7% |
| Validator 缓存读取 token | 57,600 | 41,472 | -28.0% |
| Validator 响应窗口秒 | 56.148 | 79.751 | +42.0% |

两角色合计输出 10,997 → 9,164（-16.7%），输入 52,898 → 58,851（+11.3%），响应数均为21，工具32 →27。Coordinator 受额外消息影响，响应10 →13，输出6080 →6310（+3.8%），输入55214 →82637（+49.7%），响应窗口48.808 →51.838秒；工具19 →14。不能声称总 token 全面下降。

响应窗口是请求时间到 assistant 记录时间，包括服务等待与生成；不是纯思考或 CPU 时间。输入和缓存读取分开报告，不相加解释为唯一内容或实际费用。单次运行、provider 波动、新 epoch 会话及摘要重建限制因果判断。

## 可见证据与未达标项

- 没有根目录 group.md 猜读、Coordinator 专用参数误用、工具报错或过程提交 body 复制；Executor 和 Validator 均正常提交，未发生 EEF-04 的拒绝恢复。
- implementation.md 为1434字符，code-review-01.md 为941字符，均符合预算。Executor 自写的“overrun”理由并不准确：文件实际没有超过1500；其声称 A3 提案单独超限也不成立。此前运行中对超长的观察应以最终计数纠正。
- Executor 仍先调用 `node tests/run-tests.mjs`，成功后才读取 .pi/project.json，再用绝对 Node 路径运行同一测试；两次 stdout 都是 result=2 verified / EXIT=0，中间没有产品修改。声明执行器提供环境一致性依据，但本可先读取配置选定一次正确命令；该目标未达到。
- Executor 读取上一任务 implementation.md 和提交统计，并写出三条完整共享知识提案；提交后又 team_send 转述，触发 Coordinator read → team_read(detail) → team_send 回复。当前验收 A3 与历史模板仍将其引向共享知识维护，而“仅提供新事实/来源”的提示没有充分改变行为。
- Executor 响应数没有下降，因此计划“两个角色响应数和输出均下降”未完全达标。其可见调用所在响应窗口：初始读/Git22.977秒，首次测试15.593秒，历史发现/读取配置/历史提交81.369秒，再测6.801秒，写报告13.306秒，提交Git18.709秒，team_submit26.861秒，team_send14.204秒，闲置回复18.774秒。此分组只按响应中的可见调用归类，不推断隐藏推理原因。
- Validator 去掉上轮后续 find/ls，独立 oracle 一次，报告/提交精简；但输出减少时耗时反而增加。32.623秒响应包含共享知识读取及测试调用，21.572秒响应用于报告写入；不能据此断言是某个命令耗时或纯思考。
- Coordinator task.md 仍为1375字符，超过原1200且没有理由；delivery 主体1310字符符合预算。这不是本轮新引入的硬限制，也未增加状态机惩罚。

结论：实现与安全/生命周期验证完成；真实效率验证部分达标。工具参数误用与 body 重复改善有直接证据，两角色输出下降，但重复探索/测试和共享知识转述仍在，输入量没有全面下降。若继续优化，优先澄清任务验收 A3 的 Coordinator 归属及提交后消息必要性，再考虑提供明确测试入口；本轮不追加付费重跑或扩大实现范围。

全部 trace 原件、SQLite、源码哈希、onboarding、独立产物副本、comparison.json 与只含可见调用的 visible-call-analysis.json 留在证据目录；无隐藏推理摘录。真实验收仅覆盖非变更路径，变更/旧流程由确定性测试覆盖。
