import { lstat } from "node:fs/promises";
import path from "node:path";
import {
  FUNCTIONAL_VERIFICATION_NOTE,
  MAX_EVIDENCE_FILE_BYTES,
} from "./constants.js";
import {
  getCommittedChanges,
  getGitSnapshot,
  gitStatusFingerprint,
  isAncestor,
} from "./git.js";
import { EvidenceReadError, fingerprintFile } from "./hash.js";
import { renderResumePrompt } from "./render.js";
import type {
  EvidenceCheck,
  EvidenceSummary,
  GitVerification,
  ResumeResult,
} from "./resume-types.js";
import type { FileEvidence, Snapshot } from "./schema.js";
import {
  findGitRoot,
} from "./git.js";
import {
  loadLatestSnapshot,
  loadSnapshot,
} from "./store.js";
import { resolveInsideRoot } from "../utils/path.js";
import { dedupeText } from "../utils/text.js";

export interface ResumeOptions {
  cwd: string;
  snapshotId?: string;
}

function isSamePath(left: string, right: string): boolean {
  const relative = path.relative(path.resolve(left), path.resolve(right));
  if (relative !== "") {
    return false;
  }
  if (process.platform === "win32") {
    return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
  }
  return true;
}

async function verifyEvidenceFile(
  root: string,
  file: FileEvidence,
): Promise<EvidenceCheck> {
  const base: EvidenceCheck = {
    path: file.path,
    status: "unverifiable",
    expectedSha256: file.sha256,
    currentSha256: null,
    expectedSizeBytes: file.sizeBytes,
    currentSizeBytes: null,
    reason: null,
  };

  let resolved;
  try {
    resolved = resolveInsideRoot(root, file.path);
  } catch (error) {
    return {
      ...base,
      reason: `快照中的路径不合法：${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  let stats;
  try {
    stats = await lstat(resolved.absolutePath);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    ) {
      return {
        ...base,
        status: "missing",
        reason: "文件不存在",
      };
    }
    return {
      ...base,
      reason: `无法读取文件状态：${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  if (!stats.isFile()) {
    return {
      ...base,
      currentSizeBytes: stats.size,
      reason: "路径不再是普通文件（可能是目录或符号链接）",
    };
  }

  if (stats.size > MAX_EVIDENCE_FILE_BYTES) {
    return {
      ...base,
      status: stats.size === file.sizeBytes ? "unverifiable" : "changed",
      currentSizeBytes: stats.size,
      reason: `当前文件超过 ${MAX_EVIDENCE_FILE_BYTES} 字节的哈希上限，未重新计算 SHA-256`,
    };
  }

  try {
    const fingerprint = await fingerprintFile(
      resolved.absolutePath,
      MAX_EVIDENCE_FILE_BYTES,
    );
    const sameHash = fingerprint.sha256 === file.sha256;
    return {
      ...base,
      status: sameHash ? "verified" : "changed",
      currentSha256: fingerprint.sha256,
      currentSizeBytes: fingerprint.sizeBytes,
      reason: sameHash ? null : "文件内容哈希已变化",
    };
  } catch (error) {
    if (error instanceof EvidenceReadError) {
      if (error.reason === "missing") {
        return { ...base, status: "missing", reason: "文件不存在" };
      }
      return {
        ...base,
        currentSizeBytes: error.sizeBytes,
        reason:
          error.reason === "too-large"
            ? "文件超过哈希上限"
            : error.reason === "not-regular-file"
              ? "路径不是普通文件"
              : "文件无法读取",
      };
    }
    return {
      ...base,
      reason: `文件校验失败：${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

function summarizeEvidence(checks: EvidenceCheck[]): EvidenceSummary {
  const summary: EvidenceSummary = {
    total: checks.length,
    verified: 0,
    changed: 0,
    missing: 0,
    unverifiable: 0,
  };

  for (const check of checks) {
    summary[check.status] += 1;
  }
  return summary;
}

function pathSetDifference(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((value) => !rightSet.has(value));
}

async function verifyGitState(
  root: string,
  snapshot: Snapshot,
): Promise<GitVerification> {
  const emptyWorkingTree: GitVerification["workingTree"] = {
    comparable: false,
    same: null,
    newChanges: [],
    resolvedChanges: [],
    statusFingerprintChanged: false,
  };

  const currentResult = await getGitSnapshot(root);
  const current = currentResult.snapshot;
  const previous = snapshot.git;
  const notes = [...currentResult.warnings];

  if (previous === null) {
    notes.push("快照中没有 Git 证据，无法比较 HEAD 或工作区。");
  }
  if (current === null) {
    notes.push("当前目录没有可用的 Git 状态。");
  }

  if (previous === null || current === null) {
    return {
      available: false,
      relation: "unavailable",
      snapshotHead: previous?.head ?? null,
      currentHead: current?.head ?? null,
      snapshotHeadShort: previous?.headShort ?? null,
      currentHeadShort: current?.headShort ?? null,
      snapshotBranch: previous?.branch ?? null,
      currentBranch: current?.branch ?? null,
      committedChanges: [],
      committedChangesTruncated: false,
      workingTree: emptyWorkingTree,
      notes,
    };
  }

  let relation: GitVerification["relation"] = "same";
  let committedChanges: string[] = [];
  let committedChangesTruncated = false;

  if (previous.head !== current.head) {
    if (previous.head === null && current.head !== null) {
      relation = "advanced";
    } else if (previous.head !== null && current.head === null) {
      relation = "diverged";
      notes.push("当前仓库没有 HEAD 提交，无法与快照 HEAD 建立祖先关系。");
    } else if (previous.head !== null && current.head !== null) {
      const previousIsAncestor = await isAncestor(
        current.root,
        previous.head,
        current.head,
      );
      if (previousIsAncestor === true) {
        relation = "advanced";
        const comparison = await getCommittedChanges(
          current.root,
          previous.head,
          current.head,
        );
        committedChanges = comparison.paths;
        committedChangesTruncated = comparison.truncated;
        if (comparison.warning !== null) {
          notes.push(comparison.warning);
        }
      } else {
        const currentIsAncestor = await isAncestor(
          current.root,
          current.head,
          previous.head,
        );
        relation = currentIsAncestor === true ? "rewound" : "diverged";
        notes.push(
          relation === "rewound"
            ? "当前 HEAD 是快照 HEAD 的祖先，历史可能被回退。"
            : "无法建立快照 HEAD 与当前 HEAD 的祖先关系，历史可能被改写或来自不同仓库。",
        );
      }
    }
  }

  const snapshotRootDiffers =
    path.resolve(previous.root) !== path.resolve(current.root);
  if (snapshotRootDiffers) {
    notes.push(
      `Git 根目录发生变化：${previous.root} -> ${current.root}`,
    );
  }
  if (previous.branch !== current.branch) {
    notes.push(
      `分支发生变化：${previous.branch ?? "detached/unknown"} -> ${
        current.branch ?? "detached/unknown"
      }。`,
    );
  }

  let workingTree: GitVerification["workingTree"] = emptyWorkingTree;
  if (!previous.truncated && !current.truncated) {
    const previousFingerprint = gitStatusFingerprint(previous.status);
    const currentFingerprint = gitStatusFingerprint(current.status);
    const same = previousFingerprint === currentFingerprint;
    workingTree = {
      comparable: true,
      same,
      newChanges: pathSetDifference(
        current.changedFiles,
        previous.changedFiles,
      ),
      resolvedChanges: pathSetDifference(
        previous.changedFiles,
        current.changedFiles,
      ),
      statusFingerprintChanged: !same,
    };
  } else {
    notes.push("Git 路径列表被截断，无法可靠比较完整工作区状态。");
  }

  if (previous.status.truncated || current.status.truncated) {
    notes.push("至少一侧的 Git 状态被截断，请手动检查完整 git status。");
  }

  return {
    available: true,
    relation,
    snapshotHead: previous.head,
    currentHead: current.head,
    snapshotHeadShort: previous.headShort,
    currentHeadShort: current.headShort,
    snapshotBranch: previous.branch,
    currentBranch: current.branch,
    committedChanges,
    committedChangesTruncated,
    workingTree,
    notes: dedupeText(notes),
  };
}

export async function resumeProject(
  options: ResumeOptions,
): Promise<ResumeResult> {
  const gitRoot = await findGitRoot(options.cwd);
  const currentRoot = gitRoot ?? path.resolve(options.cwd);

  const stored =
    options.snapshotId !== undefined
      ? await loadSnapshot(currentRoot, options.snapshotId)
      : await loadLatestSnapshot(currentRoot);
  const snapshot = stored.snapshot;

  const evidenceChecks: EvidenceCheck[] = [];
  for (const file of snapshot.evidence.files) {
    evidenceChecks.push(await verifyEvidenceFile(currentRoot, file));
  }
  const evidenceSummary = summarizeEvidence(evidenceChecks);

  const git = await verifyGitState(currentRoot, snapshot);
  const rootMatches = isSamePath(snapshot.project.root, currentRoot);

  const warnings = dedupeText([
    ...snapshot.warnings,
    ...git.notes,
    ...(rootMatches
      ? []
      : [
          `快照记录的项目根目录为 ${snapshot.project.root}，当前校验目录为 ${currentRoot}。证据已按当前目录重新计算。`,
        ]),
    ...(evidenceSummary.total === 0
      ? ["快照中没有文件证据，恢复时必须重新检查项目状态。"]
      : []),
    ...(evidenceSummary.changed > 0
      ? ["存在哈希变化的文件，上一会话的结论可能已经失效。"]
      : []),
    ...(evidenceSummary.missing > 0
      ? ["存在已缺失的证据文件，不要假设对应工作仍然存在。"]
      : []),
  ]);

  const result: ResumeResult = {
    ok: true,
    generatedAt: new Date().toISOString(),
    snapshotId: snapshot.id,
    snapshotCreatedAt: snapshot.createdAt,
    snapshotPath: stored.relativeJsonPath,
    snapshotRoot: snapshot.project.root,
    currentRoot,
    rootMatches,
    context: snapshot.context,
    evidence: {
      summary: evidenceSummary,
      checks: evidenceChecks,
    },
    git,
    functionalVerification: {
      status: "not_verified",
      note: FUNCTIONAL_VERIFICATION_NOTE,
    },
    warnings,
    prompt: "",
  };

  result.prompt = renderResumePrompt(result, snapshot);
  return result;
}
