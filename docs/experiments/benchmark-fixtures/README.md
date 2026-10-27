# Benchmark Fixtures

这些文件把 [Benchmark 协议](../benchmark-protocol.md) 中的 H1/H2 场景固化为可执行输入。

| 文件 | 用途 |
| --- | --- |
| `h1.json` | 第一次交接：v0.3 核心完成，`diff` 待实现，旧决策要求默认 JSON |
| `h2.json` | 复核交接：重开冲突检测任务，并用 `supersedes` 把默认输出改为人类可读 |
| `arm-b-handoff.md` | B 组使用的普通 Markdown 摘要，来自 H1；不会随 H2 更新 |

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

4. 复制种子目录为 A/B 两个独立副本，确保 `.context-relay/` 一起复制（它默认被 Git 忽略）。

5. A 组生成交接材料：

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
