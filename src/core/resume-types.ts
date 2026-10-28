import type { Conflict, SnapshotContext } from "./schema.js";

export type EvidenceCheckStatus =
  | "verified"
  | "changed"
  | "missing"
  | "unverifiable";

export interface EvidenceCheck {
  path: string;
  status: EvidenceCheckStatus;
  expectedSha256: string;
  currentSha256: string | null;
  expectedSizeBytes: number;
  currentSizeBytes: number | null;
  reason: string | null;
}

export interface EvidenceSummary {
  total: number;
  verified: number;
  changed: number;
  missing: number;
  unverifiable: number;
}

export type GitRelation =
  | "same"
  | "advanced"
  | "diverged"
  | "rewound"
  | "unavailable";

export interface GitWorkingTreeComparison {
  comparable: boolean;
  same: boolean | null;
  newChanges: string[];
  resolvedChanges: string[];
  statusFingerprintChanged: boolean;
}

export interface GitVerification {
  available: boolean;
  relation: GitRelation;
  snapshotHead: string | null;
  currentHead: string | null;
  snapshotHeadShort: string | null;
  currentHeadShort: string | null;
  snapshotBranch: string | null;
  currentBranch: string | null;
  committedChanges: string[];
  committedChangesTruncated: boolean;
  workingTree: GitWorkingTreeComparison;
  notes: string[];
}

export interface ResumeResult {
  ok: true;
  compact: boolean;
  generatedAt: string;
  snapshotId: string;
  snapshotCreatedAt: string;
  snapshotPath: string;
  snapshotRoot: string;
  currentRoot: string;
  rootMatches: boolean;
  context: SnapshotContext;
  conflicts: Conflict[];
  evidence: {
    summary: EvidenceSummary;
    checks: EvidenceCheck[];
  };
  git: GitVerification;
  functionalVerification: {
    status: "not_verified";
    note: string;
  };
  warnings: string[];
  prompt: string;
}
