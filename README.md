# ContextRelay

**让 AI Coding Agent 在新会话里恢复“可验证的项目状态”，而不是盲目相信上一段聊天摘要。**

ContextRelay 是一个本地优先的上下文交接与恢复引擎。它为 TRAE 等 AI Coding 工具提供可执行 CLI：用 Git 和文件 SHA-256 证据保存项目状态，并在新会话中区分“已验证 / 已变化 / 缺失 / 无法验证”，再生成一份恢复提示词。

> 当前版本：**v0.3.0**。在 v0.2 的 CLI + Git 证据闭环上，新增增量记忆冲突检测、任务状态冲突和决策变更追踪；暂不包含 Web UI、向量数据库和云同步。

## 它解决什么问题

长时间开发、对话压缩或新建会话后，Agent 经常：

- 忘记已经做过的技术决策；
- 重复实现已经存在的功能；
- 把“上一会话说完成了”误认为“测试已经通过”；
- 在文件已经变化后继续沿用旧结论；
- 无法说明恢复依据来自哪里。

ContextRelay 的原则是：**上下文可以来自 Agent，但结论必须有证据边界。**

## v0.3 能力

| 能力 | 实现 |
| --- | --- |
| 上下文捕获 | `context-relay capture` 读取 Git、工作区文件、目录树、项目元数据和显式会话信息 |
| 可验证证据 | 文件 SHA-256、Git HEAD/分支/祖先关系/工作区状态 |
| 上下文恢复 | `context-relay resume` 生成差异化校验结果和中文恢复提示词 |
| 增量记忆 | 快照不可变、继承目标与决策、更新任务状态、记录父子差异 |
| 冲突检测 | 任务被重新打开、阻塞任务被声明完成、同摘要不同理由的决策冲突；冲突写入快照并在恢复提示词中强制确认 |
| 任务状态历史 | 每个任务保存 `statusHistory`，恢复时能看到 `todo → done_claimed → in_progress` 等真实变化 |
| 决策变更追踪 | 决策带 `revision` / `status` / `supersedes` / `supersededBy`；只有显式 `supersedes` 才能替代旧决策 |
| 旧快照兼容 | schema v1 快照在读取时自动迁移到 v2，不重写原始文件 |
| 隐私默认值 | 数据仅存本地；排除密钥、隐藏目录、依赖、构建产物和大文件（`.trae/skills/**` 公开能力文件例外） |
| TRAE 集成 | 项目级 Skill：`.trae/skills/context-relay/SKILL.md`；原生命令：`.trae/commands/handoff.prompt.md`、`resume.prompt.md` |

明确不做的事：

- 不自动读取 TRAE 私有聊天历史；
- 不因为文件存在就宣称功能完成；
- 不自动修改、回滚或删除用户源码；
- 不上传快照到云端。

## 快速开始

要求：Node.js 22+、Git（建议 2.30+）。

```bash
npm install
npm run build

# 可选：把 context-relay 命令链接到本地 CLI
npm link
```

如果你的项目已经安装 ContextRelay，直接运行 `context-relay`；在本仓库开发时使用 `node dist/cli.js`。

### 1. 保存一次交接

```bash
context-relay capture \
  --goal "完成用户登录与刷新令牌流程" \
  --decision "令牌只存在 HttpOnly Cookie" \
  --task "实现登录接口" \
  --next "补刷新令牌的失败测试" \
  --note "下次先检查 npm test"
```

主要参数：

| 参数 | 说明 |
| --- | --- |
| `--goal <text>` | 项目/阶段目标；省略时从上一快照继承 |
| `--decision <text>` | 追加关键决策，可重复；历史决策不会被覆盖 |
| `--task <title>` | 追加任务，可重复；默认 `todo`，状态更新使用 `--input` |
| `--next <step>` | 更新下一步，可重复；省略时继承上一快照 |
| `--note <text>` | 追加备注，可重复 |
| `--file <path>` | 额外加入项目相对路径的文件证据，可重复 |
| `--input <file>` | 从 JSON 读取结构化会话信息 |
| `--resolve-conflict <id>` | 在用户明确确认后关闭一个已记录冲突，可重复；未知或已解决的 ID 会报错 |
| `--json` | 输出机器可读结果 |

### 2. 使用结构化输入（推荐给 Agent）

```json
{
  "goal": "完成用户登录与刷新令牌流程",
  "decisions": [
    {
      "summary": "令牌只存在 HttpOnly Cookie",
      "rationale": "避免前端脚本读取令牌"
    }
  ],
  "tasks": [
    {
      "title": "实现登录接口",
      "status": "in_progress",
      "notes": "已写完路由，尚未跑集成测试"
    },
    {
      "title": "实现刷新令牌",
      "status": "todo"
    }
  ],
  "nextSteps": ["补刷新令牌的失败测试"],
  "notes": ["下次先检查 npm test"],
  "files": ["src/auth/session.ts"]
}
```

```bash
context-relay capture --input handoff.json --json
```

任务状态：

- `todo`：未开始
- `in_progress`：进行中
- `blocked`：阻塞
- `done_claimed`（或输入 `done`）：上一会话**声明完成**，但 ContextRelay 不会自动验证功能

### 3. 冲突与决策修订

v0.3 不静默覆盖旧记忆。捕获时会检测并记录以下冲突：

| 场景 | 行为 |
| --- | --- |
| `done_claimed` → `todo` / `in_progress` / `blocked` | 记录 `task_reopened`，保留完整 `statusHistory` |
| `blocked` → `done_claimed` | 记录 `task_completed_from_blocked`，提示缺少解除阻塞的证据 |
| 同一决策摘要、不同理由、未指定 `supersedes` | 记录 `decision_conflict`；旧决策保持 `active`，不新增重复决策 |
| 显式指定 `supersedes` | 旧决策变为 `superseded`；新决策 `revision + 1`，并写入 `supersededBy` 与 delta |
| 指定不存在或已废弃的决策 ID | 捕获失败，要求修正输入 |

修订决策示例：

```json
{
  "decisions": [
    {
      "summary": "快照同时输出 JSON 与 Markdown",
      "rationale": "新 Agent 需要可直接阅读的交接文件",
      "supersedes": "dec_ab12cd34ef56"
    }
  ]
}
```

冲突会继承到后续快照，并在 `resume` 中显示为“未解决冲突（必须先与用户确认）”。工具不会自动裁决冲突。只有用户确认后，才能在下次交接时显式关闭：

```json
{
  "resolvedConflicts": ["conf_ab12cd34ef56"]
}
```

```bash
context-relay capture --resolve-conflict conf_ab12cd34ef56
```

旧快照中的冲突记录和已废弃决策永远不会被改写。

### 4. 在新会话恢复

```bash
context-relay resume
```

默认输出一份可直接交给新 Agent 的中文恢复提示词，包含：

- 快照 ID、目标、当前有效决策和已废弃决策；
- 文件证据逐项校验结果；
- Git HEAD 关系与提交后变化；
- “声明完成但未验证”的任务及其状态历史；
- 未解决冲突（必须逐条向用户确认）；
- 恢复后的第一轮行动约束。

程序化读取：

```bash
context-relay resume --json
```

查看历史快照：

```bash
context-relay list
context-relay list --json
```

恢复指定版本：

```bash
context-relay resume --snapshot <snapshot-id>
```

## 验证语义

ContextRelay 只把两类东西当作证据：

1. **文件证据**：捕获时的路径、大小、修改时间和 SHA-256。快照只保存哈希，不保存文件内容。
2. **Git 证据**：仓库根、分支、HEAD、提交主题、祖先关系、工作区状态和提交间文件变化。

恢复时每个文件会落入四种状态之一：

| 状态 | 含义 |
| --- | --- |
| `verified` | 文件存在，大小与 SHA-256 均与快照一致 |
| `changed` | 文件存在，但内容哈希或大小已变化 |
| `missing` | 快照中的文件已不存在 |
| `unverifiable` | 路径变成目录/符号链接、超过哈希上限、无权限或路径非法 |

**文件哈希一致只证明文件内容未变，不证明测试通过或功能可用。**  
Git 提交只证明版本关系，不证明业务逻辑正确。

## 快照 schema 与迁移

当前快照 `schemaVersion` 为 **2**。v0.2 生成的 v1 快照在读取时会自动补全决策版本、任务状态历史、冲突列表和 delta 新字段，再通过当前 Zod schema 校验；原始 `.json` 文件不会被重写。`resume --snapshot <old-id>` 因此仍可读取历史快照。

## 本地数据与排除规则

```text
.context-relay/
├── .gitignore              # 默认忽略整个私有目录
├── HANDOFF.md              # 最近一次 Markdown 交接
└── snapshots/
    ├── <snapshot-id>.json  # 完整不可变快照
    └── <snapshot-id>.md    # 人类可读交接
```

默认排除：

- `.git`、`.context-relay`、其余隐藏目录和隐藏文件；
- 例外：`.trae/skills/**` 公开能力文件可进入证据，但其下的敏感文件和隐藏子目录仍会被排除；
- 依赖、构建、覆盖率和缓存目录；
- `.env*`、密钥/证书、凭据/秘密目录、数据库文件；
- 超过 **1 MiB** 的单文件；
- 每次最多 **40** 个文件证据；
- 目录树最多 **250** 项、**4** 层；
- `package.json` 只保存脚本名称，不保存脚本命令原文。

快照默认不会被 Git 跟踪。若要共享快照，请先确认快照中不包含敏感路径，再自行调整 `.context-relay/.gitignore`。

## 架构

```text
TRAE Skill (/handoff, /resume)
             │
             ▼
        context-relay CLI
      ┌──────┴───────┐
      ▼              ▼
  capture engine   resume engine
      │              │
      ├── Git reader ├── Git verifier
      ├── file hash  ├── hash comparator
      ├── exclusions ├── evidence summary
      ├── tree scan  └── recovery prompt
      ├── context merge
      └── delta builder
             │
             ▼
   .context-relay/snapshots/*.json + *.md
```

核心引擎不依赖 TRAE 私有 API；TRAE Skill 只是 CLI 的调用约定。详细设计见 [docs/architecture.md](docs/architecture.md)。

```text
src/
├── cli.ts                 # Commander CLI
├── commands/              # capture / resume / list 的人类与 JSON 输出
├── core/
│   ├── capture.ts         # 捕获编排
│   ├── resume.ts          # 校验与恢复编排
│   ├── git.ts             # Git 证据读取/解析
│   ├── evidence.ts        # 证据候选与哈希采集
│   ├── exclusions.ts      # 密钥/依赖/大文件排除策略
│   ├── context.ts         # 决策、任务、下一步增量合并与冲突检测
│   ├── migrations.ts      # v1 快照迁移到当前 schema
│   ├── store.ts           # 不可变快照存储与读取迁移
│   ├── render.ts          # Markdown 交接与恢复提示词
│   ├── schema.ts          # Zod 数据模型
│   └── tree.ts            # 受限目录扫描
└── utils/                 # 路径、文本、ID、哈希
tests/                     # 单元测试 + 跨进程 E2E
.trae/                     # TRAE 原生命令与项目级 Skill
```

## TRAE 集成

同时提供项目级 Skill 和 TRAE 原生命令文件：

```text
.trae/
├── commands/
│   ├── handoff.prompt.md   # /handoff
│   └── resume.prompt.md    # /resume
└── skills/context-relay/
    └── SKILL.md            # 工作流 A/B 与证据边界
```

- `/handoff`：收集显式目标、决策、任务和下一步，调用 `capture`；
- `/resume`：调用 `resume`，逐项核验证据后继续开发。

命令文件使用 TRAE 的 `*.prompt.md` 格式（frontmatter 包含 `name`、`description`、`argument-hint`），正文只引用 Skill 工作流，不复制实现。以项目根目录打开工作区后，TRAE 会从 `.trae/commands/` 加载这些命令；新建聊天后应能在斜杠命令列表中找到它们。如果未出现，重新加载窗口并确认工作区根目录正确。直接描述“保存交接”或“恢复上下文”仍可触发 Skill。两者都不依赖 TRAE 私有 API。

通过 npm 安装时，命令文件与 Skill 也会随包发布（`node_modules/context-relay/.trae/commands/*.prompt.md`、`node_modules/context-relay/.trae/skills/context-relay/SKILL.md`），可复制到目标项目的 `.trae/` 下启用。

`SKILL.md` 位于公开的 `.trae/skills/**` 路径下，可作为文件证据传给 `capture --file` 或结构化 `files`；`.trae` 下的其他配置（如 rules、mcp.json）仍作为隐藏路径排除。

推荐交接流程：

1. Agent 完成一个可描述的开发阶段；
2. 执行 `/handoff`，确认快照 ID 和警告；
3. 关闭当前对话，新建会话；
4. 执行 `/resume`；
5. 检查 Agent 是否保留技术决策、识别已完成工作、避免重复开发；
6. 记录恢复准确率、重复任务数和 Token 消耗，作为后续 Benchmark 数据。

## 开发与验证

```bash
npm run typecheck   # 源码与测试类型检查
npm test            # Vitest 单元测试 + 跨进程 E2E
npm run build       # 编译到 dist/
npm run check       # typecheck + test + build
```

测试覆盖：

- Git porcelain `-z` 解析、重命名、删除与排除路径；
- 文件哈希与超大文件跳过；
- 路径穿越拒绝与敏感目录排除；
- 决策去重、任务状态更新、下一步继承/清空；
- 任务重新打开、阻塞转完成、决策 `supersedes` 与理由冲突；
- v1 → v2 快照迁移，旧快照读取不重写源文件；
- 首次捕获、跨进程恢复、哈希变化/缺失/不可验证；
- 增量快照、父子差异、Git HEAD 前进与提交文件变化；
- 冲突显式解决与未知冲突 ID 报错；
- `.context-relay` 不污染 `git status`。

## 路线图

- **v0.2**：CLI + Git 证据 + 跨会话恢复
- **v0.3**：冲突检测、任务状态历史、决策变更追踪、schema v2 迁移（当前）
- **v0.4**：执行 [Benchmark 协议](docs/experiments/benchmark-protocol.md)，对比 ContextRelay 与 Markdown 摘要的重复任务数和 Token 消耗
- **v1.0**：完整 TRAE Skill 工作流与可视化界面

## 实验记录

- [v0.2 自我 dogfooding](docs/experiments/v0.2-dogfooding.md)：真实仓库快照、跨进程恢复与 TRAE 新会话验证。
- [v0.3 自我 dogfooding](docs/experiments/v0.3-dogfooding.md)：任务重新打开、决策 `supersedes`、冲突恢复提示词与 v1 快照迁移。
- [Benchmark 协议](docs/experiments/benchmark-protocol.md)：ContextRelay vs Markdown 摘要的重复任务数与 Token 对照实验。
- [Benchmark 任务卡](docs/experiments/benchmark-tasks/diff-command.md)：真实新会话任务 `context-relay diff`（v1 用于 run-01/02；[v2](docs/experiments/benchmark-tasks/diff-command-v2.md) 用于 run-03）。
- [Benchmark 评分表](docs/experiments/benchmark-scorecard.md)：每次运行必须保留的原始指标。

> 已完成 2 轮有效 A/B（run-02、run-03）与 run-01 的 1 次有效 A 会话。run-03 的 H1（重复任务）未获支持（两臂均 0）、H2（Token）因用量不可得无法判定、H3 未获支持（两臂错误数均 0）；决策保留 A 3/3、B 2/3。样本仍不足以发布总体量化结论。

## 已知限制

- 不读取聊天历史，Agent 必须在交接时显式提供目标和决策；
- 不会对整个仓库做全量哈希：默认证据来自 `--file`/`files`、Git 工作区变更文件以及 `package.json`/lockfile；已提交但未变更的源码需要显式列出才会进入文件证据；
- 在 Git 仓库中运行时会以仓库根为项目根，单仓多项目场景暂未细分；
- `done_claimed` 仅表达声明，不能替代测试或人工验收；
- 冲突不会自动裁决，必须由用户确认后用 `--resolve-conflict` 或 `resolvedConflicts` 显式关闭；
- TRAE 原生命令依赖当前工作区根目录下的 `.trae/commands/`；文件格式已按本机 TRAE 运行时校验，但不同版本或旧窗口可能需要在重载后才会显示；
- Benchmark 已跑 run-01（B 无效）、run-02（A/B 有效）与 run-03（A/B 有效，任务卡 v2）；run-03 两臂均 0 重复任务、Token 不可得，正式量化结论尚未发布；
- 快照是线性的，暂不提供跨分支语义检索；
- 恢复提示词当前为中文。

## License

MIT
