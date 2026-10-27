---
name: context-relay
description: 使用本地可验证快照保存和恢复 AI Coding 会话上下文。用户提到 /handoff、/resume、保存交接、恢复上下文、跨会话记忆、ContextRelay、capture 或 resume 时使用。
---

# ContextRelay

用本地 CLI 在 AI Coding 会话之间传递**可验证的项目状态**。CLI 只写入项目根目录的 `.context-relay/`，不修改用户源码，也不访问 TRAE 私有聊天数据库。

## 先定位 CLI

在 ContextRelay 仓库自身运行时，优先使用：

```bash
node dist/cli.js <command>
```

如果 `dist/cli.js` 不存在，先运行 `npm install && npm run build`。

在已安装 ContextRelay 的项目中，也可以使用：

```bash
context-relay <command>
```

如果 CLI 不可用，明确告诉用户需要先安装或构建，不要伪造交接结果。

## 工作流 A：`/handoff`

当用户输入 `/handoff`、要求保存交接、或结束一个开发阶段时：

1. 收集**用户明确提供或当前会话已确认**的信息：项目目标、关键决策、任务状态、下一步和备注。
2. 不要根据文件存在推断功能完成，不要把“可能完成”写成 `done_claimed`。没有证据时使用 `todo`、`in_progress` 或 `blocked`。
3. 将结构化输入写入系统临时目录，不要写入用户源码目录。输入格式：

```json
{
  "goal": "本轮和后续会话要达成的目标",
  "decisions": [
    {
      "summary": "必须保留的技术决策",
      "rationale": "为什么这样决定（可选）"
    }
  ],
  "tasks": [
    {
      "title": "任务标题",
      "status": "todo | in_progress | blocked | done_claimed",
      "notes": "当前进度，仅限已确认信息（可选）"
    }
  ],
  "nextSteps": ["下一步"],
  "notes": ["需要跨会话保留的备注"],
  "files": ["需要额外记录哈希的项目相对路径"],
  "resolvedConflicts": ["用户已明确确认解决的冲突 ID（可选）"]
}
```

4. 执行并读取 JSON 结果：

```bash
node dist/cli.js capture --input <临时输入文件> --json
```

5. 检查结果中的 `git`、`evidence`、`warnings` 和快照路径。向用户报告：
   - 快照 ID 与保存位置；
   - Git HEAD/分支和工作区是否有修改；
   - 记录了多少文件哈希、跳过了多少文件；
   - 功能状态仍是 `not verified`，除非测试已在当前会话实际运行。
6. 不要自动提交 `.context-relay/`，除非用户明确要求共享快照。

## 工作流 B：`/resume`

当用户输入 `/resume`、开始新会话、或要求恢复上下文时：

1. 执行：

```bash
node dist/cli.js resume
```

需要程序化处理时使用：

```bash
node dist/cli.js resume --json
```

2. 把输出视为恢复提示，而不是已确认事实。立即独立检查：
   - `git status`；
   - 标记为“已变化”“缺失”“无法验证”的文件；
   - 当前 HEAD 与快照 HEAD 的关系；
   - 任务是否仍有证据支持。
3. 向用户简要复述：目标、必须保留的决策、已验证证据、发生变化的证据、下一步。
4. 如果快照与现状冲突，先报告冲突并询问用户；不要静默删除或重写旧决策。
5. 若输出中存在“未解决冲突”，逐条向用户确认事实与处理方式；不要自行选择旧状态或新状态继续开发。只有用户明确确认后，才能在下次 `capture` 中通过 `--resolve-conflict <id>` 或 `resolvedConflicts` 关闭冲突。
6. 只执行 `status=active` 的决策；`superseded` 决策仅用于理解历史。任务状态历史中的 `done_claimed` 仍不代表功能已验证。
7. 未经实际运行测试或用户确认，不得声称功能完成、测试通过或任务已完成。
8. 若没有快照，明确提示先执行 `/handoff` 或 `capture`。

## 命令映射

- `/handoff` → 工作流 A（capture）
- `/resume` → 工作流 B（resume 并核验）

TRAE 项目级原生命令位于：

```text
.trae/commands/handoff.prompt.md
.trae/commands/resume.prompt.md
```

这两个文件是斜杠命令入口，只引用本 Skill 的工作流 A/B，不复制实现逻辑。命令文件未出现在 TRAE 命令列表时，重新加载窗口并确认工作区根目录包含 `.trae/commands/`；也可以直接描述“保存交接”或“恢复上下文”触发本 Skill。

即使用户没有输入斜杠命令，只要语义是保存或恢复开发上下文，也使用对应工作流。

## 安全与证据边界

- 不读取或假设存在 TRAE 聊天历史；上下文只能来自用户、当前会话的明确信息，以及本地文件/Git 证据。
- 不把 `.env`、私钥、凭据、`node_modules`、构建产物、大文件写入快照。
- `.trae/skills/**` 公开能力文件可以作为显式文件证据；`.trae` 下的其他配置、敏感文件和隐藏子目录仍不保存。
- 文件 SHA-256 一致只说明文件内容未变，不说明测试通过或功能可用。
- Git 提交只证明代码版本关系，不证明业务功能正确。
- 不修改、删除或回滚用户源码；所有恢复结论都应先在当前工作区核验。
