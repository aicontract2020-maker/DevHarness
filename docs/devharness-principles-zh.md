# DevHarness 原理、方法论与理论依据

> 本文面向想理解「DevHarness 到底在干什么、为什么这样设计」的读者。  
> 内容综合自本仓库的 `README.md`、`constitution.md`、`docs/product.md`、`docs/architecture.md`、`docs/interaction-model.md`、ADR 0001–0007，以及当前 v0 可执行实现。  
> 最后更新：2026-09-13

---

## 1. 一句话定义

**DevHarness 是一个面向编码智能体（coding agents）的「目标级工程运行时」（goal-oriented engineering runtime）。**

你给它一个软件目标（例如「证明 example-cms 能在 localhost:9000 启动，并用 Cypress 冒烟」），它负责把这条目标跑成一个**可恢复、可观察、以证据为准**的工程过程，最终诚实落在三种结果之一：

1. **带证据的交付**（通常是 PR / Delivery Brief）——验收标准被证明，而不是「模型说做完了」；
2. **明确的阻塞**——缺权限、缺环境、缺证明能力，需要人拍板；
3. **失败裁决**——保留证据与下一步动作，不允许假成功。

它**不是**：

- 又一套 prompt / skill 合集；
- 能自动 merge / deploy 的机器人（v0 明确不做）；
- 假装所有项目都能用同一套测试证明一切的「万能验证器」；
- 把框架代码塞进业务仓库的脚手架。

---

## 2. 接已有项目的三步上手方法论

DevHarness 被设计成 **LLM 自主开发任意项目** 的工程运行时：自己写代码实现功能、做审查与测试、修复出现的 bug。  
它不是「配好环境 + 跑通一次冒烟」就结束的脚手架。

绝大多数接手的仓库 **不是从零开始**。因此在进入「按 goal 开发新功能」之前，上手必须分三步，**顺序不能跳**：

```text
第 1 步  了解项目
   ↓
第 2 步  充分测试，并修复发现的 bug（稳住基线）
   ↓
第 3 步  才根据 goal 自主开发新 feature
```

### 第 1 步 — 了解项目

把项目摸透到「可以安全行动」，而不是只会启动：

- 产品目标与非目标；
- 技术栈、框架、运行时、数据层、认证；
- 架构与主要模块 / 路由域 / 边界；
- 本地配置与启动契约；
- 测试地图（有哪些脚本、各自盖什么、缺口在哪）；
- 环境配置与 **有界能力许可**（安装依赖、启停服务、浏览器、数据库等）。

环境和许可是第 1 步里的前置条件，**不能代替**对目标 / 实现 / 框架的理解。  
「doctor 绿了」或「某条 Cypress 过了」只是信号，不是了解完成的充分条件。

**退出标准：** 有可审计的了解摘要（目标 / 栈 / 模块 / 测试地图）；关键未知已列出；第 2 步所需能力已批准或明确阻塞。

### 第 2 步 — 测试项目并修 bug

在增加新表面积之前，先证明并稳定 **已有行为**：

- 按合理梯子跑项目自己的验证（启动 → 定向单测 → 更广的系统 / 浏览器套件），不要只跑最甜的一条冒烟；
- 把失败分拣为：测试契约 / fixture、环境问题、真实产品 bug；
- 对真实 bug 带着证据修复并回归；
- 只在第 1 步标出的危险缺口上补覆盖 —— 仍是基线加固，不是发明功能。

**退出标准：** 约定的基线套件通过（或失败已分类并有归属）；本轮严重 bug 已修或显式延期；基线稳到做功能时不会陷入「未知腐烂」。

### 第 3 步 — 按 goal 自主开发新功能

只有前两步扎实之后，才接受「增加或改变行为」的产品 goal：对齐（Gate 1）→ 实现 / 审查 / 验证 / 返修 → 交付（Gate 2）。  
若第 1 步了解很薄，或第 2 步基线仍红 / 未知，则 **阻塞第 3 步**。


### 当不能改消费者仓库时

Phase 2 常会撞上 **测试顺序 / 缺 seed**（A 套件假定 B 套件已造好数据）。理想是消费者侧自给自足；若约束是 **只改 DevHarness**：

1. 优先用消费者已安全的全量 verify（例如消费者自己的 `npm run cy:run`）；
2. 否则在 **外部** project 配置 / dogfood 配方里声明有序 `--spec` 或 harness 自有 seed，不要在对话里临时发明跑序；
3. 只有「在声明过的安全配方下仍失败」才按产品 bug 升级。

示例：[example-cms-verification-recipe.md](./dogfood/example-cms-verification-recipe.md)。

### 与当前命令的对应（v0）

| 步骤 | 今日常见表面 |
|---|---|
| 1 | `doctor` / `onboard` / `build`、外部 project harness、Alignment 与能力 TTY、了解摘要 |
| 2 | `verify --execute --attest` 与项目测试命令；以 **基线健康** 为目标的 Goal Run 与修 bug |
| 3 | 验收标准描述 **新** 用户可见行为的 Goal Run；Gate 1 / Gate 2 |

v0 仍不完整（更丰富的证据驱动、完整 live alignment 等仍在路上），但 **方法论已经成立**：不能因为冒烟 verify 通过就跳进第 3 步。

英文对照与反模式见 [existing-project-onboarding-phases.md](./existing-project-onboarding-phases.md)。

---

## 3. 它要解决的问题

编码智能体已经能改文件、跑命令，但开发者仍然要自己完成大部分「工程管理闭环」：

| 人类仍在做的事 | 为什么痛 |
|---|---|
| 澄清意图、划清非目标 | 模型会默默扩大范围 |
| 收集仓库上下文 | 每次聊天都重来，不可恢复 |
| 拆任务、排依赖、并行 | 容易冲突、难审计 |
| 检查进度 | 被长篇叙事淹没 |
| 验证真实行为 | 「测试绿了」≠「用户能用」 |
| 审查与返修 | 不知道信不信 agent 自述 |
| 决定是否可交付 | 缺少可证伪的验收标准 |

现有 skills / 单次 agent session 能改善**单次对话**，但通常没有：

- **跨会话持久的目标状态机**；
- **与具体模型无关的运行时契约**； 
- **把完成与证据绑定的裁决**；
- **只在关键决策打扰人的交互面**。

DevHarness 的产品承诺可以概括为：

> 当我有一个边界清楚的软件结果时，请帮我把它变成一份可信的交付；我只处理真正重要的产品决策与例外。

---

## 4. 核心方法论：五条不变量

这些不变量写在 `constitution.md` / `AGENTS.md` / ADR 里，是理解一切机制的钥匙。

### 3.1 Agent 自述 ≠ 证据（Anti-self-report）

**理论依据：** 软件工程里的「验证 / 确认」（verification & validation）要求对照可观察行为与规格，而不是对照执行者的口头报告。  
把 LLM 的「我已经修好了」当成完成条件，等价于让被测对象自己签发合格证。

因此 DevHarness 规定：

- 完成必须有**按验收标准逐条**的裁决（criterion-level verdict）；
- 每条通过裁决必须引用**可复现证据**（命令回执、截图、日志、数据状态等）；
- 不支持或不可验证的工作必须以 `blocked` / `failed` 诚实结束，**禁止假成功**。

### 3.2 修订绑定的证明（Revision-bound proof）

**理论依据：** 任何测试结果若不能绑定到「当时测的是哪一版代码」，就无法防止「测的是 A、交付的是 B」或事后篡改工件。

因此：

- Goal Run、证据回执、审批、理解声明都绑定到：
  - 仓库身份（repository identity）；
  - **精确的 Git commit（HEAD SHA）**；
  - 已接受的项目声明（`devharness.yaml`）哈希；
  - 完整、未篡改的证据工件。
- 换了 commit、改了配置、破坏了工件 → 旧证据立刻失效或变为过期/陈旧（expired / stale）。

见 ADR 0003：*Receipts are revision-bound execution proof*。

### 3.3 两道人类闸门（Two-gate autonomy）

**理论依据：** 自治系统需要在「结果契约」和「交付信任」两处保留人类权威，中间过程才能真正放手。这类似产品开发里的「范围冻结」与「发布签字」，而不是每一步都人工确认。

默认两道闸门：

| 闸门 | 名称 | 人批准什么 |
|---|---|---|
| Gate 1 | Understanding & Acceptance（理解与验收） | 目标结果、非目标、设计要点、可证伪验收标准、重大风险与假设 |
| Gate 2 | Delivery（交付） | PR/diff、标准裁决、验证证据、独立评审结论、残留风险 |

两闸门之间：规划、组队、实现、协调、验证、返修、评审**默认自治**；只有策略要求或出现实质例外时才打断人。

### 3.4 决策面优先于工件堆（Decision Surface over rich artifacts）

**理论依据：** 可靠自治需要**丰富**的研究/需求/设计/事件/证据工件（给 agent、恢复、审计用）；但若要求人读完全部，就等于把监督负担原样还回去。若只给人看不可追溯的摘要，则信任问题换了个马甲。

因此采用「**后台工件丰富、前台决策极轻**」：

```text
Goal
  → Alignment Brief      （Gate 1）
  → 自治执行
       → Progress Pulse  （只读进度，无需动作）
       → Decision Queue  （仅 1～3 个实质例外）
  → Delivery Brief       （Gate 2）
```

每条用户可见声明必须能追溯到带校验和的源工件；阻塞性不确定不能被摘要「糊弄成 ready」。

见 ADR 0005。

### 3.5 框架 / 消费者分离 + Supervisor 签发（Separation & provenance）

**理论依据：**

- **关注点分离**：运行时（过程）≠ 业务仓库（产品）；把框架塞进业务仓会造成耦合与污染。
- **信任根**：任何能写 JSON 的进程都能伪造「通过回执」。必须有独立的签发者（Supervisor）用密码学签名，且工人进程拿不到私钥。

因此：

- 框架源码、运行时状态、生成的 harness、证据默认都在**消费者仓库之外**；
- 消费者最多持有声明文件 `devharness.yaml`（也可完全外置，用 `--config`）；
- Supervisor（Ed25519）签发审批与可信证据清单；前台 TTY 确认；JSON / pipe / `--yes` 拒绝。

见 ADR 0001、0007。同 OS 用户下的进程隔离尚未完成时，`doctor` 会把 `supervisor-isolation` 标为阻塞——签名解决不了「同用户工人偷读私钥」问题。

---

## 5. 理论与方法论来源（借鉴而不抄产品）

ADR 0002 明确：从三个已验证项目**吸收模式**，而不复制产品。

### 4.1 来自 pstack（工程判断与「完成谓词」）

- 用户提供**结果**与**如何知道做完了**；框架提供工程仪式；
- 用任务形 playbook，而不是一个万能 prompt；
- 为无人值守工作保留可审查决策轨迹；
- 自治工作绑定显式 done predicate 与有界停止条件；
- 先访谈/发现仓库，再问人；
- 生成并执行**项目专用**验证 harness，且先证明 harness 自己；
- **真实行为证明** ≠ CI 绿灯。

### 4.2 来自 Noodle（可检查的调度）

- 每次调度前构造朴素、可检查的调度快照；
- agent 提案 → **确定性校验** → 再派发；
- 显式依赖；仅无冲突阶段并行；
- 写作者用隔离 worktree；集成串行进入目标分支；
- 提供商/模型路由与任务契约分离；
- 完成后/失败后**重新评估计划**，不假设初计划永恒正确。

### 4.3 来自 gstack（确定性行为证据）

- 确定性浏览器控制与可 diff 观察；
- 断言、证据捕获、评审工作流；
- 持久化操作工件。

DevHarness 把这些模式收束成：**目标运行时 + 项目 harness + agent 适配器 + 两闸门 + 证据裁决**。

---

## 6. 系统架构：四层分工

```text
开发者
  │
  ▼
CLI / 评审 UI（Decision Surface）
  │
  ▼
Goal Runtime（目标状态机、事件、策略、预算、闸门）
  │
  ├── Artifact / Event Store（持久、可恢复）
  ├── Planner / Team Coordinator
  ├── Verification & Review Controller
  │
  ▼
Agent Adapter（Codex / Claude / Cursor / …）
  │
  ▼
Portable Project Harness（由 devharness.yaml 编译）
  ├── Platform packs（web / api / cli …）
  ├── 隔离 worktree 与进程生命周期
  ├── build / test / verify
  └── 证据采集
  │
  ▼
Consumer 仓库（只拥有应用代码与测试）
```

| 层级 | 拥有什么 | 不拥有什么 |
|---|---|---|
| Goal Runtime | 过程、状态、策略、闸门 | 具体业务代码 |
| Project Harness | 如何启动/探测/验证**这个**项目 | 模型推理细节 |
| Agent Adapter | 模型与工具差异 | 完成裁决权 |
| Consumer repo | 应用与项目测试 | 框架实现、运行时状态 |

---

## 7. 目标状态机（过程如何推进）

高层状态（见 `docs/architecture.md`）：

```text
Received → Discovering → Clarifying → Researching → Specifying
  → AwaitingScopeApproval（Gate 1）
  → Planning → Staffing → Executing → Verifying ⇄ Repairing
  → Reviewing → PreparingDelivery → AwaitingDeliveryApproval（Gate 2）
  → Completed
任何阶段都可能 → Blocked
```

要点：

- **每次转移都写事件**，更新持久状态；
- 恢复依赖 **事件流 + 工件**，不依赖聊天上下文；
- 人的注意力是显式资源：发布 interaction packet，记录 `attention.requested` / `attention.resolved`；
- 大多数注意力与状态正交；只有闸门或安全执行缺权限时才暂停。

当前 v0 实现里，你已经见到的可执行切片包括：`onboard` / `init` / `doctor` / `build` / `goal` / `advance` / `align` / `answer` / `request-capability` / `approve` / `verify` / `status` / `review` 等。完整状态机的后半段（大规模自治实现与交付）仍在按里程碑推进。

---

## 8. 关键概念词典

### 7.1 Goal Run（目标运行）

一次目标的持久实例：绑定仓库身份、初始/当前 HEAD、目标文本、事件序列、交互包、能力审批、对齐操作等。  
命令：`goal` 创建；`status` 查看；状态存在 `~/.local/state/devharness/...` 下，**不进业务仓**。

### 7.2 `devharness.yaml`（项目声明）

消费者侧的**声明式合同**（也可外置到 `DevHarness/local-projects/<name>/devharness.yaml` + `--config`）：

- `quality.commands`：允许运行的 build/test/lint/launch/verify 命令；
- `harness.services`：启动命令 + HTTP readiness + shutdown；
- `harness.verifications`：验证命令与依赖的服务、warmup；
- `autonomy.required_gates`：默认 `scope` + `delivery`；
- `delivery`：如 GitHub PR。

`init` 生成提案；`build` 编译为**确定性、修订绑定**的 project harness 清单。

### 7.3 Capability（能力 / 权限边界）

不是「打开所有工具」，而是**精确、有过期时间、有风险等级**的授权单元，例如：

- `agent-runtime`：只读分析 agent；
- `service-runtime`：在隔离 worktree 启停服务；
- `dependency-install`：按 lockfile 装依赖；
- `browser-runtime`：真实浏览器 / Cypress / Playwright；
- `network-research`：受控外网研究；
- …

流程：`request-capability` → 前台 TTY `approve` → 带签名的 receipt。  
过期后必须重新申请（你已遇到 `service-runtime is expired`）。

### 7.4 Alignment（对齐）与 Live Alignment

Gate 1 之前要把「理解」做成可审查包：

- 静态理解（`advance`）与实时对齐（`align`）；
- 可能进入 `question-blocked`，用 `answer` 回答 Decision Queue（同样要 TTY 确认）；
- 可能进入 `waiting-agent-authority`，直到 agent 运行权限就位。

### 7.5 Verification receipt（验证回执）

`verify --execute` 在隔离环境执行已声明命令；`--attest` 才把通过结果提升为**可信测试证据**。  
无签名 / 错误修订 / 脏工作树 / 服务未就绪 → 不能晋升 readiness。

### 7.6 Supervisor

固定用户级签发身份；私钥在 `~/.local/state/devharness-supervisor`；工人不应接触。  
`doctor` 在隔离未证明前会报告 `supervisor-isolation` 阻塞。

### 7.7 Claim Ledger（声明账本）

Onboarding 产出的修订绑定理解：区分

`detected` / `documented` / `code-confirmed` / `test-confirmed` / `runtime-observed` / `conflict` / `not-covered` …

领域（frontend / backend / database / security / testing / deployment / automation）**不能**被一个总分糊掉。

---

## 9. 端到端工作流（开发者视角）

```text
1. 指向仓库
   init / onboard / doctor / build
2. 给出一个目标
   goal --goal "..."
3. 阅读 Alignment Brief（紧凑）
4. 只批准缺失的精确边界
   request-capability → approve
5. 让其规划 / 拆分 / 实现 / 验证（自治段）
6. 用证据审查，而不是读模型自白
7. 阅读 Delivery Brief，Gate 2 签字
```

本地开发常用命令形态：

```bash
cd /path/to/DevHarness
npm run devharness -- init --repo /path/to/project
npm run devharness -- doctor --repo /path/to/project --config ./local-projects/.../devharness.yaml
npm run devharness -- build  --repo /path/to/project --config ... --write
npm run devharness -- supervisor-init
npm run devharness -- goal --repo ... --config ... --goal "..."
npm run devharness -- advance|align|answer|request-capability|approve|verify|status ...
```

外置配置原则（你已采用）：  
**业务仓保持干净**；声明放在 `DevHarness/local-projects/<project>/devharness.yaml`。

---

## 10. 与「普通让 Agent 干活」的对比

| 维度 | 普通 Agent 会话 | DevHarness |
|---|---|---|
| 状态 | 聊天上下文，易丢 | 事件流 + 工件，可恢复 |
| 完成标准 | 模型自述 / 绿 CI | 标准级裁决 + 修订绑定证据 |
| 人机交互 | 大量中间确认或完全放飞 | 两闸门 + 例外队列 |
| 权限 | 往往过宽或隐性 | 显式 capability，可过期 |
| 多 Agent | 临时约定 | 契约化角色与隔离 worktree |
| 业务仓 | 易被工具文件污染 | 框架与状态外置 |

---

## 11. 安全与信任模型（简图）

```text
                    ┌─────────────────────────┐
                    │  Supervisor（签发身份）   │
                    │  Ed25519 私钥 / 前台 TTY │
                    └───────────┬─────────────┘
                                │ 签名审批 / 证据清单
          ┌─────────────────────┼─────────────────────┐
          ▼                     ▼                     ▼
   Capability receipt    Alignment answer      Attested verify
          │                     │                     │
          └─────────────► Goal Runtime ◄──────────────┘
                                │
                    不允许工人读取私钥
                    不允许用 boolean 假装已批准
                    不允许用 agent 自述晋升 ready
```

---

## 12. 当前 v0 的诚实边界（结合实操）

理解原理时，也要知道**现在实现到哪**：

1. **本地优先原型**：Node ≥ 22，契约与大量确定性测试已落地；完整远程控制面、自动 merge 不在 v0。
2. **能力驱动执行**：例如 Cypress `verify --execute` 会要求当前有效的 `service-runtime` + `browser-runtime`（以及依赖安装等）；过期必须重批。
3. **Onboarding 发现力有限**：若仓库未被识别为 `web`（例如只有 Cypress、没有 React/Vite 特征），计划里可能**不会自动出现** `browser-runtime`，需要改进 discover 或补声明——这属于「证明深度跟随发现深度」。
4. **Live Alignment 与 CLI 仍在磨合**：问题回答、agent authority、状态投影等路径还在迭代；`doctor` 的 `supervisor-isolation` 会诚实报红。
5. **声明不等于已证明**：写了 `harness.services` readiness URL，只说明「打算如何证明」；真正的 runtime-observed 要等 `verify --execute --attest` 成功。

这些不是对方法论的否定，而是方法论要求的**诚实未完成清单**。

---

## 13. 你可以怎么用这套理论做判断

遇到任何 DevHarness 行为，用四个问题检验：

1. **证据在哪？** 有没有修订绑定、签名回执，还是只有叙述？
2. **权限是否精确？** 这次动作对应哪条 capability？是否过期？
3. **人该不该被打扰？** 是 Gate / 实质例外，还是可逆实现细节？
4. **理解是否分级？** 声称「已知」时，是 detected 还是 runtime-observed？

若四个问题都答得清，你就在按 DevHarness 的设计意图使用它；若系统让你「凭感觉相信模型」，那就是偏离了它的宪法。

---

## 14. 推荐阅读顺序

1. 本文第 1–2 节（定义 + **接已有项目三步上手**）；
2. 本文第 3–4 节（问题与不变量）；
3. `docs/existing-project-onboarding-phases.md`（三步上手英文对照）；
4. `docs/product.md` + `docs/interaction-model.md`（产品与人机边界）；
5. ADR 0001 / 0003 / 0005 / 0006 / 0007（关键决策）；
6. `docs/onboarding-and-understanding.md` + `docs/verification-receipts.md`（上手与证据）；
7. 需要实现细节时再读 `docs/architecture.md` 与 `packages/`。


## 15. 结语

DevHarness 的「方法论」可以压缩成一句更硬的话：

> **把软件目标提升为一等公民；把智能体降级为可替换的执行器；把完成权交给修订绑定的证据与人类闸门。**

它借鉴了自治 agent 调度、项目级验证生成、确定性浏览器证明等前沿实践，但产品中心不是「更聪明的一次对话」，而是**更可信的一段工程过程**。
