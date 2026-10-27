#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  access,
  copyFile,
  cp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const RUNS_ROOT = path.join(REPO_ROOT, ".benchmark-runs");
const FIXTURES_DIR = path.join(
  REPO_ROOT,
  "docs",
  "experiments",
  "benchmark-fixtures",
);
const SCORECARD_TEMPLATE = path.join(
  REPO_ROOT,
  "docs",
  "experiments",
  "benchmark-scorecard.md",
);
const TASK_CARD = path.join(
  REPO_ROOT,
  "docs",
  "experiments",
  "benchmark-tasks",
  "diff-command.md",
);
const FORCE = process.argv.includes("--force");

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function runProcess(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    env: {
      ...process.env,
      NO_COLOR: "1",
      ...(options.env ?? {}),
    },
  });

  if (result.error) {
    fail(`Failed to run ${command}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(
      `${command} ${args.join(" ")} failed with status ${result.status}\n` +
        `stdout:\n${result.stdout ?? ""}\nstderr:\n${result.stderr ?? ""}`,
    );
  }
  return result.stdout ?? "";
}

function git(args, cwd = REPO_ROOT) {
  return runProcess("git", args, { cwd }).trim();
}

function runNode(cwd, args) {
  return runProcess(process.execPath, args, { cwd });
}

async function pathExists(target) {
  try {
    await access(target);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function buildCli() {
  const compiler = path.join(
    REPO_ROOT,
    "node_modules",
    "typescript",
    "bin",
    "tsc",
  );
  if (!(await pathExists(compiler))) {
    fail(
      "node_modules/typescript is missing. Run npm install before preparing benchmark runs.",
    );
  }
  runProcess(process.execPath, [compiler, "-p", "tsconfig.build.json"]);
  assert(
    await pathExists(path.join(REPO_ROOT, "dist", "cli.js")),
    "Build finished but dist/cli.js is still missing.",
  );
}

async function cloneArm(destination, baseline) {
  git(["clone", "--quiet", "--no-hardlinks", REPO_ROOT, destination]);
  git(["checkout", "--quiet", "--detach", baseline], destination);
  const head = git(["rev-parse", "HEAD"], destination);
  assert(head === baseline, `Clone ${destination} is at ${head}, expected ${baseline}`);
}

async function copyLocalDependencies(armDir) {
  await cp(path.join(REPO_ROOT, "node_modules"), path.join(armDir, "node_modules"), {
    recursive: true,
  });
  await cp(path.join(REPO_ROOT, "dist"), path.join(armDir, "dist"), {
    recursive: true,
  });
}

function captureArm(armDir, fixture) {
  const raw = runNode(armDir, [
    "dist/cli.js",
    "capture",
    "--input",
    `docs/experiments/benchmark-fixtures/${fixture}`,
    "--json",
  ]);
  let parsed;
  try {
    parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch (error) {
    fail(`${fixture} capture did not return valid JSON: ${error.message}\n${raw}`);
  }
  assert(parsed.ok === true, `${fixture} capture returned ok=false.`);
  return parsed;
}

function summarizeSnapshot(snapshot) {
  return {
    id: snapshot.id,
    createdAt: snapshot.createdAt,
    goal: snapshot.context.goal,
    conflicts: (snapshot.conflicts ?? []).map((conflict) => ({
      id: conflict.id,
      kind: conflict.kind,
      severity: conflict.severity,
      subjectId: conflict.subjectId,
      subjectLabel: conflict.subjectLabel,
    })),
    decisions: snapshot.context.decisions.map((decision) => ({
      id: decision.id,
      summary: decision.summary,
      status: decision.status,
      revision: decision.revision,
      supersedes: decision.supersedes,
      supersededBy: decision.supersededBy,
    })),
    tasks: snapshot.context.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      statusHistory: task.statusHistory,
    })),
  };
}

function validateH1(h1) {
  const snapshot = h1.snapshot;
  assert((snapshot.conflicts ?? []).length === 0, "H1 must not contain conflicts.");
  assert(
    snapshot.context.decisions.length === 3,
    `H1 must contain 3 decisions, found ${snapshot.context.decisions.length}.`,
  );
  assert(
    snapshot.context.tasks.length === 3,
    `H1 must contain 3 tasks, found ${snapshot.context.tasks.length}.`,
  );
}

function validateH2(h2) {
  const snapshot = h2.snapshot;
  const conflictKinds = (snapshot.conflicts ?? [])
    .map((conflict) => conflict.kind)
    .sort();
  assert(
    conflictKinds.join(",") === "decision_conflict,task_reopened",
    `H2 conflicts must be decision_conflict + task_reopened, found: ${conflictKinds.join(", ") || "(none)"}`,
  );

  const oldDecision = snapshot.context.decisions.find(
    (decision) => decision.id === "dec_d1c16f14d412",
  );
  assert(oldDecision !== undefined, "H2 is missing decision dec_d1c16f14d412.");
  assert(
    oldDecision.status === "superseded",
    `dec_d1c16f14d412 must be superseded, found ${oldDecision.status}.`,
  );
  assert(
    oldDecision.supersededBy === "dec_a1d8c9b187ad",
    `dec_d1c16f14d412 must point to dec_a1d8c9b187ad, found ${oldDecision.supersededBy}.`,
  );

  const newDecision = snapshot.context.decisions.find(
    (decision) => decision.id === "dec_a1d8c9b187ad",
  );
  assert(newDecision !== undefined, "H2 is missing decision dec_a1d8c9b187ad.");
  assert(newDecision.status === "active", "The revised decision must be active.");
  assert(newDecision.revision === 2, "The revised decision must have revision 2.");
  assert(
    newDecision.supersedes === "dec_d1c16f14d412",
    "The revised decision must record supersedes.",
  );

  const reopenedTask = snapshot.context.tasks.find(
    (task) => task.id === "task_ffc82609df2c",
  );
  assert(reopenedTask !== undefined, "H2 is missing task_ffc82609df2c.");
  assert(
    reopenedTask.status === "in_progress",
    `task_ffc82609df2c must be in_progress, found ${reopenedTask.status}.`,
  );
  const lastHistory = reopenedTask.statusHistory.at(-1);
  assert(lastHistory !== undefined, "task_ffc82609df2c must have status history.");
  assert(
    lastHistory.from === "done_claimed" && lastHistory.to === "in_progress",
    `Unexpected task history: ${JSON.stringify(lastHistory)}`,
  );

  assert(
    h2.warnings.some((warning) => warning.includes("未解决上下文冲突")),
    "H2 capture warnings must mention unresolved conflicts.",
  );
}

function replaceOnce(content, search, replacement, label) {
  const index = content.indexOf(search);
  assert(index !== -1, `Scorecard template is missing expected row: ${label}`);
  return (
    content.slice(0, index) +
    replacement +
    content.slice(index + search.length)
  );
}

function scorecardRows(decisions) {
  return decisions
    .slice()
    .sort((left, right) => {
      if (left.status !== right.status) {
        return left.status === "active" ? -1 : 1;
      }
      return left.id.localeCompare(right.id);
    })
    .map((decision) => {
      const note =
        decision.status === "superseded"
          ? `已由 ${decision.supersededBy ?? "(unknown)"} 替代；仅用于理解历史`
          : decision.summary.replaceAll("|", "\\|");
      return `| ${decision.id} | ${decision.status} | 是 / 否 | 是 / 否 | ${note} |`;
    })
    .join("\n");
}

async function renderScorecard({ runId, order, baseline, h2, aChars, bChars }) {
  let content = await readFile(SCORECARD_TEMPLATE, "utf8");
  content = replaceOnce(
    content,
    "| 运行编号 | `run-XX` |",
    `| 运行编号 | \`${runId}\` |`,
    "run id",
  );
  content = replaceOnce(
    content,
    "| 条件顺序 | `A→B` / `B→A` |",
    `| 条件顺序 | \`${order}\` |`,
    "order",
  );
  content = replaceOnce(
    content,
    "| 基线提交 | |",
    `| 基线提交 | \`${baseline}\` |`,
    "baseline",
  );
  content = replaceOnce(
    content,
    "| H1 快照 ID | |",
    `| H1 快照 ID | \`${h2.h1Id}\` |`,
    "h1",
  );
  content = replaceOnce(
    content,
    "| H2 快照 ID | |",
    `| H2 快照 ID | \`${h2.id}\` |`,
    "h2",
  );
  content = replaceOnce(
    content,
    "| 交接材料文件 | `handoff.txt` |",
    "| 交接材料文件 | `benchmark/arm-a-handoff.txt` |",
    "A handoff file",
  );
  content = replaceOnce(
    content,
    "| 交接材料文件 | `handoff.md` |",
    "| 交接材料文件 | `benchmark/arm-b-handoff.md` |",
    "B handoff file",
  );
  content = replaceOnce(
    content,
    "| `handoff_chars` / `handoff_tokens` | |",
    `| \`handoff_chars\` / \`handoff_tokens\` | ${aChars} / 待采集 |`,
    "A handoff chars",
  );
  content = replaceOnce(
    content,
    "| `handoff_chars` / `handoff_tokens` | |",
    `| \`handoff_chars\` / \`handoff_tokens\` | ${bChars} / 待采集 |`,
    "B handoff chars",
  );

  const decisionTable = scorecardRows(h2.decisions);
  content = replaceOnce(
    content,
    "| | active / superseded | 是 / 否 | 是 / 否 | |",
    decisionTable,
    "A decision rows",
  );
  content = replaceOnce(
    content,
    "| | active / superseded | 是 / 否 | 是 / 否 | |",
    decisionTable,
    "B decision rows",
  );
  return content;
}

function renderGuide({ runId, order, baseline, h1, h2, aChars, bChars }) {
  const activeCount = h2.decisions.filter(
    (decision) => decision.status === "active",
  ).length;
  return `# ${runId} 执行清单

> 运行状态：**待执行（0/2）**。本文件由 \`scripts/prepare-benchmark.mjs\` 生成；指标必须来自真实 TRAE 会话。

- 条件顺序：**${order}**
- 基线提交：\`${baseline}\`
- H1 快照：\`${h1.id}\`
- H2 快照：\`${h2.id}\`
- H2 未解决冲突：${h2.conflicts.length}
- H2 活跃决策：${activeCount}
- A 交接材料：${aChars} 字符（\`A/benchmark/arm-a-handoff.txt\`）
- B 交接材料：${bChars} 字符（\`B/benchmark/arm-b-handoff.md\`）

## A 组：ContextRelay resume

1. 在 TRAE 中新建一个真实会话，工作区打开 \`${runId}/A\`。
2. 原样粘贴 \`A/benchmark/arm-a-handoff.txt\` 的全部内容。
3. 再原样粘贴本目录的 \`task-card.md\` 全文。
4. 除界面操作外不要补充提示、解释或纠偏。
5. 会话结束后保存：
   - \`A/benchmark/transcript.md\`
   - \`A/benchmark/final.diff\`（在该工作目录运行 \`git diff\`）
   - \`A/benchmark/test-output.txt\`
   - \`A/benchmark/usage.json\`（TRAE 用量；无法导出时记录 \`unavailable\`）

## B 组：Markdown 摘要

1. 新建另一个真实会话，工作区打开 \`${runId}/B\`。
2. 原样粘贴 \`B/benchmark/arm-b-handoff.md\` 的全部内容。
3. 再原样粘贴同一份 \`task-card.md\` 全文。
4. 不要向会话提供 A 组的材料，也不要复制 \`A/.context-relay\` 到 B。
5. 按与 A 组相同的位置保存会话记录、diff、测试输出和用量。

## 记录

- 按 \`${order}\` 执行两组，填写本目录的 \`scorecard.md\`。
- 保留原始记录，不要只保留汇总数字。
- 无法获得 Token 用量时填写 \`unavailable\`，不得估算后冒充真实值。
`;
}

async function prepareRun(index, baseline) {
  const runId = `run-0${index}`;
  const order = index % 2 === 1 ? "A→B" : "B→A";
  const runDir = path.join(RUNS_ROOT, runId);

  if (await pathExists(runDir)) {
    if (!FORCE) {
      fail(
        `${runDir} already exists. Re-run with --force to delete and rebuild all run directories.`,
      );
    }
    await rm(runDir, { recursive: true, force: true });
  }

  const armA = path.join(runDir, "A");
  const armB = path.join(runDir, "B");
  await mkdir(runDir, { recursive: true });

  await cloneArm(armA, baseline);
  await cloneArm(armB, baseline);
  await copyLocalDependencies(armA);
  await copyLocalDependencies(armB);

  const h1 = captureArm(armA, "h1.json");
  validateH1(h1);
  const h2 = captureArm(armA, "h2.json");
  validateH2(h2);

  await mkdir(path.join(armA, "benchmark"), { recursive: true });
  const resumeText = runNode(armA, ["dist/cli.js", "resume"]);
  assert(
    resumeText.includes(h2.snapshot.id),
    "A resume prompt does not reference the H2 snapshot.",
  );
  assert(
    resumeText.includes("未解决冲突"),
    "A resume prompt does not contain the unresolved-conflict section.",
  );
  assert(
    resumeText.includes("已被替代的决策"),
    "A resume prompt does not contain superseded decisions.",
  );
  assert(
    resumeText.includes("done_claimed"),
    "A resume prompt does not preserve done_claimed task history.",
  );
  const aHandoffPath = path.join(armA, "benchmark", "arm-a-handoff.txt");
  await writeFile(aHandoffPath, resumeText, "utf8");

  const resumeJsonRaw = runNode(armA, ["dist/cli.js", "resume", "--json"]);
  await writeFile(
    path.join(armA, "benchmark", "arm-a-resume.json"),
    `${JSON.stringify(JSON.parse(resumeJsonRaw.replace(/^\uFEFF/, "")), null, 2)}\n`,
    "utf8",
  );

  await mkdir(path.join(armB, "benchmark"), { recursive: true });
  const bHandoffSource = path.join(FIXTURES_DIR, "arm-b-handoff.md");
  const bHandoffPath = path.join(armB, "benchmark", "arm-b-handoff.md");
  await copyFile(bHandoffSource, bHandoffPath);
  assert(
    !(await pathExists(path.join(armB, ".context-relay"))),
    "B arm unexpectedly contains .context-relay; control group would be contaminated.",
  );
  const bHandoff = await readFile(bHandoffPath, "utf8");
  assert(
    bHandoff.includes("Diff defaults to JSON only"),
    "B handoff is missing the stale JSON-default decision.",
  );

  const aStats = await stat(aHandoffPath);
  const bStats = await stat(bHandoffPath);
  const aChars = resumeText.length;
  const bChars = bHandoff.length;

  const h1Summary = summarizeSnapshot(h1.snapshot);
  const h2Summary = summarizeSnapshot(h2.snapshot);
  const manifest = {
    runId,
    status: "prepared-not-run",
    order,
    baseline,
    preparedAt: new Date().toISOString(),
    toolVersion: h2.snapshot.tool.version,
    nodeVersion: process.version,
    h1: h1Summary,
    h2: h2Summary,
    handoff: {
      a: {
        path: "A/benchmark/arm-a-handoff.txt",
        chars: aChars,
        bytes: aStats.size,
      },
      b: {
        path: "B/benchmark/arm-b-handoff.md",
        chars: bChars,
        bytes: bStats.size,
      },
    },
  };
  await writeFile(
    path.join(runDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  await copyFile(TASK_CARD, path.join(runDir, "task-card.md"));
  await writeFile(
    path.join(runDir, "scorecard.md"),
    await renderScorecard({
      runId,
      order,
      baseline,
      h2: {
        id: h2.snapshot.id,
        h1Id: h1.snapshot.id,
        decisions: h2.snapshot.context.decisions,
      },
      aChars,
      bChars,
    }),
    "utf8",
  );
  await writeFile(
    path.join(runDir, "README.md"),
    renderGuide({
      runId,
      order,
      baseline,
      h1: h1Summary,
      h2: h2Summary,
      aChars,
      bChars,
    }),
    "utf8",
  );

  console.log(
    `${runId} prepared (${order}): H1=${h1.snapshot.id} H2=${h2.snapshot.id} ` +
      `A=${aChars} chars B=${bChars} chars`,
  );
  return { runId, order, h1Id: h1.snapshot.id, h2Id: h2.snapshot.id };
}

async function main() {
  const dirty = git(["status", "--porcelain"]);
  if (dirty.length > 0) {
    fail(
      "Working tree is not clean. Commit benchmark-relevant changes before cloning run directories.",
    );
  }

  const baseline = git(["rev-parse", "HEAD"]);
  await buildCli();
  await mkdir(RUNS_ROOT, { recursive: true });

  const prepared = [];
  for (let index = 1; index <= 3; index += 1) {
    prepared.push(await prepareRun(index, baseline));
  }

  console.log(`\nPrepared ${prepared.length} run directories under ${RUNS_ROOT}.`);
  console.log("Formal benchmark data remains 0/6 until the six real sessions are executed.");
  console.log("Open each .benchmark-runs/run-XX/README.md for the execution checklist.");
  console.log("Delete .benchmark-runs manually when the raw data is archived.");
}

main().catch((error) => {
  console.error(`prepare-benchmark: ${error.message}`);
  process.exitCode = 1;
});
