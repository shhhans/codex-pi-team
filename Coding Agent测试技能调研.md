# **双角色解耦架构下Coding Agent测试专用Skill与规范约束体系研究**

在自主代码智能体（Coding Agent）向工程化生产环境落地的演进过程中，单智能体“边写代码边写测试”的自洽模式已被证实存在严重的确认偏误（Confirmation Bias）与验证盲区1。为了解决这一缺陷，多智能体协同开发逐渐演化为执行者（Executor，专注于功能逻辑构建）与验证者（Validator，专注于测试套件设计）的双角色解耦形态1。在此架构中，双方在编码前通过辩论（Debate）收敛并对齐数据流与接口协议，形成协作的基础边界2。然而，前置协议的达成并不能自动保证 Validator 能够生成高质量的测试代码。实证研究与工业实践表明，若缺乏针对测试行为的确定性规范约束，Validator 极易陷入断言浅薄、契约理解漂移、过度打桩（Over-mocking）乃至测试异味（Test Smells）等失效陷阱4。\
构建一套面向 Validator 的标准化测试约束技能（Skill），将形式化契约校验、测试拓扑分类、反模式过滤以及基于变异的动态评价融为一体，是保障双角色解耦架构具备实质性软件工程质量门禁的关键支撑7。

## **社区现状：Coding Agent专用测试技能与多角色架构演进**

当前开源社区与前沿工程探索中，针对 Coding Agent 测试能力的建设主要呈现三条技术收敛路径：多智能体框架内置的 SOP 角色定义、通用 Agent 平台的标准化 Skill 规范，以及基于模型上下文协议（Model Context Protocol, MCP）的专用测试服务体系9。

### **角色解耦架构的范式转变**

早期多智能体软件工程框架（如 MetaGPT）通过标准化操作规程（SOP）对研发全生命周期进行建模，预置了架构师、工程师以及质量工程师（QaEngineer）等角色3。在 MetaGPT 的默认工作流中，QaEngineer 通过调用 WriteTest 和 RunCode 动作，读取工程实现并生成针对性的 Pytest 代码11。然而，此类测试生成发生在代码产出之后，测试角色往往能直接观察到实现源码，导致其不自觉地拟合现有代码的实现逻辑，难以揭示深层的业务偏差，其 HumanEval 测试生成准确率在 GPT-4 基准下仅维持在 79.3% 左右1。\
针对该局限，AgentCoder 确立了严格的角色隔离与黑盒测试范式，由程序员智能体（Programmer Agent）负责代码编写，测试设计智能体（Test Designer Agent）独立负责测试用例构思，并由测试执行器（Test Executor Agent）在隔离环境中运行验证1。AgentCoder 的核心准则在于 Test Designer 在生成测试时完全屏蔽实现代码，仅依据需求规约进行推演1。该策略在 HumanEval 基准上实现了 89.6% 的测试准确率和 91.7% 的行覆盖率，在大幅压缩通信 Token 开销的同时证明了测试生成过程独立于实现源码的优越性1。

### **平台级Skill规范与渐进式披露**

在执行环境层面，测试规则逐渐从散落的系统提示词转变为具备生命周期管理与触发机制的标准化技能（Skills）。OpenHands 与 Claude Code 均确立了以 SKILL.md 为核心的 AgentSkills 规范9。该规范采用渐进式披露（Progressive Disclosure）设计：在智能体常规推理中仅暴露技能的元数据（名称与匹配描述），只有在匹配到对应路径或任务意图时，才将详尽的操作规程与约束规则动态注入智能体上下文，从而规避了过长提示词带来的上下文稀释与注意力漂移问题9。\
在具体的验证场景中，Claude Code 推出了验证循环（Verification Loops）模式，通过构建独立的分叉子智能体（Forked Sub-agent Context）挂载验证技能，让测试与 Lint 在隔离进程中运行，避免海量测试错误堆栈污染主会话上下文13。OpenHands 则在 SDK 中提供了确定性路径触发规则（Path-Triggered Rules），支持在智能体触碰 tests/ 目录或 API 契约文件时自动挂载验证规约，并结合 OpenTelemetry 标准实现技能运行轨迹的确定性追踪15。

### **MCP生态中的测试基础设施**

模型上下文协议（MCP）的普及进一步促使测试执行逻辑与大模型解耦。unittest-mcp 提供了端到端的单元测试工程支持，其关键设计在于内建了测试代码审查机制（review\_test），当模型尝试对测试用例本身所要验证的目标模块实施 Mock 替换时予以强行拦截，从协议层面遏制了智能体通过“打桩穿透”伪造测试成功的问题4。此外，mcp-test-runner 建立了跨语言测试运行与结构化结果抽取管道，不仅提供安全沙箱指令校验，还可将底层框架的原始输出整理为符合 JSON Schema 的结构化错误对象，极大提升了下游智能体进行错误溯源与自反修复的信噪比12。

## **协议辩论后Validator的失效模式与测试约束瓶颈**

在 Executor 与 Validator 经由前置辩论锁定数据流与接口协议（如 OpenAPI 文档或 Pydantic 模型）后，Validator 若缺乏深层约束，其生成的测试仍会在工程实践中遭遇严重的有效性退化6。

\+---------------------------------------------------------------------------------------------------+\
|               前置辩论阶段收敛的契约 (OpenAPI / Pydantic / Typed Schema / Invariants)             |\
\+---------------------------------------------------------------------------------------------------+\
                                                  |\
                         \+------------------------+------------------------+\
                         |                                                 |\
                         v                                                 v\
    \+-----------------------------------------+       \+-----------------------------------------+\
    |        Executor (功能代码实现)          |       |         Validator (测试代码构建)        |\
    |  目标: 根据契约编写具体业务逻辑         |       |  目标: 基于契约独立构建高强度验证用例   |\
    \+-----------------------------------------+       \+-----------------------------------------+\
                         |                                                 |\
                         |                                                 v\
                         |                               \+-----------------------------------+\
                         |                               |     Validator 常见高危失效模式    |\
                         |                               |  \- 假断言与断言轮盘 (Assertion)   |\
                         |                               |  \- 循环 Mock / 架空被测逻辑       |\
                         |                               |  \- 契约语义漂移 (协议理解幻觉)    |\
                         |                               |  \- 缺少对抗性边界与异常分支       |\
                         |                               \+-----------------------------------+\
                         |                                                 |\
                         \+------------------------+------------------------+\
                                                  |\
                                                  v\
    \+-----------------------------------------------------------------------------------------------+\
    |                        沙箱测试运行器与质量度量门禁 (Gatekeeper Engine)                       |\
    |  \- 契约一致性校验 (Schemathesis / Type Check)                                                 |\
    |  \- 变异测试得分评估 (MutPy / mutmut: 测试是否能杀死人工故障变异体)                            |\
    |  \- 测试异味静态审查 (AST / 规范检测)                                                          |\
    \+-----------------------------------------------------------------------------------------------+

### **契约语义漂移与妥协性容忍**

辩论阶段产出的自然语言或半结构化协议经常面临“表象对齐、实则偏离”的困境3。当 Validator 编写测试时，语言模型的自回归特性可能导致其对边界字段的命名、嵌套层级或默认可选性产生细微幻觉19。更为严重的是，在多轮自修复循环中，若 Executor 的初版实现存在协议违背，Validator 在缺乏强硬契约锁定的情况下，往往会在反馈迭代中主动调整测试预期以迎合错误的实现，形成“实现妥协型漂移”，最终破坏了前置协商的权威性1。

### **测试代码异味与虚假断言**

学术界对大模型生成单元测试的质量分析显示，测试异味（Test Smells）在大模型生成代码中的扩散率甚至高于人工编写的用例5。其中最为典型的是断言轮盘（Assertion Roulette），即在单个测试用例中堆叠大量缺乏描述信息的断言语句，一旦失败无法向 Executor 提供明确的契约违背语义5。此外，模型频繁生成诸如常量参数值、无语义检验（例如仅执行 assert response is not None）或重复断言等浅层用例，虽然在代码统计层面能够提升测试覆盖率，但实际上完全丧失了对内部状态机正确性与业务不变量的探测能力5。

### **过度隔离与被测目标架空**

语言模型在编写单元测试时对 Mock 框架具有高度的依赖偏好4。由于缺乏对测试边界范围的严格感知，Validator 常常会将测试代码直接作用于 Mock 对象，甚至直接将被测类的内部核心计算方法进行打桩替换4。这种测试虽然能在运行期快速通过，但由于代码的核心计算路径从未在测试沙箱中真实执行，导致整个验证流程沦为形式主义4。

### **覆盖率假象与变异存活**

传统的行覆盖率或分支覆盖率已被广泛证明无法作为评估智能体测试充分性的唯一判据7。测试用例只需路过某段代码即可增加行覆盖率，但如果未对该路径引发的副作用或返回值实施严谨的断言，缺陷依然会被遗漏7。在软件工程变异测试（Mutation Testing）实验中，大量拥有较高行覆盖率的 LLM 生成测试套件在面对变异体（Mutants，即对运算符、边界条件做微小恶意修改的人工缺陷代码）时表现出极低的击杀率，反映出测试逻辑未建立真正的对抗性断言能力8。

## **社区现成方案与技术组件能力评估**

针对上述约束挑战，开源社区与工业界在不同层面上提供了具备采用价值的工具组件。评估这些组件在双角色协同架构下的契合度与边界能力，有助于明确技术选型。

| 方案/工具类别 | 具体项目 | 核心机制与治理能力 | 在 Executor-Validator 架构中的适配度与局限 |
| :---- | :---- | :---- | :---- |
| **多智能体框架内置角色** | MetaGPT QaEngineer \[cite: 11\] | 依赖 SOP 解析设计文档，调用 WriteTest 产出源码单测，配合运行环境捕获堆栈以启动自反修复11。 | **中等**。白盒可见源码导致确认偏误严重，缺乏对前置协商契约的刚性比对和反向打桩审查机制1。 |
| **黑盒测试智能体架构** | AgentCoder Test Designer \[cite: 1, 24\] | 严格隔离源码，仅凭需求规格构建基础（Basic）、边界（Edge）与负载（Large Scale）三维用例1。 | **高**。设计理念高度契合黑盒解耦，但原实现为论文实验形态，需封装为生产级 Skill 并补充形式化契约校验1。 |
| **标准化技能平台规范** | OpenHands / Claude Code AgentSkills \[cite: 9, 13\] | 提供包含 Frontmatter 元数据的规范文件（SKILL.md），支持触发拦截、子进程分叉与沙箱隔离9。 | **极高**。是承载测试约束规则的最佳介质，但需要开发者具体编写内部的质量门禁与断言规范13。 |
| **外部测试分析服务** | unittest-mcp \[cite: 4\] | 暴露结构化运行接口，内建针对被测实体的反向 Mock 审查机制（review\_test）与覆盖率报告4。 | **高**。可作为 Validator 调用的标准化外部执行工具，有效阻断模型在测试中实施恶意打桩4。 |
| **契约驱动属性测试工具** | Schemathesis / Hypothesis10 | 基于 OpenAPI/GraphQL 契约自动生成正向、反向（Negative）及有状态链路测试，提供最小重现用例10。 | **极高（必备引擎）**。将双方辩论产出的协议直接转化为自动化对抗测试输入，规避人工编写的数据遗漏10。 |
| **任务契约前置验证器** | agent-task-contract \[cite: 20\] | 本地轻量化验证门禁，静态检查任务定义的验收条件（AC）、输入输出边界及验证命令规范度20。 | **高（前置拦截）**。适合在双方辩论刚结束时充当机器仲裁者，确保协议达到可测试的充分性级别20。 |
| **变异测试与自反框架** | mutmut / MuTAP / MutGen8 | 动态向源码注入语法级变异，以变异杀死得分（Mutation Score）衡量测试充分度，并引导迭代修复8。 | **高（质量终审）**。可作为中立仲裁运行器，迫使 Validator 为存活变异体不断补充强对抗性断言8。 |

## **面向Validator的测试规范Skill架构设计**

为了彻底规范 Validator 的测试行为，不能仅依靠单一维度的提示词技巧，而应构建一套基于 AgentSkills 规范的复合技能——**Contract-Enforced Test Synthesizer（契约增强测试构建技能）**9。该技能应当作为 Validator 唯一遵循的指导规约，深度整合四项核心机制。

### **契约驱动与自动化属性测试机制**

在双角色辩论阶段，双方妥协后的数据流和接口必须以严格的形式化结构落盘（如 Pydantic 数据类、JSON Schema 或 OpenAPI 规范文件）10。Skill 强制要求 Validator 放弃纯手动拼装样例的低效方式，转而以契约为源数据构建属性测试（Property-Based Testing, PBT）10。\
在该机制下，Validator 需利用 Schemathesis 或 Hypothesis 引擎对协商契约进行参数化绑定10。Schemathesis 不仅能够自动推导符合 schema 约束的合法输入实施正向验证，更会主动对 schema 实施变异操作，产生类型错误、必填项缺失、枚举越界等非法载荷，执行针对 Executor 实现的反向测试（Negative Testing）10。这确保了无论 Executor 内部如何编码，其外部接口必须严格响应协议定义的 HTTP 状态码或领域异常，杜绝由于智能体双方私下妥协而放宽系统健壮性要求的可能10。

### **拓扑化测试四维分类规约**

为了避免大模型将注意力过度集中在“基本可用”的 happy path 上，Skill 应当参考 AgentCoder 的分类法，将测试用例强制规整为结构严密的四个象限1：

> 1. **基础契约用例（Basic Contract Cases）**：针对协议标称的数据结构和典型业务流，验证在规范输入下的状态转移与返回值完全匹配，每个公开路径至少包含一个无打桩的基础用例1。\
> 2. **极限与对抗性边界用例（Extreme Edge Cases）**：全面覆盖数据结构中所声明的一切临界条件，包括空容器、单元素集合、字段最大/最小长度、整型溢出边界、特殊浮点数（NaN/Infinity）以及 Unicode 边缘字符等，验证系统的计算稳定性1。\
> 3. **协议违背与异常恢复用例（Negative & Error Cases）**：专门验证在非预期或破坏性输入场景下系统的容错性，明确断言系统必须抛出经双方辩论约定的特定异常类，且错误消息或返回上下文必须符合错误契约规范，严禁静默失败或吞咽异常10。\
> 4. **有状态业务链路用例（Stateful Workflow Cases）**：利用 OpenAPI Links 或状态机模式，测试多步调用的时序一致性（如创建实体、查询验证、部分更新、软删除后再次尝试获取）10。此类用例能够直接捕获单一接口测试无法暴露的跨步状态污染或资源泄露缺陷10。

### **测试代码异味与恶意打桩审查门禁**

借鉴 unittest-mcp 的安全约束思想，Skill 必须对 Validator 输出的测试代码施加严格的静态与动态审查规约4：\
在 Mock 边界方面，Skill 必须明确规定“核心业务单元禁止打桩（Strict No-Mock on UUT）”规则4。所有 Mock 或 Monkeypatch 操作只能被授予外部网络 I/O 适配器、文件系统硬件或随机数生成器；若 Validator 尝试对当前被测模块内的函数或类进行打桩，审查工具将判定该测试无效并触发告警4。\
在代码质量方面，针对大模型极易产生的“断言轮盘”测试异味，规范要求每个断言语句必须显式声明错误上下文字符串，指出预期协议契约与实际执行结果的差异5。此外，测试代码中严禁出现无解释的魔法字面值（Magic Numbers），所有输入和断言标准必须来源于 Fixture 配置或强类型常数定义，确保测试具有高度的自解释性与可维护性5。

### **基于变异得分的闭环质量保证**

由于代码覆盖率容易产生虚假安全感，Skill 规范体系必须在测试运行阶段引入变异测试（Mutation Testing）作为终审标准7。当 Executor 编写完实现代码且 Validator 生成了第一版测试用例后，测试环境首先运行基础测试确保用例全部跑通，随后启动轻量级变异引擎（如 mutmut）8。\
变异引擎通过对 Executor 实现代码进行语法树微调（例如将比较符 \> 变异为 \>=, 颠倒布尔条件判断，或是剔除某条边界语句），产生数十个变异体8。合格的测试用例集必须在变异体运行时触发断言失败（即杀死变异体）8。若测试套件依然全绿通过，说明 Validator 的测试断言不够尖锐，存在“虽然覆盖了该行但根本没有验证该行逻辑”的现象8。系统将把存活变异体（Surviving Mutants）的代码差异与行号反向注入给 Validator，驱使其补充更具区分度的针对性断言用例，直至变异杀死率达到预设阈值（如 85% 以上），完成测试套件的自反增强8。

## **工程落地：规范约束Skill配置与协作流实践**

为实现上述架构，可在智能体工程仓库中按标准化规范固化技能定义，并配合严密的生命周期调度确保规范执行。

### **规范约束技能定义模版**

以下配置展示了针对 Validator 角色的专用技能定义文件。该文件通常固化在 .agents/skills/contract-test-validator/SKILL.md（针对 OpenHands 体系）或 .claude/skills/contract-test-validator/SKILL.md（针对 Claude Code 体系）中，依托平台原生的声明周期进行挂载9。

## **name: contract-test-validator description: "在执行者(Executor)与验证者(Validator)辩论达成协议后，生成高强度、契约严格、无测试异味的单元测试及属性测试套件。适用于编写、重构或审查测试用例任务。" allowed-tools: \[Read, Write, Edit, Bash\]**

# **Validator 契约强化测试构建规范**

## **1\. 契约唯真与隔离准则 (Contract First & Isolation)**

* **绝对契约依赖**：测试构建依据只能是双方辩论固化的 Schema 定义（如 contract.yaml 或 Pydantic 模型）及业务不变量，严禁参考 Executor 的具体源码实现细节。\
* **杜绝实现妥协**：当测试执行失败且属于协议明确规定的逻辑时，严禁修改测试以迁就 Executor 的实现缺陷。\
* **禁止架空被测逻辑**：严禁 Mock/Patch 当前被测目标类或模块的核心方法。Mock 权限仅限于外部不可控网络端点、数据库实体连接与系统时钟。

## **2\. 拓扑四维覆盖规范 (Test Taxonomy)**

测试套件必须包含以下四类清晰命名且职责隔离的测试函数：

* test\_contract\_basic\_\<feature\>：验证标称合法输入的典型业务路径与正确返回值。\
* test\_contract\_edge\_\<feature\>：测试所有边界极限值（包括空值、零值、边界最大值、异常长度串）。\
* test\_contract\_negative\_\<feature\>：传入破坏 schema 约束的畸变数据，显式使用 pytest.raises 断言系统抛出协议约定的业务异常类或错误码。\
* test\_contract\_property\_\<feature\>：采用 Hypothesis 或 Schemathesis 编写属性测试，对关键逻辑的不变量与幂等性实施自动模糊探索。

## **3\. 防异味与代码规范 (Anti-Test-Smell Rules)**

* **显式错误溯源**：所有断言必须具备上下文消息，形如：\
  assert actual \== expected, f"Contract violation on {field}: expected {expected}, got {actual}"\
* **消除空泛断言**：严禁出现 assert result is not None 或 assert True 这类无实质判定力的断言。\
* **禁止未命名魔法值**：测试数据与预期常量必须在模块级常量或 Fixture 中显式赋予业务语义。

## **4\. 运行验证与变异终审 (Mutation Adequacy Loop)**

* 编写完成后运行 pytest \--cov，要求分支覆盖率不低于 85%。\
* 配合运行变异测试（mutmut run）。若报告中存在存活变异体（Surviving Mutants），必须仔细分析该变异逃逸原因，并补充分支断言直至变异体被杀死。

### **协作执行与仲裁流水线设计**

在落地运行中，不能将所有期望寄托于智能体的自律，而必须依靠宿主控制面（Control Plane）对 Executor 与 Validator 实施物理级解耦编排30：\
在**前置协商阶段**，Executor 与 Validator 围绕需求展开辩论，双方收敛后的核心产物被持久化为机器可解析的 contract.yaml 文件与包含明确验收标准的 task\_spec.md3。控制面调用轻量级的 agent-task-contract check 对该契约进行静态完整性检查，确认入参出参边界、异常码及验收条件已完成机器级定义；若契约过于模糊，系统将强制驳回并要求智能体继续细化辩论，杜绝含糊协议流入开发环节20。\
在**双轨开发阶段**，控制面建立严格的上下文沙箱隔离机制1。Executor 分支被授予代码实现目录的读写权限，但禁止访问 tests/ 目录；Validator 分支则加载上述 contract-test-validator 技能，挂载 contract.yaml 作为单向输入，独立生成测试套件，且自始至终无法窥视 Executor 的实现代码，从架构层面根除逻辑共谋和确认偏误1。\
在**仲裁验证阶段**，第三方独立中立沙箱环境加载 Executor 的代码与 Validator 的测试，驱动包含 unittest-mcp 和 Schemathesis 的执行管道4。系统首先运行 Schemathesis 实施自动化正负向契约对抗测试，验证实现是否违背协议规范10；随后运行 Validator 编写的测试集并执行变异测试扫描（mutmut）8。若测试失败或变异得分低于设定门槛，系统不会让双方自由混杂对话，而是将变异报告与断言错误作为结构化指标，分别定向分发给对应智能体进行自反式重构，从而实现高可靠、强约束的自动化软件工程闭环3。

#### **Works cited**

> 1. AgentCoder: Multi-Agent-based Code Generation with Iterative, [https\://www\.alphaxiv.org/abs/2312.13010](https://www.alphaxiv.org/abs/2312.13010)\
> 2. Multi-Agent Software Development: AI-Native Engineering Teams in, [https\://zylos.ai/research/2026-03-09-multi-agent-software-development-ai-native-teams/](https://zylos.ai/research/2026-03-09-multi-agent-software-development-ai-native-teams/)\
> 3. Agentic Code Generation Papers Part 1 \- Medium, [https\://cbarkinozer.medium.com/agentic-code-generation-papers-part-1-05546d0d5d23](https://cbarkinozer.medium.com/agentic-code-generation-papers-part-1-05546d0d5d23)\
> 4. Unit Test MCP \- Visual Studio Marketplace, [https\://marketplace.visualstudio.com/items?itemName=KennethHuang.unittest-mcp](https://marketplace.visualstudio.com/items?itemName=KennethHuang.unittest-mcp)\
> 5. Evaluating Large Language Models in Detecting Test Smells \- arXiv, [https\://arxiv.org/html/2407.19261v2](https://arxiv.org/html/2407.19261v2)\
> 6. Test smells in LLM-Generated Unit Tests. \- arXiv, [https\://arxiv.org/html/2410.10628v1](https://arxiv.org/html/2410.10628v1)\
> 7. Mutation-Guided LLM-based Test Generation at Meta \- arXiv, [https\://arxiv.org/pdf/2501.12862](https://arxiv.org/pdf/2501.12862)\
> 8. Effective Test Generation Using Pre-trained Large Language ... \- arXiv, [https\://arxiv.org/html/2308.16557v1](https://arxiv.org/html/2308.16557v1)\
> 9. Skills Overview \- OpenHands Docs, [https\://docs.openhands.dev/overview/skills](https://docs.openhands.dev/overview/skills)\
> 10. Schemathesis Property-Based API Testing: The 2026 Guide, [https\://qaskills.sh/blog/schemathesis-property-based-api-testing-guide-2026](https://qaskills.sh/blog/schemathesis-property-based-api-testing-guide-2026)\
> 11. Core Multi-Agent Framework | FoundationAgents/MetaGPT \- DeepWiki, [https\://deepwiki.com/FoundationAgents/MetaGPT/2-core-multi-agent-framework](https://deepwiki.com/FoundationAgents/MetaGPT/2-core-multi-agent-framework)\
> 12. GitHub \- privsim/mcp-test-runner, [https\://github.com/privsim/mcp-test-runner](https://github.com/privsim/mcp-test-runner)\
> 13. Custom Slash Commands and Skills \- Claude Certification Guide, [https\://claudecertificationguide.com/learn/3-claude-code-config/3-2-slash-commands-skills](https://claudecertificationguide.com/learn/3-claude-code-config/3-2-slash-commands-skills)\
> 14. AgentCoder: Multi-Agent Code Generation with Effective Testing, [https\://arxiv.org/html/2312.13010v3](https://arxiv.org/html/2312.13010v3)\
> 15. How to Create Effective Agent Skills | Feb 27, 2026 \- OpenHands, [https\://www\.openhands.dev/blog/20260227-creating-effective-agent-skills](https://www.openhands.dev/blog/20260227-creating-effective-agent-skills)\
> 16. Agent Skills & Context \- OpenHands Docs, [https\://docs.openhands.dev/sdk/guides/skill](https://docs.openhands.dev/sdk/guides/skill)\
> 17. Building verification loops in Claude Code with skills, [https\://claude.com/blog/building-verification-loops-in-claude-code-with-skills](https://claude.com/blog/building-verification-loops-in-claude-code-with-skills)\
> 18. How to Evaluate Agent Skills (And Why You Should) \- OpenHands, [https\://www\.openhands.dev/blog/evaluating-agent-skills](https://www.openhands.dev/blog/evaluating-agent-skills)\
> 19. What I learned from building production systems with Claude Code, [https\://www\.reddit.com/r/ClaudeCode/comments/1qmrwap/what\_i\_learned\_from\_building\_production\_systems/](https://www.reddit.com/r/ClaudeCode/comments/1qmrwap/what_i_learned_from_building_production_systems/)\
> 20. manuelsampedro1/agent-task-contract \- GitHub, [https\://github.com/manuelsampedro1/agent-task-contract](https://github.com/manuelsampedro1/agent-task-contract)\
> 21. agent-contracts/WORKFLOW-CONTRACT-SPEC.md at main \- GitHub, [https\://github.com/Skull-boy/agent-contracts/blob/main/WORKFLOW-CONTRACT-SPEC.md](https://github.com/Skull-boy/agent-contracts/blob/main/WORKFLOW-CONTRACT-SPEC.md)\
> 22. The Claude Code Slash Commands I Can't Live Without, [https\://baransel.dev/post/claude-code-slash-commands-i-cant-live-without/](https://baransel.dev/post/claude-code-slash-commands-i-cant-live-without/)\
> 23. Mutation-Guided Unit Test Generation with a Large Language Model, [https\://arxiv.org/html/2506.02954v4](https://arxiv.org/html/2506.02954v4)\
> 24. AgentCoder: multi-agent code generation framework. \- GitHub, [https\://github.com/huangd1999/AgentCoder](https://github.com/huangd1999/AgentCoder)\
> 25. Understanding Data Generation \- Schemathesis \- Read the Docs, [https\://schemathesis.readthedocs.io/en/stable/explanations/data-generation/](https://schemathesis.readthedocs.io/en/stable/explanations/data-generation/)\
> 26. Pytest Integration Tutorial \- Schemathesis, [https\://schemathesis.readthedocs.io/en/stable/tutorials/pytest/](https://schemathesis.readthedocs.io/en/stable/tutorials/pytest/)\
> 27. Schemathesis, [https\://schemathesis.readthedocs.io/](https://schemathesis.readthedocs.io/)\
> 28. Round-Trip Mutation Testing: Translating Code to Natural Language, [https\://arxiv.org/pdf/2607.03223](https://arxiv.org/pdf/2607.03223)\
> 29. \[2503.08182\] Mutation Testing via Iterative Large Language Model, [https\://arxiv.org/abs/2503.08182](https://arxiv.org/abs/2503.08182)\
> 30. The OpenHands Software Agent SDK: A Composable and ... \- arXiv, [https\://arxiv.org/html/2511.03690v1](https://arxiv.org/html/2511.03690v1)\
> 31. GH-600 Masterclass \- SPARQIO, [https\://sparqio.com/gh-600/masterclass/](https://sparqio.com/gh-600/masterclass/)\
> 32. tosin2013/pytest-mcp-server \- GitHub, [https\://github.com/tosin2013/pytest-mcp-server](https://github.com/tosin2013/pytest-mcp-server)