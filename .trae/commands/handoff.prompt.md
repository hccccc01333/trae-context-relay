---
name: handoff
description: 创建可验证的 ContextRelay 交接快照（capture）
argument-hint: "[本轮目标或补充说明，可选]"
---

# /handoff

执行 ContextRelay 的交接工作流。完整规则见 `.trae/skills/context-relay/SKILL.md` 的工作流 A；下面是必须执行的最小步骤。

1. 定位 CLI：优先使用 `node dist/cli.js`。如果 `dist/cli.js` 不存在，先运行 `npm run build`。已安装全局命令时也可以使用 `context-relay`。CLI 不可用时说明原因并停止，不要伪造快照。
2. 只收集用户明确提供或当前对话已确认的信息：目标、关键决策、任务状态、下一步、备注、需要记录哈希的文件，以及用户已确认解决的冲突 ID。用户通过 `/handoff` 传入的补充文本可以作为目标或备注候选，但不要猜测缺失信息。
3. 状态必须保守：只有当前会话实际运行过测试或命令并有结果时，才能把任务写成 `done_claimed`；仅看到文件存在时使用 `todo`、`in_progress` 或 `blocked`。禁止把“可能完成”写成完成。
4. 把结构化输入写入系统临时目录，不要写入项目源码目录。字段格式遵循 `SKILL.md` 中的 JSON 示例。
5. 在项目根目录执行：

   ```bash
   node dist/cli.js capture --input <临时输入文件> --json
   ```

6. 检查返回结果中的 `snapshot.id`、Git 状态、文件证据、`warnings` 和 `conflicts`。如果仍有未解决冲突，逐条列出并等待用户确认，不要自行裁决。
7. 向用户报告：快照 ID 与保存路径、Git HEAD/分支、工作区是否有修改、记录了多少文件哈希与跳过了多少文件、未解决冲突数量、功能状态仍为 `not verified`。
8. 不要自动执行 `git commit`，也不要主动提交 `.context-relay/`；除非用户明确要求共享快照。
