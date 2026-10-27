# ContextRelay

**让 AI Coding Agent 在新会话里恢复“可验证的项目状态”，而不是盲目相信上一段聊天摘要。**

ContextRelay 是一个本地优先的上下文交接与恢复引擎。它为 TRAE 等 AI Coding 工具提供可执行 CLI：用 Git 和文件 SHA-256 证据保存项目状态，并在新会话中区分“已验证 / 已变化 / 缺失 / 无法验证”，再生成一份恢复提示词。

> 当前版本：**v0.2.0**。先跑通 CLI 与 Git 证据闭环；暂不包含 Web UI、向量数据库和云同步。

## 它解决什么问题

长时间开发、对话压缩或新建会话后，Agent 经常：

- 忘记已经做过的技术决策；
- 重复实现已经存在的功能；
- 把“上一会话说完成了”误认为“测试已经通过”；
- 在文件已经变化后继续沿用旧结论；
- 无法说明恢复依据来自哪里。

ContextRelay 的原则是：**上下文可以来自 Agent，但结论必须有证据边界。**

## v0.2 能力

| 能力 | 实现 |
| --- | --- |
| 上下文捕获 | `context-relay capture` 读取 Git、工作区文件、目录树、项目元数据和显式会话信息 |
| 可验证证据 | 文件 SHA-256、Git HEAD/分支/祖先关系/工作区状态 |
| 上下文恢复 | `context-relay resume` 生成差异化校验结果和中文恢复提示词 |
| 增量记忆 | 快照不可变、继承目标与决策、更新任务状态、记录父子差异 |
| 隐私默认值 | 数据仅存本地；排除密钥、隐藏目录、依赖、构建产物和大文件 |
| TRAE 集成 | 项目级 Skill：`.trae/skills/context-relay/SKILL.md`，内含 `/handoff`、`/resume` 工作流 |

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

### 3. 在新会话恢复

```bash
context-relay resume
```

默认输出一份可直接交给新 Agent 的中文恢复提示词，包含：

- 快照 ID、目标、关键决策；
- 文件证据逐项校验结果；
- Git HEAD 关系与提交后变化；
- “声明完成但未验证”的任务；
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
- `node_modules`、`vendor`、`dist`、`build`、`coverage` 等生成目录；
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
│   ├── context.ts         # 决策、任务、下一步增量合并
│   ├── store.ts           # 不可变快照存储
│   ├── render.ts          # Markdown 交接与恢复提示词
│   ├── schema.ts          # Zod 数据模型
│   └── tree.ts            # 受限目录扫描
└── utils/                 # 路径、文本、ID、哈希
tests/                     # 单元测试 + 跨进程 E2E
.trae/skills/context-relay # TRAE 项目级 Skill
```

## TRAE 集成

遵循 TRAE 项目级 Skill 目录：

```text
.trae/skills/context-relay/SKILL.md
```

Skill 内定义了两个命令工作流：

- `/handoff`：收集显式目标、决策、任务和下一步，调用 `capture`；
- `/resume`：调用 `resume`，逐项核验证据后继续开发。

在 TRAE 中触发 `context-relay` Skill 后使用这两个命令；如果当前 TRAE 版本通过自定义命令面板注册斜杠命令，可将同名命令指向该 Skill。Skill 不依赖 TRAE 私有 API。

通过 npm 安装时，Skill 文件也会随包发布（`node_modules/context-relay/.trae/skills/context-relay/SKILL.md`），可复制到目标项目的 `.trae/skills/context-relay/` 下启用。

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
- 首次捕获、跨进程恢复、哈希变化/缺失/不可验证；
- 增量快照、父子差异、Git HEAD 前进与提交文件变化；
- `.context-relay` 不污染 `git status`。

## 路线图

- **v0.2**：CLI + Git 证据 + 跨会话恢复（当前）
- **v0.3**：增量记忆冲突检测、更细的任务证据关联
- **v0.4**：Benchmark 与普通 Markdown 摘要对照实验
- **v1.0**：完整 TRAE Skill 工作流与可视化界面

## 已知限制

- 不读取聊天历史，Agent 必须在交接时显式提供目标和决策；
- 不会对整个仓库做全量哈希：默认证据来自 `--file`/`files`、Git 工作区变更文件以及 `package.json`/lockfile；已提交但未变更的源码需要显式列出才会进入文件证据；
- 在 Git 仓库中运行时会以仓库根为项目根，单仓多项目场景暂未细分；
- `done_claimed` 仅表达声明，不能替代测试或人工验收；
- 快照是线性的，暂不提供跨分支语义检索；
- 恢复提示词当前为中文。

## License

MIT
