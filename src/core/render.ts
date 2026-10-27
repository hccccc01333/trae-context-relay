import { FUNCTIONAL_VERIFICATION_NOTE } from "./constants.js";
import type {
  EvidenceCheck,
  GitVerification,
  ResumeResult,
} from "./resume-types.js";
import type {
  Snapshot,
  SnapshotContext,
  Task,
  TaskStatus,
} from "./schema.js";

const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "未开始",
  in_progress: "进行中",
  blocked: "阻塞",
  done_claimed: "上一会话声明完成（未经功能验证）",
};

const GIT_RELATION_LABELS: Record<GitVerification["relation"], string> = {
  same: "HEAD 未变化",
  advanced: "HEAD 已前进",
  diverged: "历史已分叉或改写",
  rewound: "HEAD 被回退",
  unavailable: "Git 状态无法验证",
};

function codeSpan(value: string): string {
  const fence = value.includes("`") ? "``" : "`";
  return `${fence}${value}${fence}`;
}

function tableCell(value: string): string {
  return value.replaceAll("|", "\\|").replace(/\r?\n/g, " ");
}

function pathList(paths: string[], max = 40): string {
  if (paths.length === 0) {
    return "无";
  }
  const shown = paths.slice(0, max).map((path) => `- ${codeSpan(path)}`);
  if (paths.length > max) {
    shown.push(`- ... 另有 ${paths.length - max} 项未展开`);
  }
  return shown.join("\n");
}

function renderGitSection(snapshot: Snapshot): string {
  if (snapshot.git === null) {
    return "未检测到可用的 Git 仓库。Git 提交、分支和工作区证据不可用。";
  }

  const git = snapshot.git;
  const lines = [
    `- 分支：${git.branch ? codeSpan(git.branch) : "detached HEAD"}`,
    `- HEAD：${git.head ? codeSpan(git.headShort ?? git.head) : "尚无提交"}${
      git.subject ? ` — ${git.subject}` : ""
    }`,
    `- 上游：${git.upstream ? codeSpan(git.upstream) : "未设置"}`,
    `- 工作区：${git.status.clean ? "干净" : "有未提交修改"}`,
  ];

  if (!git.status.clean) {
    if (git.status.staged.length > 0) {
      lines.push(`\n已暂存（${git.status.staged.length}）：\n${pathList(git.status.staged, 20)}`);
    }
    if (git.status.modified.length > 0) {
      lines.push(`\n已修改（${git.status.modified.length}）：\n${pathList(git.status.modified, 20)}`);
    }
    if (git.status.untracked.length > 0) {
      lines.push(`\n未跟踪（${git.status.untracked.length}）：\n${pathList(git.status.untracked, 20)}`);
    }
    if (git.status.deleted.length > 0) {
      lines.push(`\n已删除（${git.status.deleted.length}）：\n${pathList(git.status.deleted, 20)}`);
    }
    if (git.status.renamed.length > 0) {
      const renames = git.status.renamed.map(
        (rename) => `- ${codeSpan(rename.from)} → ${codeSpan(rename.to)}`,
      );
      lines.push(`\n重命名（${git.status.renamed.length}）：\n${renames.join("\n")}`);
    }
  }

  return lines.join("\n");
}

function renderContextSections(context: SnapshotContext): string {
  const decisions =
    context.decisions.length === 0
      ? "未记录。"
      : context.decisions
          .map((decision) => {
            const rationale = decision.rationale
              ? `\n  - 原因：${decision.rationale}`
              : "";
            return `- ${decision.summary}${rationale}`;
          })
          .join("\n");

  const tasks =
    context.tasks.length === 0
      ? "未记录。"
      : context.tasks
          .map((task) => {
            const notes = task.notes ? ` — ${task.notes}` : "";
            return `- [${TASK_STATUS_LABELS[task.status]}] ${task.title}${notes}`;
          })
          .join("\n");

  const nextSteps =
    context.nextSteps.length === 0
      ? "未记录。"
      : context.nextSteps.map((step) => `- ${step}`).join("\n");

  const notes =
    context.notes.length === 0
      ? "未记录。"
      : context.notes.map((note) => `- ${note}`).join("\n");

  return [
    "## 项目目标",
    context.goal ?? "未记录明确目标。",
    "",
    "## 关键决策",
    decisions,
    "",
    "## 任务状态（上一会话自述，不是验证事实）",
    tasks,
    "",
    "## 下一步",
    nextSteps,
    "",
    "## 备注",
    notes,
  ].join("\n");
}

function renderDelta(snapshot: Snapshot): string {
  if (snapshot.delta === null) {
    return "这是首个快照，没有父快照差异。";
  }

  const delta = snapshot.delta;
  const lines = [
    `- 父快照：${codeSpan(delta.parentId ?? "none")}`,
    `- Git HEAD 变化：${delta.gitHeadChanged ? "是" : "否"}`,
    `- 新增文件证据：${delta.evidenceAdded.length}`,
    `- 哈希变化文件：${delta.evidenceChanged.length}`,
    `- 移除文件证据：${delta.evidenceRemoved.length}`,
    `- 新增决策：${delta.decisionsAdded.length}`,
    `- 新增任务：${delta.tasksAdded.length}`,
    `- 任务状态变化：${delta.taskStatusChanges.length}`,
  ];

  if (delta.evidenceChanged.length > 0) {
    lines.push(`\n哈希变化：\n${pathList(delta.evidenceChanged, 20)}`);
  }
  if (delta.taskStatusChanges.length > 0) {
    const changes = delta.taskStatusChanges.map(
      (change) =>
        `- ${change.title}: ${change.from ?? "none"} → ${change.to}`,
    );
    lines.push(`\n任务状态变化：\n${changes.join("\n")}`);
  }

  return lines.join("\n");
}

function renderTree(snapshot: Snapshot): string {
  if (snapshot.tree.entries.length === 0) {
    return "未记录可见目录条目。";
  }
  const entries = snapshot.tree.entries
    .slice(0, 100)
    .map((entry) => `${entry.type === "directory" ? "[D]" : "[F]"} ${entry.path}`);
  if (snapshot.tree.entries.length > 100) {
    entries.push(`... 另有 ${snapshot.tree.entries.length - 100} 项，完整内容见 JSON。`);
  }
  return ["```text", ...entries, "```"].join("\n");
}

export function renderSnapshotMarkdown(snapshot: Snapshot): string {
  const evidenceRows =
    snapshot.evidence.files.length === 0
      ? "| （无） | - | - | - |"
      : snapshot.evidence.files
          .map(
            (file) =>
              `| ${tableCell(codeSpan(file.path))} | ${file.sha256.slice(0, 16)}… | ${file.sizeBytes} | ${file.reasons.join(", ")} |`,
          )
          .join("\n");

  const skipped =
    snapshot.evidence.skipped.length === 0
      ? "无。"
      : snapshot.evidence.skipped
          .map(
            (entry) =>
              `- ${codeSpan(entry.path)}：${entry.reason}`,
          )
          .join("\n");

  const warnings =
    snapshot.warnings.length === 0
      ? "无。"
      : snapshot.warnings.map((warning) => `- ${warning}`).join("\n");

  return [
    "# ContextRelay 交接快照",
    "",
    `- 快照 ID：${codeSpan(snapshot.id)}`,
    `- 创建时间：${snapshot.createdAt}`,
    `- 项目：${snapshot.project.rootName}${
      snapshot.project.name ? ` (${snapshot.project.name}${snapshot.project.version ? `@${snapshot.project.version}` : ""})` : ""
    }`,
    `- 工具：${snapshot.tool.name} v${snapshot.tool.version}`,
    `- JSON：${codeSpan(`.context-relay/snapshots/${snapshot.id}.json`)}`,
    "",
    "> 验证边界：文件证据只能证明文件在快照时刻存在且哈希一致；不能证明测试通过、功能可用或代码质量达标。",
    "",
    renderContextSections(snapshot.context),
    "",
    "## Git 状态",
    renderGitSection(snapshot),
    "",
    `## 文件证据（${snapshot.evidence.files.length}）`,
    "",
    "| 文件 | SHA-256 | 字节 | 来源 |",
    "| --- | --- | ---: | --- |",
    evidenceRows,
    "",
    "### 跳过或无法记录的候选文件",
    skipped,
    "",
    "## 与父快照的增量",
    renderDelta(snapshot),
    "",
    "## 目录结构",
    renderTree(snapshot),
    "",
    "## 注意事项",
    warnings,
    "",
    "## 恢复",
    "",
    "```bash",
    "context-relay resume",
    "```",
    "",
    "恢复时请先核验证据，不要把任务状态或文件存在性当作功能验收结果。",
    "",
  ].join("\n");
}

function formatEvidenceCheck(check: EvidenceCheck): string {
  const expected = check.expectedSha256.slice(0, 12);
  const current = check.currentSha256
    ? check.currentSha256.slice(0, 12)
    : "-";

  if (check.status === "verified") {
    return `- ${codeSpan(check.path)} — SHA-256 一致（${expected}…）`;
  }
  if (check.status === "changed") {
    return `- ${codeSpan(check.path)} — 已变化：${expected}… → ${current}…${
      check.reason ? `（${check.reason}）` : ""
    }`;
  }
  if (check.status === "missing") {
    return `- ${codeSpan(check.path)} — 文件缺失`;
  }
  return `- ${codeSpan(check.path)} — 无法验证${check.reason ? `：${check.reason}` : ""}`;
}

function renderEvidenceChecks(checks: EvidenceCheck[], status: EvidenceCheck["status"]): string {
  const matching = checks.filter((check) => check.status === status);
  if (matching.length === 0) {
    return "无。";
  }
  return matching.map(formatEvidenceCheck).join("\n");
}

function renderGitVerification(git: GitVerification): string {
  if (!git.available) {
    const notes = git.notes.length > 0 ? git.notes.join("；") : "没有可比较的 Git 状态。";
    return `- 关系：${GIT_RELATION_LABELS.unavailable}\n- 说明：${notes}`;
  }

  const lines = [
    `- 关系：${GIT_RELATION_LABELS[git.relation]}`,
    `- 快照 HEAD：${git.snapshotHead ? codeSpan(git.snapshotHeadShort ?? git.snapshotHead) : "尚无提交"}`,
    `- 当前 HEAD：${git.currentHead ? codeSpan(git.currentHeadShort ?? git.currentHead) : "尚无提交"}`,
    `- 快照分支：${git.snapshotBranch ? codeSpan(git.snapshotBranch) : "detached/unknown"}`,
    `- 当前分支：${git.currentBranch ? codeSpan(git.currentBranch) : "detached/unknown"}`,
  ];

  if (git.committedChanges.length > 0) {
    lines.push(
      `\n快照之后提交中涉及的文件（${git.committedChanges.length}${
        git.committedChangesTruncated ? "+" : ""
      }）：\n${pathList(git.committedChanges, 30)}`,
    );
  }

  if (git.workingTree.comparable) {
    if (git.workingTree.same) {
      lines.push("\n工作区状态：与快照捕获时一致。");
    } else {
      lines.push("\n工作区状态：与快照捕获时不同。");
      if (git.workingTree.newChanges.length > 0) {
        lines.push(
          `新增修改：\n${pathList(git.workingTree.newChanges, 20)}`,
        );
      }
      if (git.workingTree.resolvedChanges.length > 0) {
        lines.push(
          `捕获时存在、现在已消失的修改：\n${pathList(git.workingTree.resolvedChanges, 20)}`,
        );
      }
      if (
        git.workingTree.newChanges.length === 0 &&
        git.workingTree.resolvedChanges.length === 0 &&
        git.workingTree.statusFingerprintChanged
      ) {
        lines.push("修改路径相同，但暂存/修改/重命名状态发生了变化。");
      }
    }
  } else {
    lines.push("\n工作区状态：无法比较。");
  }

  if (git.notes.length > 0) {
    lines.push(`\nGit 说明：\n${git.notes.map((note) => `- ${note}`).join("\n")}`);
  }

  return lines.join("\n");
}

function renderTasks(tasks: Task[]): string {
  if (tasks.length === 0) {
    return "未记录任务。";
  }
  return tasks
    .map((task) => {
      const notes = task.notes ? ` — ${task.notes}` : "";
      return `- [${TASK_STATUS_LABELS[task.status]}] ${task.title}${notes}`;
    })
    .join("\n");
}

function packageScripts(snapshot: Snapshot): string {
  const scripts = snapshot.project.scriptNames.slice(0, 12);
  if (scripts.length === 0) {
    return "未记录可用脚本。";
  }

  const packageManager = snapshot.project.packageManager ?? "npm";
  function commandFor(name: string): string {
    if (packageManager === "pnpm") {
      return `pnpm ${name}`;
    }
    if (packageManager === "yarn") {
      return `yarn ${name}`;
    }
    if (packageManager === "bun") {
      return `bun run ${name}`;
    }
    return `npm run ${name}`;
  }

  return scripts
    .map((name) => `- ${codeSpan(commandFor(name))}（脚本内容未写入快照）`)
    .join("\n");
}

function renderWarnings(warnings: string[]): string {
  const all = [
    "任务状态来自上一会话或用户输入，不能被 ContextRelay 验证为功能完成。",
    "文件哈希一致只代表文件内容未变，不代表测试已运行或功能可用。",
    ...warnings,
  ];
  return [...new Set(all)].map((warning) => `- ${warning}`).join("\n");
}

export function renderResumePrompt(result: ResumeResult, snapshot: Snapshot): string {
  return [
    "# 跨会话恢复提示（ContextRelay）",
    "",
    `你正在一个新的会话中继续项目 ${codeSpan(snapshot.project.rootName)} 的工作。请先依据可验证证据恢复状态，再开始修改代码。`,
    "",
    "## 强制约束",
    "",
    "- 不要把任务列表中的“声明完成”当作已完成。它只是上一会话的自述。",
    "- 文件 SHA-256 验证成功只表示文件内容与快照一致，不代表测试通过或功能可用。",
    "- 遇到标记为“已变化”“缺失”“无法验证”的证据时，先检查现状，不要假设旧结论仍然成立。",
    "- 不要在没有明确理由并征得用户同意的情况下推翻“关键决策”。",
    "- 未经实际运行测试或用户确认，不得声称功能已完成。",
    "",
    "## 快照信息",
    "",
    `- 快照 ID：${codeSpan(result.snapshotId)}`,
    `- 创建时间：${result.snapshotCreatedAt}`,
    `- 快照文件：${codeSpan(result.snapshotPath)}`,
    `- 项目根目录：${codeSpan(result.currentRoot)}`,
    `- 快照项目根目录：${codeSpan(result.snapshotRoot)}${
      result.rootMatches ? "" : "（与当前目录不同，证据按当前目录重新校验）"
    }`,
    "",
    "## 恢复状态摘要",
    "",
    `- 文件证据：${result.evidence.summary.total} 个；已验证 ${
      result.evidence.summary.verified
    }；已变化 ${result.evidence.summary.changed}；缺失 ${
      result.evidence.summary.missing
    }；无法验证 ${result.evidence.summary.unverifiable}`,
    `- Git：${GIT_RELATION_LABELS[result.git.relation]}`,
    "- 功能验证：未验证",
    "",
    "## 项目目标",
    "",
    result.context.goal ?? "快照没有记录明确目标。开始前先与用户确认目标。",
    "",
    "## Git 核验",
    "",
    renderGitVerification(result.git),
    "",
    "## 文件证据核验",
    "",
    "### 已验证（哈希一致）",
    renderEvidenceChecks(result.evidence.checks, "verified"),
    "",
    "### 已变化（不能沿用旧结论）",
    renderEvidenceChecks(result.evidence.checks, "changed"),
    "",
    "### 缺失",
    renderEvidenceChecks(result.evidence.checks, "missing"),
    "",
    "### 无法验证",
    renderEvidenceChecks(result.evidence.checks, "unverifiable"),
    "",
    "## 关键决策（必须保留，除非用户明确同意变更）",
    "",
    result.context.decisions.length === 0
      ? "未记录。"
      : result.context.decisions
          .map((decision) => {
            const rationale = decision.rationale
              ? `\n  - 原因：${decision.rationale}`
              : "";
            return `- ${decision.summary}${rationale}`;
          })
          .join("\n"),
    "",
    "## 任务状态（仅为声明，不是事实）",
    "",
    renderTasks(result.context.tasks),
    "",
    "## 上一会话记录的下一步（开始前重新确认）",
    "",
    result.context.nextSteps.length === 0
      ? "未记录。"
      : result.context.nextSteps.map((step) => `- ${step}`).join("\n"),
    "",
    "## 备注",
    "",
    result.context.notes.length === 0
      ? "未记录。"
      : result.context.notes.map((note) => `- ${note}`).join("\n"),
    "",
    "## 可用项目脚本（以下命令尚未运行）",
    "",
    packageScripts(snapshot),
    "",
    "## 警告",
    "",
    renderWarnings(result.warnings),
    "",
    "## 恢复后的第一轮行动",
    "",
    "1. 运行 `git status`，并核对上面的 Git 关系与工作区差异。",
    "2. 检查所有“已变化”“缺失”“无法验证”的文件，先理解差异，再决定任务是否仍然有效。",
    "3. 向用户复述当前目标、要保留的技术决策和下一步；若快照信息与现状冲突，先提出冲突。",
    "4. 只从已确认的下一步继续，不要重复实现快照中已经存在的同一功能。",
    "5. 若声称任务完成，必须先实际运行相关测试或命令，并报告真实结果。",
    "",
    "## 验证边界",
    "",
    FUNCTIONAL_VERIFICATION_NOTE,
    "",
  ].join("\n");
}
