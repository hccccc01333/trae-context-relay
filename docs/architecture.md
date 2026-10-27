# ContextRelay v0.2 架构

## 1. 设计目标

ContextRelay 解决的是“跨会话恢复依据不可验证”的问题，而不是扩大聊天记录存储。

四个约束决定了架构：

1. **核心引擎不依赖 TRAE**：CLI 可以独立运行，TRAE Skill 只是调用层。
2. **证据与结论分离**：文件哈希、Git 状态和任务完成声明是不同层级的事实。
3. **本地优先**：首版不引入数据库、向量检索和云服务。
4. **不碰用户源码**：工具只写 `.context-relay/`，恢复时只读用户项目。

## 2. 分层

```text
┌─────────────────────────────────────────────┐
│ Integration                                 │
│ .trae/skills/context-relay + /handoff /resume│
└──────────────────────┬──────────────────────┘
                       │ CLI invocation
┌──────────────────────▼──────────────────────┐
│ CLI commands                                 │
│ capture / resume / list                     │
└──────────────────────┬──────────────────────┘
                       │
┌──────────────────────▼──────────────────────┐
│ Core orchestration                           │
│ capture.ts / resume.ts                      │
└───────┬──────────────┬──────────────┬───────┘
        │              │              │
┌───────▼──────┐ ┌─────▼──────┐ ┌─────▼──────┐
│ Source readers│ │ Verification│ │ Persistence │
│ git.ts        │ │ evidence.ts │ │ store.ts   │
│ tree.ts       │ │ resume checks│ │ schema.ts  │
│ project-info  │ │ render.ts  │ │            │
└──────────────┘ └────────────┘ └────────────┘
```

`commands/` 只负责参数到服务调用、结果到 stdout 的映射。核心逻辑没有终端依赖，因此后续可以被 Benchmark、Web UI 或其他 Agent 复用。

## 3. Capture 流程

```text
1. findGitRoot(cwd) -> projectRoot（非 Git 项目则 cwd）
2. loadLatestSnapshotOrNull(projectRoot)
3. 读取可选 --input JSON
4. getGitSnapshot(projectRoot)
5. readProjectInfo(projectRoot)
6. scanProjectTree(projectRoot)
7. buildEvidenceCandidates
8. collectEvidence(sha256 + stat)
9. mergeContext(parent.context, updates)
10. buildDelta(parent, current)
11. SnapshotSchema.parse
12. renderSnapshotMarkdown
13. 原子写入 JSON，写 Markdown 与 HANDOFF.md
```

关键点：

- 新快照是**不可变文件**，不是覆盖上一版本。
- 上下文合并是增量的：
  - 决策按摘要去重后追加，历史决策保留；
  - 任务按 `id` 或规范化标题匹配，状态更新记录在 delta；
  - 下一步仅在显式提供时替换；
  - 备注去重并保留最近 50 条。
- 每个快照包含完整当前状态和相对父快照的 delta，因此恢复不需要重放所有历史文件。

## 4. Evidence 模型

### 4.1 文件证据

```text
path, sha256, sizeBytes, modifiedAt, reasons[]
```

`reasons` 表示候选来源：

- `explicit`：用户或 Agent 通过 `--file` / JSON 指定；
- `git-status`：当前工作区变更文件；
- `project-config`：package.json / lockfile。

不保存文件内容。读取失败或超过 1 MiB 的文件进入 `skipped`，不会阻塞捕获。

### 4.2 Git 证据

```text
root, branch, detached, head, headShort, subject, upstream,
status { staged, modified, untracked, deleted, renamed },
changedFiles, truncated
```

resume 时额外计算：

- HEAD 关系：`same` / `advanced` / `diverged` / `rewound`；
- 快照 HEAD 到当前 HEAD 的提交间文件变化；
- 工作区状态指纹差异；
- 新出现和已消失的工作区修改路径。

### 4.3 功能验证

快照固定包含：

```json
{
  "fileEvidence": "sha256",
  "functional": "not-verified"
}
```

v0.2 不允许调用方把功能状态写成已验证。即使任务输入 `done`，也会规范化为 `done_claimed`。

## 5. Resume 流程

```text
1. findGitRoot(cwd) -> currentRoot
2. load latest / specified snapshot
3. 对每个文件证据重新 lstat + sha256
4. 计算 verified / changed / missing / unverifiable
5. 读取当前 Git 状态并比较
6. 汇总 warnings 与功能验证边界
7. 渲染中文恢复提示词
8. 返回 prompt + 结构化 JSON
```

恢复提示词不是“事实列表”，而是给下一个 Agent 的行动约束：

- 先检查变化/缺失证据；
- 不把 `done_claimed` 当作完成；
- 不重复实现已有工作；
- 未实际运行测试不得宣称通过。

## 6. 安全边界

### 6.1 只读用户源码

- capture 不写源码；
- resume 只读文件；
- 写入目标仅在 `.context-relay/`。

### 6.2 路径约束

- 证据路径必须是项目相对路径；
- `..`、绝对路径、盘符路径会被拒绝；
- 恢复时重新校验路径仍在项目根内。

### 6.3 排除策略

- 隐藏文件/目录；例外：`.trae/skills/**` 公开能力文件可进入证据，敏感文件和隐藏子目录仍排除；
- 依赖、构建、覆盖率和缓存目录；
- `.env*`、私钥/证书、凭据目录、数据库；
- 超过大小上限的文件；
- package.json 只保留脚本名称，不保留命令原文。

### 6.4 本地隐私

`.context-relay/.gitignore` 默认写入 `*`，让整个数据目录不进入 Git 状态。需要共享时必须由用户显式调整。

## 7. 测试策略

- **单元**：Git 解析、排除规则、文件哈希、上下文合并。
- **集成**：真实 Git 仓库中的重命名与状态读取。
- **E2E**：独立 Node 进程依次执行 capture → 修改工作区 → resume → 增量 capture，验证跨会话行为。
- **断言重点**：哈希变化、文件缺失、不可验证路径、Git HEAD 前进、决策保留、任务状态语义。

## 8. 后续演进

v0.3 可把任务与具体证据路径关联，增加冲突检测；v0.4 引入恢复准确率和重复任务 Benchmark；v1.0 再把 CLI 封装为更完整的 Skill/界面。任何阶段都不应取消“功能验证与文件证据分离”这一约束。
