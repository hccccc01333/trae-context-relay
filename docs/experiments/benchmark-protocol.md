# ContextRelay Benchmark 协议 v1

> 状态：**协议与任务已设计，正式数据尚未采集**。  
> 本文档中的指标必须来自真实新会话记录。禁止用估算值、模拟对话或单次演示冒充 Benchmark 结果。

## 1. 研究问题

| 编号 | 问题 | 对应指标 |
| --- | --- | --- |
| RQ1 | 新会话继续开发时，ContextRelay resume 是否比普通 Markdown 摘要产生更少的重复任务？ | `duplicate_task_count` |
| RQ2 | 它是否降低完成任务所需的总 Token 消耗？ | `total_tokens`、`handoff_tokens` |
| RQ3 | 它是否提高决策保留率、减少基于过期信息的错误？ | `decision_retention_rate`、`stale_evidence_errors`、`false_completion_claims` |

预设假设（允许被数据推翻）：

- **H1**：ContextRelay 组的重复任务数低于 Markdown 组，因为它显式记录任务状态历史、决策替代关系和文件证据变化。
- **H2**：ContextRelay 组的总 Token 可能更低，也可能更高。它的交接提示词更长，但如果能减少代码探索、重复实现和错误方向，总成本可能下降。**不预设方向，按实测报告。**
- **H3**：ContextRelay 组的错误完成声明和过期证据错误更少，因为恢复提示词强制区分“声明完成”和“功能验证”。

## 2. 实验设计

### 2.1 两组条件

| 组别 | 新会话开始时收到的交接材料 |
| --- | --- |
| **A：ContextRelay** | 在最新快照上执行 `node dist/cli.js resume` 得到的中文恢复提示词，原样粘贴，不删改 |
| **B：Markdown 摘要** | 由上一会话人工/Agent 编写的一份普通 Markdown 交接摘要，原样粘贴，不删改 |

两组随后收到**完全相同**的任务卡（run-03 使用 [benchmark-tasks/diff-command-v2.md](benchmark-tasks/diff-command-v2.md)，run-01/02 使用 v1）。

### 2.2 公平性约束

1. 使用同一个基线提交、同一份源代码、同一 Node/依赖版本。
2. 两组使用相同的模型、相同的 TRAE 设置、相同的工具权限和相同的最大轮次。
3. 任务卡逐字相同；操作者不得补充“上一会话做了什么”“文件已经变了”等提示。
4. A 组不得额外获得人工口头总结；B 组不得额外获得 ContextRelay 输出。
5. 两份交接材料都来自同一个项目状态，但 **B 是最后一份手工 Markdown 交接，不会随新快照自动更新**；A 的 `resume` 读取最新快照。这是两种工作流的真实差异，不是信息作弊。
6. 每组在独立目录中运行，避免 Git 状态、构建产物和 `.context-relay` 互相污染。
7. 每个条件重复 **3 次**，共 6 次正式运行；A/B 顺序在每轮交替，抵消顺序效应。
8. 运行期间不执行会改变交接材料内容的额外 capture，除非任务卡明确要求。
9. A 组若按恢复提示词要求确认未解决冲突，操作者只能回复固定句子：**“按交接材料中已经记录的状态继续，不要修改历史快照。”** 该回复不算纠偏，但必须在评分表“是否发生额外提示”中记录；不得解释冲突、提供代码线索或替 Agent 做设计决策。B 组不得使用该回复。

### 2.3 场景与数据

基准场景延续 ContextRelay 自身的 v0.3 工作，任务卡要求实现 `context-relay diff` 命令。

快照链准备：

1. **快照 H1（第一次交接）**
   - 目标：完成 v0.3 并实现快照对比命令。
   - 决策：
     - `D1`：快照文件不可变，历史只追加。
     - `D2`：`diff` 复用现有 `SnapshotDelta`，不新增数据库或 schema。
     - `D3`：`diff` 默认只输出 JSON，方便脚本调用。
   - 任务：
     - `T1`：实现冲突检测与任务状态历史 — `done_claimed`。
     - `T2`：实现 v1 → v2 快照迁移 — `done_claimed`。
     - `T3`：实现 `diff` 命令 — `todo`。
   - 下一步：实现 `diff` 命令。
2. **会话中的复核与变更**
   - 复核发现 `T1` 仍有一个边界情况，将 `T1` 改为 `in_progress`。
   - 因人工输出更利于新会话阅读，用显式 `supersedes` 将 `D3` 修订为：
     - `D4`：`diff` 默认输出人类可读摘要，`--json` 为可选模式。
3. **快照 H2（最新交接）**
   - `capture` 产生 `task_reopened` 冲突，并把 `D3` 标记为 `superseded`。
   - A 组使用 H2 的 `resume` 输出。
   - B 组使用从 **H1** 生成的 Markdown 摘要（上一份手工交接），其中仍写着 `D3` 和 `T1 done_claimed`。

> 说明：B 组不是“故意写错的摘要”，而是“最后一次手工更新后没有再同步”的典型 Markdown 交接。E2 消融实验会单独测试仅格式差异。

### 2.4 消融实验（可选，建议至少 1 次）

为区分“最新状态”与“格式/证据”的贡献，增加 E2：

- **A2**：H2 的 ContextRelay resume 输出。
- **B2**：从 H2 重新生成的 Markdown 摘要，包含当前任务状态和所有决策，但不包含：
  - 决策 `status/revision/supersedes`；
  - 任务 `statusHistory`；
  - 冲突记录；
  - 文件 SHA-256 与逐项校验结果。

E2 不替代正式 E1，只用于解释差异来源。

## 3. 指标定义

### 3.1 主要指标

| 指标 | 定义 | 采集方式 |
| --- | --- | --- |
| `duplicate_task_count` | 新会话执行的工作项中，已经由上一会话完成且有代码/测试/文档证据支持的数量 | 将新会话的工具调用和最终改动映射到 H2 的任务清单；重复实现、重复创建同一文件、重复补同一测试都计数 |
| `total_tokens` | 该次会话的输入 Token + 输出 Token | TRAE 会话用量面板/导出；若只能看到字符数，单独记录并注明“近似” |
| `handoff_tokens` | 粘贴的交接材料本身占用的 Token | A：`resume.prompt`；B：Markdown 摘要。按同一 tokenizer 或字符数记录 |

`duplicate_task_count` 的判定必须写清楚对应任务 ID。例如：

```text
duplicate_task_count = 2
- T1：Agent 重新实现了已有 statusHistory 合并逻辑
- T2：Agent 重新写了已存在的 v1→v2 迁移
```

### 3.2 次要指标

| 指标 | 定义 |
| --- | --- |
| `decision_retention_rate` | 新会话正确复述并遵守的 `active` 决策数 / H2 中 `active` 决策总数 |
| `superseded_decision_errors` | 继续执行已被 `superseded` 的旧决策的次数 |
| `stale_evidence_errors` | 基于已变化/缺失文件做出的错误结论次数 |
| `false_completion_claims` | 未运行测试或没有证据却声称“完成/通过”的次数 |
| `human_interventions` | 操作者除粘贴材料外的纠偏次数（应为 0） |
| `turns_to_first_correct_action` | 从任务开始到第一次正确、非重复的代码修改的轮次 |
| `acceptance` | 是否通过任务卡中的验收标准（通过/部分/失败） |
| `wall_clock_seconds` | 从发送任务卡到 Agent 停止的耗时 |

Token 优先级：

1. TRAE 提供的真实 `input_tokens` / `output_tokens`；
2. 只能拿到字符数时，记录 `prompt_chars`、`tool_output_chars`、`assistant_chars`，用统一规则换算并标注 `estimated: true`；
3. 没有任何用量记录时，该次运行标记为 `token_data: unavailable`，不得编造。

## 4. 执行步骤

### 4.1 准备基线

```bash
# 在 ContextRelay 仓库完成 v0.3 提交后
git tag benchmark-v0.3-base
```

为每次运行创建两个独立副本：

```text
.benchmark-runs/
├── run-01/
│   ├── A/
│   ├── B/
│   ├── manifest.json
│   └── scorecard.md
├── run-02/
└── run-03/
```

`.benchmark-runs/` 是本地隐藏工作目录，已加入 `.gitignore`，也不会进入 ContextRelay 的项目目录树。可以用下面的命令自动完成封存基线、H1/H2 捕获、A/B 交接材料和 `benchmark/START.md`：

```bash
node scripts/run-benchmark-session.mjs prepare --run run-03
```

任务卡与 B 组摘要通过 `--task-card` / `--handoff-b` 指定；默认分别使用 `docs/experiments/benchmark-tasks/diff-command-v2.md` 与 `docs/experiments/benchmark-fixtures/arm-b-handoff-v2.md`。脚本拒绝在已有运行目录上重复运行，除非使用 `--force`。它不会执行任何真实会话，也不会填写任何指标。会话结束后用同一脚本的 `verify` 子命令复跑测试并归档结果；B 组没有快照历史时，`verify` 会在临时克隆中捕获 H1/H2 来验证 `diff`。

A 副本保留 H1/H2 快照，因为恢复提示词引用了它们；B 副本只包含源码，**不得包含 A 的 `.context-relay`**。B 组可以在会话中自行创建测试快照。禁止把 A 的快照目录复制给 B，否则 B 可以通过 `resume` 读取 A 的交接材料，控制组会被污染。

### 4.2 生成交接材料

在 A 副本中：

```bash
node dist/cli.js capture --input docs/experiments/benchmark-fixtures/h1.json
# 执行复核变更，再 capture H2
node dist/cli.js capture --input docs/experiments/benchmark-fixtures/h2.json
node dist/cli.js resume > benchmark/arm-a-handoff.txt
```

A 副本保留生成的 H1/H2 快照。在 B 副本中放置从 H1 编写的 `docs/experiments/benchmark-fixtures/arm-b-handoff.md`，复制为 `benchmark/arm-b-handoff.md`；B 副本不包含任何 ContextRelay 快照。两份材料都不得包含任务卡以外的提示。完整步骤见 [benchmark-fixtures/README.md](benchmark-fixtures/README.md)。

### 4.3 运行新会话

1. 新建真实 TRAE 会话（不是当前会话的继续）。
2. 先粘贴对应组的交接材料。
3. 再粘贴任务卡全文。
4. 操作者只做必要的界面操作；不解释、不暗示、不修正。仅当 A 组要求确认未解决冲突时，使用 2.2 中的固定回复，并记录为一次额外提示。
5. 达到以下任一条件停止：
   - 任务卡验收标准全部完成；
   - Agent 主动停止并请求用户；
   - 20 轮工具调用或 30 分钟；
   - 出现无法恢复的环境错误。
6. 导出会话记录、最终 `git diff`、测试输出和 Token 用量。

### 4.4 记录结果

每次运行填写 [benchmark-scorecard.md](benchmark-scorecard.md)，同时保存：

```text
.benchmark-runs/run-01/A/benchmark/
├── arm-a-handoff.txt
├── transcript.md
├── final.diff
├── test-output.txt
└── usage.json
```

B 组使用同名结构（`arm-b-handoff.md`）。原始记录必须保留，不能只保留汇总数字。

## 5. 评分规则

### 5.1 重复任务

只有同时满足以下条件才计为重复任务：

1. H2 中该任务有完成声明；
2. 当前仓库仍存在对应实现或测试；
3. 新会话再次实现了同一能力，而不是仅阅读、验证或修复明确的新缺陷。

“读取已有文件”“运行已有测试”“修复任务卡要求的新问题”不计数。

### 5.2 决策保留

逐条核对 H2 的 `active` 决策：

- 正确复述且实现遵守 → 保留；
- 复述但实现违反 → 不保留；
- 执行 `superseded` 决策 → 额外记一次 `superseded_decision_errors`；
- 完全没有提到但实现恰好符合 → 记为“隐式保留”，在报告中单独列出。

### 5.3 完成声明

只有实际运行测试/命令并报告结果，才可声称完成。以下均计为错误：

- 只根据文件存在声称功能完成；
- 只根据 `done_claimed` 声称测试通过；
- 没有运行 `npm run check` 却写“全部通过”。

## 6. 数据分析

正式报告至少包含：

1. 6 次运行的全部原始指标，不只报告最好一次；
2. 每组的 `duplicate_task_count` 中位数与范围；
3. 每组的 `total_tokens` 中位数与范围，并区分 `handoff_tokens`；
4. 决策保留率、过期证据错误、错误完成声明；
5. 任务验收结果；
6. 对 H1/H2/H3 的明确结论：支持 / 不支持 / 数据不足。

样本只有 3 次/组，不做显著性检验，只做描述性统计。不得把“某次更快”写成“显著提升”。

## 7. 效度威胁

| 威胁 | 影响 | 缓解 |
| --- | --- | --- |
| 模型自身随机性 | 同一条件结果波动 | 每组 3 次，报告中位数与范围 |
| 顺序/疲劳效应 | 后一次更容易 | 交替 A/B 顺序 |
| 交接材料长度不同 | A 输入 Token 更高 | 单独记录 `handoff_tokens`，并做 E2 消融 |
| 操作者暗示 | 污染结果 | 固定任务卡，禁止额外提示，保留完整 transcript |
| A 组冲突确认 | 额外一轮输入 | 只允许固定回复，并在评分表中记录为额外提示 |
| Markdown 摘要质量 | 人为削弱 B | 由同一快照按固定模板生成，模板随协议公开 |
| 任务过于简单 | 两组都不重复 | 选择需要读取 schema、delta、store 和 CLI 的真实任务 |
| Token 计量口径 | 数字不可比 | 所有运行使用同一 TRAE 版本与导出方式；无法获取时标记 unavailable |
| 小样本 | 不能外推 | 只报告本场景结论，不宣称普遍规律 |

## 8. 结果状态

| 项目 | 状态 |
| --- | --- |
| 协议 | 已完成（本文档） |
| 任务卡 | 已完成 v1；run-03 使用 [v2](benchmark-tasks/diff-command-v2.md) |
| 评分表 | 已完成 |
| H1/H2 场景输入 | 已固化为 [benchmark-fixtures](benchmark-fixtures/README.md) |
| 运行目录准备 | `node scripts/run-benchmark-session.mjs prepare --run run-03`（封存基线、生成 arm 与 `benchmark/START.md`）；`verify` 子命令负责复跑测试、为 B 临时捕获快照并归档 |
| 正式运行 | **5 / 6 有效会话**：run-01 A 有效、B 无效；run-02 A/B 有效；run-03 A/B 有效。有效轮次 **2 / 3** |
| E2 消融 | 未开始 |
| 结论 | 无总体结论。run-03 H1 未获支持（两臂均 0 重复任务）、H2 因 Token 不可得无法判定、H3 未获支持（两臂错误数均为 0）；A 决策保留 3/3，B 2/3 |

### 8.1 已运行记录

- **run-01（A→B）**：A 有效（0 重复任务、3/3 决策保留、28 测试通过）；B 无效（任务卡晚于首次实现，且使用了 A 组专用确认句），不计分。
- **run-02（计划 B→A，实际并行，A 于 21:48 先开始）**：A/B 均通过验收；0 重复任务、0 人工干预；A 1211s / 26 测试，B 1381s / 29 测试。
- **run-02 的混杂**：任务卡第 1 节硬性要求“默认中文摘要”，替 B 解决了其摘要中的过期决策；任务卡背景又要求“不要重复实现”。因此 H1（重复任务）与 H2（决策保留）在 run-02 中都不再可判定，只能作为流程与验收数据。
- **run-03（B→A，串行；最后一轮）**：任务卡 v2，无实验暗示、无重复实现禁令。A/B 均通过 `npm run check` 与 4 类错误场景；A 27 测试 / 789s，B 29 测试 / 664s；均 0 重复任务、0 人工干预。默认格式与各自交接材料一致（A `human`，B `json`；B 另有 `--human`）。
- **run-03 决策结果**：A 保留 H2 的 3/3 `active` 决策；B 仅保留 2/3，默认 JSON 属于 H2 已废弃的 `dec_d1c16f14d412`，计 1 次 `superseded_decision_error`。这是 Markdown 摘要未同步造成的过期执行。
- **run-03 假设**：H1 不支持（0 vs 0）；H2 不可判定（Token 不可得）；H3 不支持（0 vs 0 错误声明/过期证据），但 RQ3 的决策保留维度 A 更好。
- **Token**：三次运行的分享页均未提供输入/输出用量，全部标记 `unavailable`，未用字符数估算。run-03 分享页只保留最终摘要，`turns_to_first_correct_action` 无法计算。


> 在正式运行完成前，README、发布说明和演示材料中不得出现“减少 X% Token”“消除重复开发”等量化结论。
