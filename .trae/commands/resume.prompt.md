---
name: resume
description: 校验最新 ContextRelay 快照并恢复可验证上下文（resume）
argument-hint: "[可选：要恢复的快照 ID]"
---

# /resume

执行 ContextRelay 的恢复工作流。完整规则见 `.trae/skills/context-relay/SKILL.md` 的工作流 B；下面是必须执行的最小步骤。

1. 定位 CLI：优先使用 `node dist/cli.js`。如果 `dist/cli.js` 不存在，先运行 `npm run build`。已安装全局命令时也可以使用 `context-relay`。
2. 执行：

   ```bash
   node dist/cli.js resume
   ```

   用户指定快照 ID 时使用 `node dist/cli.js resume --snapshot <id>`。

3. 把输出视为待核验的恢复提示，而不是已确认事实。立即独立检查：
   - `git status`；
   - 快照 HEAD 与当前 HEAD 的关系；
   - 标记为“已变化”“缺失”“无法验证”的文件证据；
   - 任务是否仍有当前仓库中的实现或测试支持。
4. 向用户简要复述：目标、仍然有效的决策、已验证证据、发生变化的证据、下一步。
5. 如果存在“未解决冲突”，逐条向用户确认事实和处理方式。不要自行选择旧状态或新状态继续开发。只有用户明确确认后，才能在下次 `capture` 中使用 `--resolve-conflict <id>` 或 `resolvedConflicts` 关闭冲突。
6. 只执行 `status=active` 的决策；`superseded` 决策仅用于理解历史。任务状态历史中的 `done_claimed` 仍不代表功能已验证。
7. 未经实际运行测试或用户确认，不得声称功能完成、测试通过或任务已完成。如果交接材料与当前仓库冲突，先报告差异并询问用户。
8. 如果没有快照，明确提示用户先执行 `/handoff` 或 `capture`，不要凭空恢复上下文。
