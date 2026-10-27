import { createHash } from "node:crypto";
import { access, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CaptureResult } from "../src/core/capture.js";
import type { ResumeResult } from "../src/core/resume-types.js";
import {
  commitAll,
  createTempDir,
  expectCliSuccess,
  initializeGitRepo,
  parseJsonOutput,
  readProjectFile,
  removeTempDir,
  runCli,
  runGit,
  writeProjectFile,
} from "./helpers.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map(removeTempDir));
});

async function createDemoRepository(): Promise<string> {
  const root = await createTempDir("context-relay-e2e-");
  tempDirectories.push(root);
  await initializeGitRepo(root);
  await writeProjectFile(
    root,
    "package.json",
    `${JSON.stringify(
      {
        name: "demo-project",
        version: "1.0.0",
        scripts: { test: "node --test", build: "tsc" },
      },
      null,
      2,
    )}\n`,
  );
  await writeProjectFile(root, "README.md", "# Demo project\n");
  await writeProjectFile(
    root,
    "src/math.ts",
    "export const one = 1;\n",
  );
  commitAll(root, "initial commit");
  return root;
}

describe("cross-session recovery (E2E)", () => {
  it("captures, verifies, restores, and carries incremental context across separate CLI processes", async () => {
    const root = await createDemoRepository();
    const changedMath = [
      "export const one = 1;",
      "export const add = (a: number, b: number) => a + b;",
      "",
    ].join("\n");

    await writeProjectFile(root, "src/math.ts", changedMath);
    await writeProjectFile(
      root,
      "src/status.ts",
      "export const ready = true;\n",
    );
    await writeProjectFile(
      root,
      "src/verify-me.ts",
      "export const evidence = 'initial';\n",
    );
    await writeProjectFile(
      root,
      ".session/session-1.json",
      `${JSON.stringify(
        {
          goal: "Implement safe context recovery",
          decisions: [
            {
              summary: "Use Git plus SHA-256 file evidence",
              rationale: "Do not trust chat summaries as facts",
            },
          ],
          tasks: [
            {
              title: "Implement add function",
              status: "done",
              notes: "Typed but tests were not run",
            },
          ],
          nextSteps: ["Run tests for add function"],
          notes: ["Session one"],
        },
        null,
        2,
      )}\n`,
    );

    const captureResult = runCli(root, [
      "capture",
      "--input",
      ".session/session-1.json",
      "--json",
    ]);
    expectCliSuccess(captureResult);
    const capture = parseJsonOutput<CaptureResult>(captureResult.stdout);

    expect(capture.ok).toBe(true);
    expect(capture.snapshot.context.goal).toBe(
      "Implement safe context recovery",
    );
    expect(capture.snapshot.context.tasks[0]?.status).toBe("done_claimed");
    expect(capture.snapshot.verification.functional).toBe("not-verified");
    expect(capture.snapshot.project.scriptNames).toEqual(["build", "test"]);
    expect(JSON.stringify(capture.snapshot.project)).not.toContain(
      "node --test",
    );

    const evidencePaths = capture.snapshot.evidence.files.map(
      (file) => file.path,
    );
    expect(evidencePaths).toEqual(
      expect.arrayContaining([
        "src/math.ts",
        "src/status.ts",
        "src/verify-me.ts",
        "package.json",
      ]),
    );
    expect(evidencePaths).not.toContain(".session/session-1.json");

    const mathEvidence = capture.snapshot.evidence.files.find(
      (file) => file.path === "src/math.ts",
    );
    expect(mathEvidence?.sha256).toBe(
      createHash("sha256").update(changedMath).digest("hex"),
    );

    await expect(
      access(path.join(root, capture.relativeJsonPath)),
    ).resolves.toBeUndefined();
    await expect(
      access(path.join(root, capture.relativeMarkdownPath)),
    ).resolves.toBeUndefined();
    await expect(
      access(path.join(root, ".context-relay", "HANDOFF.md")),
    ).resolves.toBeUndefined();

    const markdown = await readProjectFile(
      root,
      capture.relativeMarkdownPath,
    );
    expect(markdown).toContain("Use Git plus SHA-256 file evidence");
    expect(markdown).toContain("不能证明测试通过");

    const gitStatusAfterCapture = runGit(root, [
      "status",
      "--porcelain",
    ]);
    expect(gitStatusAfterCapture).not.toContain(".context-relay");

    // Simulate a new session: files changed after the snapshot.
    await writeProjectFile(
      root,
      "src/math.ts",
      `${changedMath}export const changed = true;\n`,
    );
    await rm(path.join(root, "src/status.ts"), { force: true });
    await rm(path.join(root, "src/verify-me.ts"), { force: true });
    await mkdir(path.join(root, "src/verify-me.ts"), { recursive: true });
    await writeProjectFile(
      root,
      "src/verify-me.ts/inside.txt",
      "now a directory\n",
    );

    const resumeResult = runCli(root, ["resume", "--json"]);
    expectCliSuccess(resumeResult);
    const resume = parseJsonOutput<ResumeResult>(resumeResult.stdout);

    expect(resume.evidence.summary).toEqual({
      total: 4,
      verified: 1,
      changed: 1,
      missing: 1,
      unverifiable: 1,
    });

    const checks = new Map(
      resume.evidence.checks.map((check) => [check.path, check]),
    );
    expect(checks.get("src/math.ts")?.status).toBe("changed");
    expect(checks.get("src/status.ts")?.status).toBe("missing");
    expect(checks.get("src/verify-me.ts")?.status).toBe("unverifiable");
    expect(checks.get("package.json")?.status).toBe("verified");

    expect(resume.git.relation).toBe("same");
    expect(resume.git.workingTree.same).toBe(false);
    expect(resume.git.workingTree.resolvedChanges).toContain(
      "src/status.ts",
    );
    expect(resume.functionalVerification.status).toBe("not_verified");
    expect(resume.context.tasks[0]?.status).toBe("done_claimed");
    expect(resume.prompt).toContain(
      "上一会话声明完成（未经功能验证）",
    );
    expect(resume.prompt).toContain("Implement safe context recovery");
    expect(resume.prompt).toContain(
      "Use Git plus SHA-256 file evidence",
    );
    expect(resume.prompt).toContain("功能验证：未验证");

    // A third process adds context while preserving earlier decisions.
    const secondCaptureResult = runCli(root, [
      "capture",
      "--decision",
      "Keep all state local",
      "--next",
      "Run the test suite",
      "--json",
    ]);
    expectCliSuccess(secondCaptureResult);
    const secondCapture = parseJsonOutput<CaptureResult>(
      secondCaptureResult.stdout,
    );

    expect(secondCapture.snapshot.context.goal).toBe(
      "Implement safe context recovery",
    );
    expect(secondCapture.snapshot.context.decisions).toHaveLength(2);
    expect(secondCapture.snapshot.context.tasks[0]?.status).toBe(
      "done_claimed",
    );
    expect(secondCapture.snapshot.context.nextSteps).toEqual([
      "Run the test suite",
    ]);
    expect(secondCapture.snapshot.delta?.parentId).toBe(
      capture.snapshot.id,
    );
    expect(secondCapture.snapshot.delta?.decisionsAdded).toHaveLength(1);
    expect(secondCapture.snapshot.delta?.evidenceChanged).toContain(
      "src/math.ts",
    );
    expect(secondCapture.snapshot.delta?.evidenceRemoved).toContain(
      "src/status.ts",
    );

    const listResult = runCli(root, ["list", "--json"]);
    expectCliSuccess(listResult);
    const list = parseJsonOutput<{
      ok: boolean;
      snapshots: Array<{ id: string }>;
    }>(listResult.stdout);
    expect(list.ok).toBe(true);
    expect(list.snapshots).toHaveLength(2);
    expect(list.snapshots.map((snapshot) => snapshot.id)).toContain(
      secondCapture.snapshot.id,
    );

    const gitStatusAfterResume = runGit(root, [
      "status",
      "--porcelain",
    ]);
    expect(gitStatusAfterResume).not.toContain(".context-relay");
  });

  it("detects an advanced Git HEAD and lists committed changes", async () => {
    const root = await createDemoRepository();
    await writeProjectFile(
      root,
      "src/math.ts",
      "export const one = 1;\nexport const add = () => 2;\n",
    );

    const captureResult = runCli(root, [
      "capture",
      "--goal",
      "Verify committed changes",
      "--json",
    ]);
    expectCliSuccess(captureResult);
    const capture = parseJsonOutput<CaptureResult>(captureResult.stdout);

    const newCommit = commitAll(root, "implement add");
    expect(newCommit).not.toBe(capture.snapshot.git?.head);

    const resumeResult = runCli(root, ["resume", "--json"]);
    expectCliSuccess(resumeResult);
    const resume = parseJsonOutput<ResumeResult>(resumeResult.stdout);

    expect(resume.git.relation).toBe("advanced");
    expect(resume.git.currentHead).toBe(newCommit);
    expect(resume.git.committedChanges).toContain("src/math.ts");
    expect(resume.git.workingTree.same).toBe(false);
    expect(resume.prompt).toContain("HEAD 已前进");
    expect(resume.prompt).toContain("src/math.ts");
  });

  it("tracks task reopening, decision supersession, and conflicts across sessions", async () => {
    const root = await createDemoRepository();

    await writeProjectFile(
      root,
      ".session/v03-session-1.json",
      `${JSON.stringify(
        {
          goal: "Exercise v0.3 conflict tracking",
          decisions: [
            {
              summary: "Use SHA-256 file evidence",
              rationale: "File hashes are auditable",
            },
          ],
          tasks: [
            {
              title: "Implement parser",
              status: "done",
              notes: "Claimed complete without running tests",
            },
          ],
        },
        null,
        2,
      )}\n`,
    );

    const firstResult = runCli(root, [
      "capture",
      "--input",
      ".session/v03-session-1.json",
      "--json",
    ]);
    expectCliSuccess(firstResult);
    const first = parseJsonOutput<CaptureResult>(firstResult.stdout);
    expect(first.snapshot.conflicts).toEqual([]);
    const decisionId = first.snapshot.context.decisions[0]?.id;
    expect(decisionId).toBeDefined();
    expect(first.snapshot.context.tasks[0]?.status).toBe("done_claimed");

    await writeProjectFile(
      root,
      ".session/v03-session-2.json",
      `${JSON.stringify(
        {
          decisions: [
            {
              summary: "Use SHA-256 plus Git evidence",
              rationale: "Git adds version context",
              supersedes: decisionId,
            },
          ],
          tasks: [
            {
              title: "Implement parser",
              status: "in_progress",
              notes: "Reopened after review found missing tests",
            },
          ],
        },
        null,
        2,
      )}\n`,
    );

    const secondResult = runCli(root, [
      "capture",
      "--input",
      ".session/v03-session-2.json",
      "--json",
    ]);
    expectCliSuccess(secondResult);
    const second = parseJsonOutput<CaptureResult>(secondResult.stdout);

    expect(second.snapshot.conflicts).toHaveLength(1);
    expect(second.snapshot.conflicts[0]).toMatchObject({
      kind: "task_reopened",
      previous: "done_claimed",
      incoming: "in_progress",
    });

    const task = second.snapshot.context.tasks[0];
    expect(task?.status).toBe("in_progress");
    expect(task?.statusHistory).toHaveLength(2);
    expect(task?.statusHistory[0]).toMatchObject({
      from: null,
      to: "done_claimed",
    });
    expect(task?.statusHistory[1]).toMatchObject({
      from: "done_claimed",
      to: "in_progress",
    });

    const oldDecision = second.snapshot.context.decisions.find(
      (decision) => decision.id === decisionId,
    );
    const newDecision = second.snapshot.context.decisions.find(
      (decision) => decision.id !== decisionId,
    );
    expect(oldDecision?.status).toBe("superseded");
    expect(oldDecision?.supersededBy).toBe(newDecision?.id);
    expect(newDecision).toMatchObject({
      status: "active",
      revision: 2,
      supersedes: decisionId,
    });

    expect(second.snapshot.delta?.decisionChanges).toEqual([
      {
        decisionId,
        summary: "Use SHA-256 file evidence",
        from: "active",
        to: "superseded",
      },
    ]);
    expect(second.snapshot.delta?.conflictsAdded).toEqual([
      second.snapshot.conflicts[0]?.id,
    ]);
    expect(
      second.warnings.some((warning) =>
        warning.includes("unresolved context conflict"),
      ),
    ).toBe(true);

    const markdown = await readProjectFile(
      root,
      second.relativeMarkdownPath,
    );
    expect(markdown).toContain("未解决冲突（1）");
    expect(markdown).toContain("任务被重新打开");
    expect(markdown).toContain("已被替代的决策");
    expect(markdown).toContain("决策状态变化");

    const resumeResult = runCli(root, ["resume", "--json"]);
    expectCliSuccess(resumeResult);
    const resume = parseJsonOutput<ResumeResult>(resumeResult.stdout);

    expect(resume.conflicts).toHaveLength(1);
    expect(resume.prompt).toContain("未解决冲突（必须先与用户确认）");
    expect(resume.prompt).toContain("任务被重新打开");
    expect(resume.prompt).toContain("已被替代的决策");
    expect(resume.prompt).toContain("Use SHA-256 plus Git evidence");
    expect(resume.prompt).toContain("rev 2");
    expect(resume.prompt).toContain("状态历史：done_claimed → in_progress");

    const conflictId = second.snapshot.conflicts[0]?.id;
    expect(conflictId).toBeDefined();

    const resolvedResult = runCli(root, [
      "capture",
      "--resolve-conflict",
      conflictId ?? "",
      "--json",
    ]);
    expectCliSuccess(resolvedResult);
    const resolved = parseJsonOutput<CaptureResult>(
      resolvedResult.stdout,
    );

    expect(resolved.resolvedConflicts).toEqual([conflictId]);
    expect(resolved.snapshot.conflicts).toEqual([]);
    expect(resolved.snapshot.delta?.conflictsAdded).toEqual([]);

    const afterResolution = parseJsonOutput<ResumeResult>(
      runCli(root, ["resume", "--json"]).stdout,
    );
    expect(afterResolution.conflicts).toEqual([]);

    const unknownResolution = runCli(root, [
      "capture",
      "--resolve-conflict",
      "conf_missing",
      "--json",
    ]);
    expect(unknownResolution.status).not.toBe(0);
    expect(unknownResolution.stderr).toContain(
      "Cannot resolve unknown or already resolved conflict id",
    );
  });
});
