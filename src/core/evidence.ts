import {
  MAX_EVIDENCE_FILES,
  MAX_EVIDENCE_FILE_BYTES,
} from "./constants.js";
import {
  EvidenceReadError,
  fingerprintFile,
} from "./hash.js";
import { isExcludedPath } from "./exclusions.js";
import type {
  EvidenceCollection,
  FileEvidence,
  GitSnapshot,
  SkippedEvidence,
} from "./schema.js";
import {
  normalizeRelativePath,
  resolveInsideRoot,
} from "../utils/path.js";
import { dedupeText } from "../utils/text.js";

export type EvidenceReason = FileEvidence["reasons"][number];

interface EvidenceCandidate {
  relativePath: string;
  reasons: Set<EvidenceReason>;
}

export interface CandidateBuildResult {
  candidates: EvidenceCandidate[];
  warnings: string[];
}

const REASON_ORDER: EvidenceReason[] = [
  "explicit",
  "git-status",
  "project-config",
];

export function buildEvidenceCandidates(input: {
  root: string;
  explicitFiles: string[];
  configFiles: string[];
  git: GitSnapshot | null;
}): CandidateBuildResult {
  const candidates = new Map<string, Set<EvidenceReason>>();
  const warnings: string[] = [];

  function add(rawPath: string, reason: EvidenceReason): void {
    const normalized = normalizeRelativePath(rawPath);
    if (normalized.length === 0 || normalized === ".") {
      return;
    }

    try {
      resolveInsideRoot(input.root, normalized);
    } catch (error) {
      throw new Error(
        `Invalid evidence path "${rawPath}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    if (isExcludedPath(normalized)) {
      warnings.push(
        `Evidence path "${normalized}" was skipped by the exclusion policy (generated, sensitive, and non-public hidden paths are never stored).`,
      );
      return;
    }

    const reasons = candidates.get(normalized);
    if (reasons === undefined) {
      candidates.set(normalized, new Set([reason]));
    } else {
      reasons.add(reason);
    }
  }

  for (const file of input.explicitFiles) {
    add(file, "explicit");
  }

  if (input.git !== null) {
    const removed = new Set([
      ...input.git.status.deleted,
      ...input.git.status.renamed.map((rename) => rename.from),
    ]);
    for (const changedFile of input.git.changedFiles) {
      if (!removed.has(changedFile)) {
        add(changedFile, "git-status");
      }
    }
  }

  for (const configFile of input.configFiles) {
    add(configFile, "project-config");
  }

  return {
    candidates: [...candidates.entries()].map(([relativePath, reasons]) => ({
      relativePath,
      reasons,
    })),
    warnings: dedupeText(warnings),
  };
}

function sortReasons(reasons: Set<EvidenceReason>): EvidenceReason[] {
  return REASON_ORDER.filter((reason) => reasons.has(reason));
}

export interface CollectEvidenceResult {
  evidence: EvidenceCollection;
  warnings: string[];
}

export async function collectEvidence(
  root: string,
  candidates: EvidenceCandidate[],
): Promise<CollectEvidenceResult> {
  const files: FileEvidence[] = [];
  const skipped: SkippedEvidence[] = [];
  const warnings: string[] = [];
  let truncated = false;

  for (let index = 0; index < candidates.length; index += 1) {
    if (files.length >= MAX_EVIDENCE_FILES) {
      truncated = true;
      break;
    }

    const candidate = candidates[index];
    if (candidate === undefined) {
      continue;
    }

    const resolved = resolveInsideRoot(root, candidate.relativePath);
    try {
      const fingerprint = await fingerprintFile(
        resolved.absolutePath,
        MAX_EVIDENCE_FILE_BYTES,
      );
      files.push({
        path: candidate.relativePath,
        sha256: fingerprint.sha256,
        sizeBytes: fingerprint.sizeBytes,
        modifiedAt: fingerprint.modifiedAt,
        reasons: sortReasons(candidate.reasons),
      });
    } catch (error) {
      if (error instanceof EvidenceReadError) {
        skipped.push({
          path: candidate.relativePath,
          reason: error.reason,
        });
        if (error.reason === "too-large") {
          warnings.push(
            `Evidence file "${candidate.relativePath}" was skipped because it exceeds ${MAX_EVIDENCE_FILE_BYTES} bytes.`,
          );
        } else if (error.reason === "not-regular-file") {
          warnings.push(
            `Evidence path "${candidate.relativePath}" is not a regular file and was skipped.`,
          );
        } else if (error.reason === "unreadable") {
          warnings.push(
            `Evidence file "${candidate.relativePath}" could not be read and was skipped.`,
          );
        } else if (error.reason === "missing") {
          warnings.push(
            `Evidence file "${candidate.relativePath}" no longer exists and was skipped.`,
          );
        }
        continue;
      }

      throw error;
    }
  }

  if (truncated) {
    warnings.push(
      `Evidence was capped at ${MAX_EVIDENCE_FILES} files. Pass important files with --file for priority.`,
    );
  }

  return {
    evidence: { files, skipped, truncated },
    warnings: dedupeText(warnings),
  };
}
