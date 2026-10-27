#!/usr/bin/env node

/**
 * Prepare and verify a benchmark run without leaking the task card into the
 * arm workspaces.
 *
 * Why this exists: the first run cloned the repository at the benchmark tag,
 * which already contained `docs/experiments/benchmark-tasks/diff-command.md`
 * and `benchmark-protocol.md`. Both arms could therefore read the task and the
 * expected decision state straight from the repository. This script builds a
 * sealed baseline that keeps those files out of the arm history entirely.
 */

import { spawnSync } from "node:child_process";
import {
  access,
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const RUNS_ROOT = path.join(REPO_ROOT, ".benchmark-runs");
const SEALED_ROOT = path.join(RUNS_ROOT, "_sealed");
const KIT_ROOT = path.join(os.tmpdir(), "contextrelay-bench-prompts");
const FIXTURES = path.join(REPO_ROOT, "docs", "experiments", "benchmark-fixtures");
const TASK_CARD = path.join(
  REPO_ROOT,
  "docs",
  "experiments",
  "benchmark-tasks",
  "diff-command.md",
);

const SCRUB_PATHS = [
  "docs/experiments/benchmark-tasks",
  "docs/experiments/benchmark-protocol.md",
  "docs/experiments/benchmark-scorecard.md",
  "docs/experiments/benchmark-fixtures",
  "docs/experiments/v0.3-dogfooding.md",
  "scripts/prepare-benchmark.mjs",
];

const README_LINES_TO_DROP = [
  "- **v0.4**：执行 [Benchmark 协议](docs/experiments/benchmark-protocol.md)，对比 ContextRelay 与 Markdown 摘要的重复任务数和 Token 消耗",
  "- [v0.3 自我 dogfooding](docs/experiments/v0.3-dogfooding.md)：任务重新打开、决策 `supersedes`、冲突恢复提示词与 v1 快照迁移。",
  "- [Benchmark 协议](docs/experiments/benchmark-protocol.md)：ContextRelay vs Markdown 摘要的重复任务数与 Token 对照实验。",
  "- [Benchmark 任务卡](docs/experiments/benchmark-tasks/diff-command.md)：真实新会话任务 `context-relay diff`。",
  "- [Benchmark 评分表](docs/experiments/benchmark-scorecard.md)：每次运行必须保留的原始指标。",
  "> 正式 Benchmark 数据尚未采集；在真实 A/B 运行完成前，不发布量化结论。",
  "- Benchmark 目前只有协议、任务卡与 dogfooding 记录，正式 A/B 数据尚未采集；",
];

const ARCHITECTURE_LINE_PREFIX = "v0.4 执行 [Benchmark 协议]";

const LEAK_PHRASES = [
  "benchmark-tasks",
  "benchmark-protocol",
  "benchmark-scorecard",
  "两个快照之间没有检测到差异",
  "context-relay diff --from",
  "human-readable summary",
];
const LEAK_PHRASES_ALLOWED_IN_A = new Set([
  "human-readable summary",
  "context-relay diff --from",
]);

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: "1", ...(options.env ?? {}) },
  });
  if (result.error) {
    fail(`Failed to run ${command}: ${result.error.message}`);
  }
  if (options.allowFailure !== true && result.status !== 0) {
    fail(
      `${command} ${args.join(" ")} failed with status ${result.status}\n` +
        `stdout:\n${result.stdout ?? ""}\nstderr:\n${result.stderr ?? ""}`,
    );
  }
  return result;
}

function git(args, cwd) {
  return run("git", args, { cwd }).stdout.trim();
}

async function exists(target) {
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

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function valueAfter(argv, flag) {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}

async function createSealedBaseline(baselineTag) {
  const sealedDir = path.join(SEALED_ROOT, `${baselineTag}-sealed`);
  await rm(sealedDir, { recursive: true, force: true });
  await mkdir(SEALED_ROOT, { recursive: true });

  git(["clone", "--quiet", "--no-hardlinks", REPO_ROOT, sealedDir], REPO_ROOT);
  git(["checkout", "--quiet", "-B", "main", baselineTag], sealedDir);
  await rm(path.join(sealedDir, ".git"), { recursive: true, force: true });

  for (const relative of SCRUB_PATHS) {
    await rm(path.join(sealedDir, relative), { recursive: true, force: true });
  }

  const readmePath = path.join(sealedDir, "README.md");
  const readme = await readFile(readmePath, "utf8");
  const keptLines = readme
    .split(/\r?\n/)
    .filter((line) => !README_LINES_TO_DROP.includes(line.trim()));
  await writeFile(readmePath, keptLines.join("\n"), "utf8");

  const architecturePath = path.join(sealedDir, "docs", "architecture.md");
  const architecture = await readFile(architecturePath, "utf8");
  const architectureLines = architecture
    .split(/\r?\n/)
    .filter((line) => !line.startsWith(ARCHITECTURE_LINE_PREFIX));
  await writeFile(architecturePath, architectureLines.join("\n"), "utf8");

  git(["init", "--quiet", "-b", "main"], sealedDir);
  git(["add", "-A"], sealedDir);
  git(
    [
      "-c",
      "user.name=Benchmark Harness",
      "-c",
      "user.email=benchmark@local",
      "commit",
      "--quiet",
      "-m",
      "Initial commit",
    ],
    sealedDir,
  );
  git(["tag", baselineTag], sealedDir);

  return {
    dir: sealedDir,
    head: git(["rev-parse", "HEAD"], sealedDir),
  };
}

async function cloneArm(sealed, destination) {
  await rm(destination, { recursive: true, force: true });
  git(["clone", "--quiet", "--no-hardlinks", sealed.dir, destination], REPO_ROOT);
  const head = git(["rev-parse", "HEAD"], destination);
  assert(head === sealed.head, `${destination} is at ${head}, expected ${sealed.head}`);
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], destination);
  assert(branch === "main", `${destination} is on ${branch}, expected main`);

  const excludePath = path.join(destination, ".git", "info", "exclude");
  const existing = (await readFile(excludePath, "utf8")).trimEnd();
  if (!existing.split(/\r?\n/).includes("benchmark/")) {
    await writeFile(
      excludePath,
      `${existing}${existing.length > 0 ? "\n" : ""}benchmark/\n`,
      "utf8",
    );
  }
}

async function copyDependencies(source, destination) {
  const target = path.join(destination, "node_modules");
  assert(await exists(source), `Missing node_modules source: ${source}`);
  await cp(source, target, { recursive: true });
}

function buildArm(armDir) {
  const compiler = path.join(armDir, "node_modules", "typescript", "bin", "tsc");
  run(process.execPath, [compiler, "-p", "tsconfig.build.json"], { cwd: armDir });
}

function nodeCli(armDir, args, options = {}) {
  const result = run(process.execPath, ["dist/cli.js", ...args], {
    cwd: armDir,
    allowFailure: options.allowFailure ?? false,
  });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", status: result.status };
}

async function captureFixture(armDir, fixtureName) {
  const fixturePath = path.join(FIXTURES, fixtureName);
  const output = nodeCli(armDir, ["capture", "--input", fixturePath, "--json"]);
  const parsed = JSON.parse(output.stdout.replace(/^\uFEFF/, ""));
  assert(parsed.ok === true, `${fixtureName} capture returned ok=false`);
  return parsed.snapshot;
}

function assertH1(snapshot) {
  assert((snapshot.conflicts ?? []).length === 0, "H1 must not contain conflicts");
  assert(snapshot.context.decisions.length === 3, "H1 must contain 3 decisions");
  assert(snapshot.context.tasks.length === 3, "H1 must contain 3 tasks");
}

function assertH2(snapshot) {
  const kinds = (snapshot.conflicts ?? []).map((c) => c.kind).sort().join(",");
  assert(
    kinds === "decision_conflict,task_reopened",
    `H2 conflicts must be decision_conflict + task_reopened, found: ${kinds}`,
  );
  const oldDecision = snapshot.context.decisions.find(
    (decision) => decision.id === "dec_d1c16f14d412",
  );
  assert(oldDecision?.status === "superseded", "H2 must supersede dec_d1c16f14d412");
  const newDecision = snapshot.context.decisions.find(
    (decision) => decision.id === "dec_a1d8c9b187ad",
  );
  assert(newDecision?.status === "active", "H2 must keep dec_a1d8c9b187ad active");
  assert(newDecision?.revision === 2, "H2 revised decision must be revision 2");
}

const TEXT_EXTENSIONS = new Set([
  ".md",
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".json",
  ".txt",
  ".yml",
  ".yaml",
  ".html",
  ".css",
  ".ps1",
]);

async function scanLeaks(root, label, allowSet) {
  const hits = [];
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.pop();
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") {
        continue;
      }
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(full);
        continue;
      }
      if (!TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        continue;
      }
      const fileStat = await stat(full);
      if (fileStat.size > 2 * 1024 * 1024) {
        continue;
      }
      const content = await readFile(full, "utf8");
      for (const phrase of LEAK_PHRASES) {
        if (allowSet.has(phrase)) {
          continue;
        }
        if (content.includes(phrase)) {
          hits.push({ file: path.relative(root, full), phrase });
        }
      }
    }
  }
  if (hits.length > 0) {
    fail(
      `${label} still exposes benchmark material:\n` +
        hits.map((hit) => `- ${hit.file}: ${hit.phrase}`).join("\n"),
    );
  }
}

function writeRunGuide({ runId, sealed, h1, h2, promptA, promptB, handoffAChars, handoffBChars }) {
  return `# ${runId} 执行清单

> 协议变更（相对 run-01）：任务卡不再放入任何 arm 工作区，arm 仓库为封存基线。
> 每个 arm 只粘贴一条完整提示词（交接材料 + 任务卡），顺序由文本位置保证。

- 封存基线提交：\`${sealed.head}\`
- H1 快照：\`${h1.id}\`
- H2 快照：\`${h2.id}\`
- A 交接材料：${handoffAChars} 字符
- B 交接材料：${handoffBChars} 字符
- 提示词目录（在工作区之外）：\`${KIT_ROOT}\\${runId}\`

## 操作步骤（两组相同）

1. 在 TRAE 新建会话，工作区打开 \`.benchmark-runs\\${runId}\\B\`（A 组换成 \`A\`）。
2. 输入并发送这一句：
   \`读取 benchmark/START.md，按其中全部内容执行。\`
3. 之后不要再补充任何提示。仅当 Agent 主动提问时，回复：
   \`按交接材料中已经记录的状态继续，不要修改历史快照。\`
4. 会话结束后，把分享链接发回。

\`benchmark/\` 已写入 arm 的 \`.git/info/exclude\`，因此 \`START.md\` 不会污染 \`git status\`。
外部备份提示词：\`${KIT_ROOT}\\${runId}\\prompt-A.txt\` / \`prompt-B.txt\`。

## 禁止事项

- 不要在 arm 目录里执行 \`git commit\` / \`git push\`；
- 不要手工改动 \`.context-relay\`；
- 不要把 A 组的提示词或链接给 B 组；
- 不要额外解释任务、验收标准或实验目的。

## 记录

- 顺序：\`B→A\`（按协议 run-02）。
- Token 无法获取时记 \`unavailable\`，不得估算。
`;
}

async function prepare(argv) {
  const runId = valueAfter(argv, "--run") ?? "run-02";
  const baselineTag = valueAfter(argv, "--baseline") ?? "benchmark-v0.3-base";
  const force = argv.includes("--force");
  const runDir = path.join(RUNS_ROOT, runId);

  if (await exists(runDir)) {
    if (!force) {
      fail(`${runDir} already exists. Pass --force only if you intend to rebuild it.`);
    }
    await rm(runDir, { recursive: true, force: true });
  }

  const baseline = git(["rev-parse", `${baselineTag}^{commit}`], REPO_ROOT);
  const sealed = await createSealedBaseline(baselineTag);
  const taskCard = await readFile(TASK_CARD, "utf8");
  const bHandoff = await readFile(path.join(FIXTURES, "arm-b-handoff.md"), "utf8");

  const armA = path.join(runDir, "A");
  const armB = path.join(runDir, "B");
  await mkdir(runDir, { recursive: true });
  await cloneArm(sealed, armA);
  await cloneArm(sealed, armB);

  const depsSource = (await exists(path.join(RUNS_ROOT, "run-01", "A", "node_modules")))
    ? path.join(RUNS_ROOT, "run-01", "A", "node_modules")
    : path.join(REPO_ROOT, "node_modules");
  await copyDependencies(depsSource, armA);
  await copyDependencies(depsSource, armB);

  buildArm(armA);
  assert(await exists(path.join(armA, "dist", "cli.js")), "A build produced no dist/cli.js");

  const h1 = await captureFixture(armA, "h1.json");
  assertH1(h1);
  const h2 = await captureFixture(armA, "h2.json");
  assertH2(h2);

  const resume = nodeCli(armA, ["resume"]);
  assert(resume.stdout.includes(h2.id), "A resume does not reference H2");
  assert(resume.stdout.includes("未解决冲突"), "A resume lost the conflict section");
  assert(resume.stdout.includes("已被替代的决策"), "A resume lost superseded decisions");

  await mkdir(path.join(armA, "benchmark"), { recursive: true });
  await writeFile(
    path.join(armA, "benchmark", "arm-a-handoff.txt"),
    resume.stdout,
    "utf8",
  );
  const resumeJson = nodeCli(armA, ["resume", "--json"]);
  await writeFile(
    path.join(armA, "benchmark", "arm-a-resume.json"),
    `${JSON.stringify(JSON.parse(resumeJson.stdout.replace(/^\uFEFF/, "")), null, 2)}\n`,
    "utf8",
  );

  await mkdir(path.join(armB, "benchmark"), { recursive: true });
  await writeFile(path.join(armB, "benchmark", "arm-b-handoff.md"), bHandoff, "utf8");
  assert(
    !(await exists(path.join(armB, ".context-relay"))),
    "B unexpectedly contains .context-relay",
  );

  const kitDir = path.join(KIT_ROOT, runId);
  await mkdir(kitDir, { recursive: true });
  const promptA = path.join(kitDir, "prompt-A.txt");
  const promptB = path.join(kitDir, "prompt-B.txt");
  const promptAText = `${resume.stdout.trimEnd()}\n\n---\n\n${taskCard.trimEnd()}\n`;
  const promptBText = `${bHandoff.trimEnd()}\n\n---\n\n${taskCard.trimEnd()}\n`;
  await writeFile(promptA, promptAText, "utf8");
  await writeFile(promptB, promptBText, "utf8");

  // Session entry point inside each arm. `benchmark/` is excluded from
  // git status, so the "working tree: clean" statement in the handoff stays
  // truthful while the operator only has to say one sentence.
  await writeFile(path.join(armA, "benchmark", "START.md"), promptAText, "utf8");
  await writeFile(path.join(armB, "benchmark", "START.md"), promptBText, "utf8");

  await scanLeaks(armA, "A", LEAK_PHRASES_ALLOWED_IN_A);
  await scanLeaks(armB, "B", new Set());

  const statusA = git(["status", "--porcelain"], armA);
  const statusB = git(["status", "--porcelain"], armB);
  assert(statusA === "", `A working tree is not clean:\n${statusA}`);
  assert(statusB === "", `B working tree is not clean:\n${statusB}`);

  const manifest = {
    runId,
    preparedAt: new Date().toISOString(),
    protocol: "single-message handoff + task card",
    sealedBaseline: { tag: baselineTag, original: baseline, head: sealed.head },
    snapshots: { h1: h1.id, h2: h2.id },
    arms: {
      A: { path: `A`, head: sealed.head, handoffChars: resume.stdout.length },
      B: { path: `B`, head: sealed.head, handoffChars: bHandoff.length },
    },
    prompts: { A: promptA, B: promptB, promptSha256: { A: sha256(await readFile(promptA, "utf8")), B: sha256(await readFile(promptB, "utf8")) } },
    taskCardChars: taskCard.length,
  };
  await writeFile(
    path.join(runDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(runDir, "README.md"),
    writeRunGuide({
      runId,
      sealed,
      h1,
      h2,
      promptA,
      promptB,
      handoffAChars: resume.stdout.length,
      handoffBChars: bHandoff.length,
    }),
    "utf8",
  );

  console.log(
    `${runId} prepared: sealed=${sealed.head.slice(0, 12)} H1=${h1.id} H2=${h2.id} ` +
      `A=${resume.stdout.length} chars B=${bHandoff.length} chars`,
  );
  console.log(`prompt A: ${promptA}`);
  console.log(`prompt B: ${promptB}`);
}

async function verify(argv) {
  const runId = valueAfter(argv, "--run") ?? "run-02";
  const arm = (valueAfter(argv, "--arm") ?? "A").toUpperCase();
  assert(arm === "A" || arm === "B", "--arm must be A or B");
  const armDir = path.join(RUNS_ROOT, runId, arm);
  assert(await exists(armDir), `Missing arm directory: ${armDir}`);
  const benchDir = path.join(armDir, "benchmark");
  await mkdir(benchDir, { recursive: true });

  const shell = process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe";
  const check = run(shell, ["/d", "/s", "/c", "npm run check"], {
    cwd: armDir,
    allowFailure: true,
  });
  await writeFile(
    path.join(benchDir, "test-output.txt"),
    `exitCode: ${check.status}\n\n--- stdout ---\n${check.stdout ?? ""}\n--- stderr ---\n${check.stderr ?? ""}\n`,
    "utf8",
  );

  git(["add", "-N", "."], armDir);
  const diff = run("git", ["diff"], { cwd: armDir }).stdout;
  git(["reset", "--quiet"], armDir);
  await writeFile(path.join(benchDir, "final.diff"), diff, "utf8");

  const changedFiles = git(["diff", "--name-only"], armDir).split(/\r?\n/).filter(Boolean);
  const dependencyDiff = git(
    ["diff", "--", "package.json", "package-lock.json", "src/core/schema.ts"],
    armDir,
  );

  const snapshots = [];
  const snapshotDir = path.join(armDir, ".context-relay", "snapshots");
  if (await exists(snapshotDir)) {
    for (const name of await readdir(snapshotDir)) {
      const full = path.join(snapshotDir, name);
      const fileStat = await stat(full);
      const content = await readFile(full, "utf8");
      snapshots.push({
        file: name,
        mtime: fileStat.mtime.toISOString(),
        sha256: sha256(content),
      });
    }
  }

  const help = run(process.execPath, ["dist/cli.js", "--help"], {
    cwd: armDir,
    allowFailure: true,
  });
  const hasDiff = /(^|\s)diff(\s|$)/.test(`${help.stdout ?? ""}\n${help.stderr ?? ""}`);

  const verification = {
    runId,
    arm,
    verifiedAt: new Date().toISOString(),
    checkExitCode: check.status,
    changedFiles,
    dependencyDiffEmpty: dependencyDiff === "",
    snapshots,
    diffCommandRegistered: hasDiff,
  };

  if (hasDiff && arm === "A" && snapshots.length >= 2) {
    const manifest = JSON.parse(
      await readFile(path.join(RUNS_ROOT, runId, "manifest.json"), "utf8"),
    );
    const from = manifest.snapshots.h1;
    const to = manifest.snapshots.h2;
    const human = run(process.execPath, ["dist/cli.js", "diff", "--from", from, "--to", to], {
      cwd: armDir,
      allowFailure: true,
    });
    const json = run(
      process.execPath,
      ["dist/cli.js", "diff", "--from", from, "--to", to, "--json"],
      { cwd: armDir, allowFailure: true },
    );
    let parsed = null;
    try {
      parsed = JSON.parse((json.stdout ?? "").replace(/^\uFEFF/, ""));
    } catch {
      parsed = null;
    }
    verification.diffSmoke = {
      humanExitCode: human.status,
      humanChars: (human.stdout ?? "").length,
      jsonExitCode: json.status,
      jsonParses: parsed !== null,
      jsonKeys: parsed === null ? null : Object.keys(parsed),
    };
  }

  await writeFile(
    path.join(benchDir, "verification.json"),
    `${JSON.stringify(verification, null, 2)}\n`,
    "utf8",
  );
  console.log(JSON.stringify(verification, null, 2));
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];
  if (command === "prepare") {
    await prepare(argv);
    return;
  }
  if (command === "verify") {
    await verify(argv);
    return;
  }
  fail("Usage: node scripts/run-benchmark-session.mjs <prepare|verify> [--run run-02] [--arm A]");
}

main().catch((error) => {
  console.error(`run-benchmark-session: ${error.message}`);
  process.exitCode = 1;
});
