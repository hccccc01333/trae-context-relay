import { execFile } from "node:child_process";
import {
  MAX_COMMITTED_PATHS,
  MAX_GIT_PATHS,
} from "./constants.js";
import { isExcludedPath } from "./exclusions.js";
import type { GitSnapshot, GitStatus } from "./schema.js";

interface GitCommandResult {
  ok: boolean;
  code: number | null;
  stdout: Buffer;
  stderr: Buffer;
}

interface ParsedStatus {
  status: GitStatus;
  changedFiles: string[];
  excludedPathCount: number;
}

export interface GitCaptureResult {
  snapshot: GitSnapshot | null;
  warnings: string[];
}

export interface GitCommitComparison {
  paths: string[];
  truncated: boolean;
  warning: string | null;
}

function runGit(cwd: string, args: string[]): Promise<GitCommandResult> {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      {
        cwd,
        encoding: "buffer",
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const code =
          error === null
            ? 0
            : typeof error.code === "number"
              ? error.code
              : null;
        resolve({
          ok: error === null && code === 0,
          code,
          stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout ?? ""),
          stderr: Buffer.isBuffer(stderr) ? stderr : Buffer.from(stderr ?? ""),
        });
      },
    );
  });
}

function stdoutText(result: GitCommandResult): string {
  return result.stdout.toString("utf8").trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function cap<T>(values: T[], limit: number): {
  values: T[];
  truncated: boolean;
} {
  if (values.length <= limit) {
    return { values, truncated: false };
  }
  return { values: values.slice(0, limit), truncated: true };
}

function parseStatusRecord(record: string): {
  x: string;
  y: string;
  path: string;
} | null {
  if (record.length < 4) {
    return null;
  }
  return {
    x: record[0] ?? " ",
    y: record[1] ?? " ",
    path: record.slice(3),
  };
}

export function parseGitStatus(input: Buffer | string): ParsedStatus {
  const text = Buffer.isBuffer(input) ? input.toString("utf8") : input;
  const fields = text.split("\0");
  const staged: string[] = [];
  const modified: string[] = [];
  const untracked: string[] = [];
  const deleted: string[] = [];
  const renamed: Array<{ from: string; to: string }> = [];
  const changedFiles: string[] = [];
  let excludedPathCount = 0;

  for (let index = 0; index < fields.length; index += 1) {
    const parsed = parseStatusRecord(fields[index] ?? "");
    if (parsed === null) {
      continue;
    }

    const isRename = parsed.x === "R" || parsed.y === "R";
    const isCopy = parsed.x === "C" || parsed.y === "C";
    const isRenameOrCopy = isRename || isCopy;
    const originalPath = isRenameOrCopy ? (fields[++index] ?? "") : null;
    const newPath = parsed.path;
    const paths = originalPath === null ? [newPath] : [newPath, originalPath];

    let excluded = false;
    for (const path of paths) {
      if (path.length === 0) {
        continue;
      }
      if (isExcludedPath(path)) {
        excluded = true;
      } else {
        changedFiles.push(path);
      }
    }

    if (excluded) {
      excludedPathCount += 1;
      continue;
    }
    if (newPath.length === 0) {
      continue;
    }

    if (parsed.x === "?") {
      untracked.push(newPath);
      continue;
    }

    if (parsed.y === "D" || parsed.x === "D") {
      deleted.push(newPath);
    } else if (isRenameOrCopy && originalPath !== null) {
      renamed.push({ from: originalPath, to: newPath });
    } else if (parsed.y !== " ") {
      modified.push(newPath);
    }

    if (parsed.x !== " " && parsed.x !== "?") {
      staged.push(newPath);
    }
  }

  const stagedCap = cap(unique(staged), MAX_GIT_PATHS);
  const modifiedCap = cap(unique(modified), MAX_GIT_PATHS);
  const untrackedCap = cap(unique(untracked), MAX_GIT_PATHS);
  const deletedCap = cap(unique(deleted), MAX_GIT_PATHS);
  const renamedCap = cap(renamed, MAX_GIT_PATHS);
  const changedCap = cap(unique(changedFiles), MAX_GIT_PATHS);
  const truncated =
    stagedCap.truncated ||
    modifiedCap.truncated ||
    untrackedCap.truncated ||
    deletedCap.truncated ||
    renamedCap.truncated ||
    changedCap.truncated;

  return {
    status: {
      staged: stagedCap.values,
      modified: modifiedCap.values,
      untracked: untrackedCap.values,
      deleted: deletedCap.values,
      renamed: renamedCap.values,
      clean:
        stagedCap.values.length === 0 &&
        modifiedCap.values.length === 0 &&
        untrackedCap.values.length === 0 &&
        deletedCap.values.length === 0 &&
        renamedCap.values.length === 0,
      truncated,
    },
    changedFiles: changedCap.values,
    excludedPathCount,
  };
}

export async function findGitRoot(cwd: string): Promise<string | null> {
  const result = await runGit(cwd, ["rev-parse", "--show-toplevel"]);
  if (!result.ok) {
    return null;
  }
  const root = stdoutText(result);
  return root.length > 0 ? root : null;
}

export async function getGitSnapshot(cwd: string): Promise<GitCaptureResult> {
  const root = await findGitRoot(cwd);
  if (root === null) {
    return {
      snapshot: null,
      warnings: [
        "No Git repository was found. Git state and Git-based evidence are unavailable.",
      ],
    };
  }

  const branchResult = await runGit(root, [
    "symbolic-ref",
    "--quiet",
    "--short",
    "HEAD",
  ]);
  const branch = branchResult.ok ? stdoutText(branchResult) : null;

  const headResult = await runGit(root, ["rev-parse", "HEAD"]);
  const head = headResult.ok ? stdoutText(headResult) : null;

  let headShort: string | null = null;
  let subject: string | null = null;
  if (head !== null) {
    const shortResult = await runGit(root, ["rev-parse", "--short=7", "HEAD"]);
    headShort = shortResult.ok ? stdoutText(shortResult) : head.slice(0, 7);
    const subjectResult = await runGit(root, [
      "log",
      "-1",
      "--pretty=%s",
      "HEAD",
    ]);
    subject = subjectResult.ok
      ? stdoutText(subjectResult) || null
      : null;
  }

  const upstreamResult = await runGit(root, [
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{u}",
  ]);
  const upstream = upstreamResult.ok ? stdoutText(upstreamResult) : null;

  const statusResult = await runGit(root, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--ignore-submodules=all",
  ]);
  if (!statusResult.ok) {
    return {
      snapshot: null,
      warnings: [
        `Git repository detected at ${root}, but git status failed. Git evidence was not recorded.`,
      ],
    };
  }

  const parsed = parseGitStatus(statusResult.stdout);
  const warnings: string[] = [];
  if (parsed.excludedPathCount > 0) {
    warnings.push(
      `${parsed.excludedPathCount} Git path(s) were hidden by ContextRelay's exclusion policy.`,
    );
  }
  if (parsed.status.truncated) {
    warnings.push(
      `Git status was capped at ${MAX_GIT_PATHS} paths per category.`,
    );
  }

  return {
    snapshot: {
      root,
      branch,
      detached: branch === null && head !== null,
      head,
      headShort,
      subject,
      upstream,
      status: parsed.status,
      changedFiles: parsed.changedFiles,
      truncated: parsed.status.truncated,
    },
    warnings,
  };
}

export function gitStatusFingerprint(status: GitStatus): string {
  const rows = [
    ...status.staged.map((path) => `staged:${path}`),
    ...status.modified.map((path) => `modified:${path}`),
    ...status.untracked.map((path) => `untracked:${path}`),
    ...status.deleted.map((path) => `deleted:${path}`),
    ...status.renamed.map((rename) => `renamed:${rename.from}->${rename.to}`),
  ];
  return rows.sort().join("\n");
}

export async function isAncestor(
  root: string,
  ancestor: string,
  descendant: string,
): Promise<boolean | null> {
  const result = await runGit(root, [
    "merge-base",
    "--is-ancestor",
    ancestor,
    descendant,
  ]);
  if (result.code === 0) {
    return true;
  }
  if (result.code === 1) {
    return false;
  }
  return null;
}

export async function getCommittedChanges(
  root: string,
  fromHead: string,
  toHead: string,
): Promise<GitCommitComparison> {
  const result = await runGit(root, [
    "diff",
    "--name-only",
    "-z",
    fromHead,
    toHead,
  ]);
  if (!result.ok) {
    return {
      paths: [],
      truncated: false,
      warning: "Unable to list files changed between the snapshot and current HEAD.",
    };
  }

  const paths = result.stdout
    .toString("utf8")
    .split("\0")
    .map((path) => path.trim())
    .filter(
      (path) =>
        path.length > 0 && !isExcludedPath(path),
    );
  const deduped = unique(paths);
  const capped = cap(deduped, MAX_COMMITTED_PATHS);

  return {
    paths: capped.values,
    truncated: capped.truncated,
    warning: capped.truncated
      ? `Committed file changes were capped at ${MAX_COMMITTED_PATHS} paths.`
      : null,
  };
}
