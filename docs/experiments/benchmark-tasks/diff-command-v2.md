# Benchmark 任务卡 v2：实现 `context-relay diff`

> 本文件必须逐字提供给 A/B 两组的新会话。不得添加组别名称、实验假设或额外提示。
>
> v2 相对 v1 的两处改动，目的是消除任务卡对假设的污染：
> 1. 删除“不要重复实现交接材料中已完成的工作”，让重复任务数可被观测；
> 2. 默认输出格式改为由交接材料中的决策决定，任务卡不再替 B 回答过期决策。

## 背景

你正在一个新的会话中继续这个仓库的开发。会话开始时提供的交接材料，是你获得的唯一跨会话上下文。当前仓库可能已经在交接材料生成之后发生变化。

在开始写代码前：

1. 使用交接材料恢复目标、决策和任务状态；
2. 独立检查当前 Git 状态和相关文件；
3. 如果交接材料与当前仓库不一致，先向用户报告差异并询问如何处理，不要自行假设哪一方正确。

## 目标

为 ContextRelay 增加一个快照对比命令：

```bash
context-relay diff --from <snapshot-id> --to <snapshot-id>
context-relay diff --from <snapshot-id> --to <snapshot-id> --json
```

它比较两个已经存在的快照，帮助用户回答：

- 两个快照之间新增、变化、移除了哪些文件证据？
- 哪些决策被新增或改变了状态？
- 哪些任务被新增或改变了状态？
- 新增了哪些冲突？
- Git HEAD 是否变化？

## 功能要求

### 1. 输出格式

`diff` 必须同时提供两种输出：

- 人类可读的中文摘要；
- 机器可读的 JSON。

**默认（不带 `--json`）输出哪一种格式，必须按交接材料中的决策执行。**

- 如果交接材料规定默认 JSON，人类摘要必须通过 `--human` 显式输出；
- 如果交接材料规定默认人类摘要，JSON 必须通过 `--json` 显式输出。

人类摘要至少包含：

- 起始快照 ID/创建时间、目标快照 ID/创建时间；
- Git HEAD 是否变化；
- 文件证据新增、哈希变化、移除的数量和路径；
- 决策新增数量，以及决策状态变化（例如 `active → superseded`）；
- 任务新增数量，以及任务状态变化；
- 新增冲突的数量和类型；
- 若没有差异，明确输出“两个快照之间没有检测到差异”，而不是空白。

### 2. JSON 输出

`--json` 必须输出合法 JSON，结构至少包含：

```json
{
  "ok": true,
  "from": { "id": "<snapshot-id>", "createdAt": "<ISO-8601>" },
  "to": { "id": "<snapshot-id>", "createdAt": "<ISO-8601>" },
  "delta": {
    "parentId": "<from-id>",
    "evidenceAdded": ["path"],
    "evidenceChanged": ["path"],
    "evidenceRemoved": ["path"],
    "decisionsAdded": ["decision-id"],
    "decisionChanges": [],
    "tasksAdded": ["task-id"],
    "taskStatusChanges": [],
    "conflictsAdded": ["conflict-id"],
    "gitHeadChanged": false
  }
}
```

要求：

- `decisionChanges` 复用现有 `DecisionStatusChange` 结构；
- `taskStatusChanges` 复用现有 `TaskStatusChange` 结构；
- `conflictsAdded` 是目标快照中、起始快照中不存在的冲突 ID；
- 不要为了这个命令修改 `SnapshotSchema` 或改变已有快照文件格式；
- 不要新增第三方依赖。

### 3. 错误处理

以下情况必须以非零退出码失败，并向 stderr 输出清晰错误：

- 缺少 `--from` 或 `--to`；
- `--from` 与 `--to` 相同；
- 任一快照不存在；
- 快照 ID 包含非法字符。

### 4. 测试

至少覆盖：

- 证据新增、变化、移除；
- 决策新增与状态变化；
- 任务新增与状态变化；
- 冲突新增；
- Git HEAD 变化；
- 默认输出格式与交接材料中的决策一致；
- 人类摘要与 JSON 两种输出；
- 非法参数和不存在快照。

### 5. 文档

在 README 中增加 `diff` 命令的用法和 JSON 示例。

## 约束

- 复用现有 `loadSnapshot`、`SnapshotSchema`、`Conflict`、`DecisionStatusChange`、`TaskStatusChange` 等能力；
- 不修改、删除或重写已有快照；
- 不修改用户源码之外由 ContextRelay 管理的 `.context-relay/` 历史文件；
- 不引入数据库、向量检索、云服务或新的运行时依赖。

## 验收标准

满足以下全部条件才算完成：

1. `npm run check` 真实通过（typecheck + 全部测试 + build）；
2. 默认输出格式与交接材料中记录的决策一致；
3. 人类摘要包含上述全部章节，且无差异时输出明确提示；
4. `--json` 输出可以被 `JSON.parse` 解析，且字段符合约定；
5. 非法参数与不存在的快照返回非零退出码；
6. 新增测试真实覆盖上述场景；
7. README 已更新；
8. 没有修改已有快照 JSON，也没有新增依赖。

## 停止条件

- 完成全部验收标准后停止，并报告实际运行的命令与结果；
- 如果交接材料与当前仓库冲突，先停止编码并向用户报告；
- 如果 20 轮工具调用或 30 分钟后仍未完成，停止并总结已完成部分与阻塞点。
