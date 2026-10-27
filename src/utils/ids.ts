import { createHash, randomBytes } from "node:crypto";

function contentHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function createSnapshotId(date = new Date()): string {
  const timestamp = date
    .toISOString()
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace(".", "");
  return `snap_${timestamp}_${randomBytes(4).toString("hex")}`;
}

export function createDecisionId(summary: string): string {
  return `dec_${contentHash(summary.trim().toLowerCase()).slice(0, 12)}`;
}

export function createTaskId(title: string): string {
  return `task_${contentHash(title.trim().toLowerCase()).slice(0, 12)}`;
}

export function createConflictId(
  kind: string,
  subjectId: string,
  detectedAt: string,
): string {
  const seed = `${kind}:${subjectId}:${detectedAt}`;
  return `conf_${contentHash(seed).slice(0, 12)}`;
}
