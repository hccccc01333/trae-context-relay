# Benchmark 评分表

每次正式运行复制一份本文件到 `.benchmark-runs/run-XX/scorecard.md`，填写后不得修改原始 transcript、`final.diff`、`test-output.txt` 和用量导出。`node scripts/prepare-benchmark.mjs` 会自动生成骨架，并预填运行编号、顺序、基线提交、快照 ID、交接材料字符数与决策清单；所有效果指标仍必须来自真实会话。

## 运行元数据

| 字段 | 值 |
| --- | --- |
| 运行编号 | `run-XX` |
| 日期 | |
| 条件顺序 | `A→B` / `B→A` |
| 模型与版本 | |
| TRAE 版本 | |
| 基线提交 | |
| H1 快照 ID | |
| H2 快照 ID | |
| 操作者 | |
| 是否发生额外提示 | 否 / 是（说明） |

## A 组：ContextRelay resume

| 指标 | 值 |
| --- | --- |
| 交接材料文件 | `handoff.txt` |
| `handoff_chars` / `handoff_tokens` | |
| `input_tokens` | |
| `output_tokens` | |
| `total_tokens` | |
| Token 数据来源 | TRAE 用量 / 导出 / 近似 / unavailable |
| `duplicate_task_count` | |
| `decision_retention_rate` | `__ / __` |
| `superseded_decision_errors` | |
| `stale_evidence_errors` | |
| `false_completion_claims` | |
| `human_interventions` | |
| `turns_to_first_correct_action` | |
| `acceptance` | 通过 / 部分 / 失败 |
| `wall_clock_seconds` | |
| 是否运行 `npm run check` | 是 / 否 |
| 测试结果 | |

### 重复任务明细

| 任务 ID | 任务标题 | 重复证据（文件/命令/工具调用） | 判定 |
| --- | --- | --- | --- |
| | | | 重复 / 非重复 |

### 决策核对

| 决策 ID | H2 状态 | 新会话是否正确复述 | 实现是否遵守 | 备注 |
| --- | --- | --- | --- | --- |
| | active / superseded | 是 / 否 | 是 / 否 | |

### 错误声明

| 类型 | 次数 | 证据 |
| --- | --- | --- |
| 过期证据错误 | | |
| 错误完成声明 | | |
| 执行已废弃决策 | | |

## B 组：Markdown 摘要

| 指标 | 值 |
| --- | --- |
| 交接材料文件 | `handoff.md` |
| `handoff_chars` / `handoff_tokens` | |
| `input_tokens` | |
| `output_tokens` | |
| `total_tokens` | |
| Token 数据来源 | TRAE 用量 / 导出 / 近似 / unavailable |
| `duplicate_task_count` | |
| `decision_retention_rate` | `__ / __` |
| `superseded_decision_errors` | |
| `stale_evidence_errors` | |
| `false_completion_claims` | |
| `human_interventions` | |
| `turns_to_first_correct_action` | |
| `acceptance` | 通过 / 部分 / 失败 |
| `wall_clock_seconds` | |
| 是否运行 `npm run check` | 是 / 否 |
| 测试结果 | |

### 重复任务明细

| 任务 ID | 任务标题 | 重复证据（文件/命令/工具调用） | 判定 |
| --- | --- | --- | --- |
| | | | 重复 / 非重复 |

### 决策核对

| 决策 ID | H2 状态 | 新会话是否正确复述 | 实现是否遵守 | 备注 |
| --- | --- | --- | --- | --- |
| | active / superseded | 是 / 否 | 是 / 否 | |

### 错误声明

| 类型 | 次数 | 证据 |
| --- | --- | --- |
| 过期证据错误 | | |
| 错误完成声明 | | |
| 执行已废弃决策 | | |

## 本轮结论

- 哪一组重复任务更少：
- 哪一组总 Token 更低：
- 哪一组决策保留更好：
- 是否支持 H1/H2/H3：
- 异常与排除说明：

## 汇总表（3 轮）

| 轮次 | 顺序 | A 重复任务 | B 重复任务 | A total tokens | B total tokens | A 决策保留 | B 决策保留 | A 验收 | B 验收 |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- |
| run-01 | | | | | | | | | |
| run-02 | | | | | | | | | |
| run-03 | | | | | | | | | |

最终报告中位数与范围，不使用平均数掩盖异常运行。
