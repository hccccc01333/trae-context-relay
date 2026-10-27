# Benchmark Fixtures

这些文件把 [Benchmark 协议](../benchmark-protocol.md) 中的 H1/H2 场景固化为可执行输入。

| 文件 | 用途 |
| --- | --- |
| `h1.json` | 第一次交接：v0.3 核心完成，`diff` 待实现，旧决策要求默认 JSON |
| `h2.json` | 复核交接：重开冲突检测任务，并用 `supersedes` 把默认输出改为人类可读 |
| `arm-b-handoff.md` | B 组使用的普通 Markdown 摘要，来自 H1；不会随 H2 更新 |
| `arm-b-handoff-v2.md` | run-03 的 B 组摘要：H1 过期决策改为“默认 JSON，`--human` 输出人类摘要”，只与 H2 的默认格式冲突 |

## 自动准备

在已提交的干净工作区运行：

```bash
node scripts/run-benchmark-session.mjs prepare --run run-03
```

脚本会从 `benchmark-v0.3-base` 生成封存基线，在 `.benchmark-runs/run-03/` 下创建独立的 A/B 副本、H1/H2 快照、两份交接材料与 `benchmark/START.md`，并写入 `manifest.json`（含任务卡/B 摘要的路径与哈希）。它不会执行任何 TRAE 会话，也不会填写指标；正式数据仍需人工运行。需要重建时使用 `--force`。

下面是手工复现步骤，用于审计脚本行为或排查 fixture。

## 可复现步骤

1. 在基线提交上构建：

```bash
npm install
npm run build
```

2. 在基准种子目录中捕获 H1：

```bash
node dist/cli.js capture --input docs/experiments/benchmark-fixtures/h1.json --json
```

3. 捕获 H2：

```bash
node dist/cli.js capture --input docs/experiments/benchmark-fixtures/h2.json --json
```

4. A 副本保留生成的 H1/H2 `.context-relay` 快照；不要把这个目录复制到 B 副本。B 组从空的快照历史开始，可在会话中自行创建测试快照，避免通过 `resume` 读到 A 组的交接材料。

5. 在 A 副本生成交接材料：

```bash
node dist/cli.js resume > handoff.txt
```

6. B 组直接使用 `arm-b-handoff.md` 作为 `handoff.md`，不要重新生成。

7. 按协议交替执行 A/B，并把结果填写到 [评分表](../benchmark-scorecard.md)。

## 约束

- `h1.json` 的决策 ID 是确定性的（摘要小写后 SHA-256 前 12 位）。如果修改摘要，`h2.json` 的 `supersedes` 目标必须同步更新。
- H2 应产生 1 个 `task_reopened`、1 个 `decision_conflict`，并把旧输出决策标记为 `superseded`。
- B 组的 Markdown 摘要刻意停留在 H1，这是主要实验 E1 的自变量：普通摘要不会随新快照自动更新。
- E2 消融实验需要从 H2 重新生成一份扁平 Markdown 摘要，不能复用 `arm-b-handoff.md`。
- 正式运行前先确认 H2 的冲突数量和决策状态符合预期；不符合时停止运行并修复 fixture。
