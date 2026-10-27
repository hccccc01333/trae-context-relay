export {
  captureProject,
  type CaptureOptions,
  type CaptureResult,
} from "./core/capture.js";
export {
  resumeProject,
  type ResumeOptions,
} from "./core/resume.js";
export {
  listSnapshots,
  loadLatestSnapshot,
  loadLatestSnapshotOrNull,
  loadSnapshot,
  getDataPaths,
  type DataPaths,
  type SnapshotSummary,
  type StoredSnapshot,
} from "./core/store.js";
export {
  SnapshotSchema,
  CaptureInputFileSchema,
  ContextSchema,
} from "./core/schema.js";
export type {
  CaptureInputFile,
  Conflict,
  ConflictKind,
  Decision,
  DecisionStatus,
  DecisionStatusChange,
  EvidenceCollection,
  FileEvidence,
  GitSnapshot,
  GitStatus,
  ProjectInfo,
  Snapshot,
  SnapshotContext,
  SnapshotDelta,
  Task,
  TaskStatus,
  TaskStatusChange,
  TaskStatusHistoryEntry,
} from "./core/schema.js";
export type {
  EvidenceCheck,
  EvidenceCheckStatus,
  EvidenceSummary,
  GitRelation,
  GitVerification,
  ResumeResult,
} from "./core/resume-types.js";
export {
  TOOL_NAME,
  TOOL_VERSION,
  SNAPSHOT_SCHEMA_VERSION,
} from "./core/constants.js";
