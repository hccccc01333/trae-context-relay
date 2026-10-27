import { z } from "zod";
import { SNAPSHOT_SCHEMA_VERSION, TOOL_NAME } from "./constants.js";

export const TaskStatusSchema = z.enum([
  "todo",
  "in_progress",
  "blocked",
  "done_claimed",
]);

export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const DecisionSchema = z.object({
  id: z.string().min(1),
  summary: z.string().min(1),
  rationale: z.string().min(1).optional(),
  createdAt: z.iso.datetime(),
});

export type Decision = z.infer<typeof DecisionSchema>;

export const TaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  status: TaskStatusSchema,
  notes: z.string().min(1).optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type Task = z.infer<typeof TaskSchema>;

export const ContextSchema = z.object({
  goal: z.string().min(1).nullable(),
  decisions: z.array(DecisionSchema),
  tasks: z.array(TaskSchema),
  nextSteps: z.array(z.string().min(1)),
  notes: z.array(z.string().min(1)),
});

export type SnapshotContext = z.infer<typeof ContextSchema>;

export const ProjectInfoSchema = z.object({
  root: z.string().min(1),
  rootName: z.string().min(1),
  packageFile: z.string().min(1).nullable(),
  lockfile: z.string().min(1).nullable(),
  name: z.string().min(1).nullable(),
  version: z.string().min(1).nullable(),
  packageManager: z.string().min(1).nullable(),
  scriptNames: z.array(z.string().min(1)),
  dependencyCount: z.number().int().nonnegative(),
  devDependencyCount: z.number().int().nonnegative(),
});

export type ProjectInfo = z.infer<typeof ProjectInfoSchema>;

export const GitRenameSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
});

export const GitStatusSchema = z.object({
  staged: z.array(z.string()),
  modified: z.array(z.string()),
  untracked: z.array(z.string()),
  deleted: z.array(z.string()),
  renamed: z.array(GitRenameSchema),
  clean: z.boolean(),
  truncated: z.boolean(),
});

export type GitStatus = z.infer<typeof GitStatusSchema>;

export const GitSnapshotSchema = z.object({
  root: z.string().min(1),
  branch: z.string().min(1).nullable(),
  detached: z.boolean(),
  head: z.string().min(1).nullable(),
  headShort: z.string().min(1).nullable(),
  subject: z.string().min(1).nullable(),
  upstream: z.string().min(1).nullable(),
  status: GitStatusSchema,
  changedFiles: z.array(z.string()),
  truncated: z.boolean(),
});

export type GitSnapshot = z.infer<typeof GitSnapshotSchema>;

export const TreeEntrySchema = z.object({
  path: z.string().min(1),
  type: z.enum(["file", "directory"]),
});

export type TreeEntry = z.infer<typeof TreeEntrySchema>;

export const ProjectTreeSchema = z.object({
  entries: z.array(TreeEntrySchema),
  truncated: z.boolean(),
});

export type ProjectTree = z.infer<typeof ProjectTreeSchema>;

export const EvidenceReasonSchema = z.enum([
  "explicit",
  "project-config",
  "git-status",
]);

export const FileEvidenceSchema = z.object({
  path: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  sizeBytes: z.number().int().nonnegative(),
  modifiedAt: z.iso.datetime(),
  reasons: z.array(EvidenceReasonSchema).min(1),
});

export type FileEvidence = z.infer<typeof FileEvidenceSchema>;

export const SkippedEvidenceSchema = z.object({
  path: z.string().min(1),
  reason: z.enum([
    "missing",
    "not-regular-file",
    "too-large",
    "unreadable",
  ]),
});

export type SkippedEvidence = z.infer<typeof SkippedEvidenceSchema>;

export const EvidenceCollectionSchema = z.object({
  files: z.array(FileEvidenceSchema),
  skipped: z.array(SkippedEvidenceSchema),
  truncated: z.boolean(),
});

export type EvidenceCollection = z.infer<typeof EvidenceCollectionSchema>;

export const VerificationSchema = z.object({
  fileEvidence: z.literal("sha256"),
  functional: z.literal("not-verified"),
  note: z.string().min(1),
});

export type Verification = z.infer<typeof VerificationSchema>;

export const TaskStatusChangeSchema = z.object({
  taskId: z.string().min(1),
  title: z.string().min(1),
  from: TaskStatusSchema.nullable(),
  to: TaskStatusSchema,
});

export type TaskStatusChange = z.infer<typeof TaskStatusChangeSchema>;

export const SnapshotDeltaSchema = z.object({
  parentId: z.string().min(1).nullable(),
  evidenceAdded: z.array(z.string()),
  evidenceChanged: z.array(z.string()),
  evidenceRemoved: z.array(z.string()),
  decisionsAdded: z.array(z.string()),
  tasksAdded: z.array(z.string()),
  taskStatusChanges: z.array(TaskStatusChangeSchema),
  gitHeadChanged: z.boolean(),
});

export type SnapshotDelta = z.infer<typeof SnapshotDeltaSchema>;

export const SnapshotSchema = z.object({
  schemaVersion: z.literal(SNAPSHOT_SCHEMA_VERSION),
  id: z.string().min(1),
  createdAt: z.iso.datetime(),
  tool: z.object({
    name: z.literal(TOOL_NAME),
    version: z.string().min(1),
  }),
  project: ProjectInfoSchema,
  git: GitSnapshotSchema.nullable(),
  tree: ProjectTreeSchema,
  context: ContextSchema,
  evidence: EvidenceCollectionSchema,
  verification: VerificationSchema,
  delta: SnapshotDeltaSchema.nullable(),
  warnings: z.array(z.string()),
});

export type Snapshot = z.infer<typeof SnapshotSchema>;

const DecisionInputSchema = z.union([
  z.string().min(1),
  z
    .object({
      summary: z.string().min(1),
      rationale: z.string().min(1).optional(),
    })
    .strict(),
]);

const TaskInputSchema = z
  .object({
    id: z.string().min(1).optional(),
    title: z.string().min(1),
    status: z
      .enum(["todo", "in_progress", "blocked", "done", "done_claimed"])
      .transform((value): TaskStatus =>
        value === "done" ? "done_claimed" : value,
      )
      .optional(),
    notes: z.string().min(1).optional(),
  })
  .strict();

export const CaptureInputFileSchema = z
  .object({
    goal: z.string().min(1).optional(),
    decisions: z.array(DecisionInputSchema).optional(),
    tasks: z.array(TaskInputSchema).optional(),
    nextSteps: z.array(z.string().min(1)).optional(),
    notes: z.array(z.string().min(1)).optional(),
    files: z.array(z.string().min(1)).optional(),
  })
  .strict();

export type CaptureInputFile = z.infer<typeof CaptureInputFileSchema>;
export type DecisionInput = z.infer<typeof DecisionInputSchema>;
export type TaskInput = z.infer<typeof TaskInputSchema>;
