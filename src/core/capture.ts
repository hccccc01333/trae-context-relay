import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  FUNCTIONAL_VERIFICATION_NOTE,
  MAX_INPUT_FILE_BYTES,
  SNAPSHOT_SCHEMA_VERSION,
  TOOL_NAME,
  TOOL_VERSION,
} from "./constants.js";
import { mergeContext } from "./context.js";
import {
  buildEvidenceCandidates,
  collectEvidence,
} from "./evidence.js";
import { findGitRoot, getGitSnapshot } from "./git.js";
import { readProjectInfo } from "./project-info.js";
import {
  CaptureInputFileSchema,
  SnapshotSchema,
  type CaptureInputFile,
  type Conflict,
  type Snapshot,
  type SnapshotContext,
  type SnapshotDelta,
  type TaskInput,
} from "./schema.js";
import { loadLatestSnapshotOrNull, saveSnapshot } from "./store.js";
import { renderSnapshotMarkdown } from "./render.js";
import { scanProjectTree } from "./tree.js";
import { createSnapshotId } from "../utils/ids.js";
import { dedupeText, stripBom } from "../utils/text.js";

export interface CaptureOptions {
  cwd: string;
  inputFile?: string;
  goal?: string;
  decisions?: string[];
  tasks?: string[];
  nextSteps?: string[];
  notes?: string[];
  files?: string[];
  resolvedConflicts?: string[];
}

export interface CaptureResult {
  ok: true;
  snapshot: Snapshot;
  jsonPath: string;
  markdownPath: string;
  handoffPath: string;
  relativeJsonPath: string;
  relativeMarkdownPath: string;
  resolvedConflicts: string[];
  warnings: string[];
}

async function readInputFile(
  cwd: string,
  inputFile: string,
): Promise<CaptureInputFile> {
  const absolutePath = path.isAbsolute(inputFile)
    ? inputFile
    : path.resolve(cwd, inputFile);

  let fileStats;
  try {
    fileStats = await stat(absolutePath);
  } catch (error) {
    throw new Error(
      `Unable to read --input file ${absolutePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!fileStats.isFile()) {
    throw new Error(`--input path is not a regular file: ${absolutePath}`);
  }
  if (fileStats.size > MAX_INPUT_FILE_BYTES) {
    throw new Error(
      `--input file exceeds ${MAX_INPUT_FILE_BYTES} bytes: ${absolutePath}`,
    );
  }

  let raw: string;
  try {
    raw = await readFile(absolutePath, "utf8");
  } catch (error) {
    throw new Error(
      `Unable to read --input file ${absolutePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(stripBom(raw));
  } catch (error) {
    throw new Error(
      `--input file is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const parsed = CaptureInputFileSchema.safeParse(parsedJson);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => {
        const location = issue.path.length > 0 ? issue.path.join(".") : "root";
        return `${location}: ${issue.message}`;
      })
      .join("; ");
    throw new Error(`Invalid --input structure: ${details}`);
  }
  return parsed.data;
}

function buildDelta(
  parent: Snapshot | null,
  current: {
    context: SnapshotContext;
    evidence: Snapshot["evidence"];
    git: Snapshot["git"];
    conflicts: Conflict[];
  },
): SnapshotDelta | null {
  if (parent === null) {
    return null;
  }

  const parentEvidence = new Map(
    parent.evidence.files.map((file) => [file.path, file]),
  );
  const currentEvidence = new Map(
    current.evidence.files.map((file) => [file.path, file]),
  );
  const evidenceAdded = current.evidence.files
    .filter((file) => !parentEvidence.has(file.path))
    .map((file) => file.path);
  const evidenceChanged = current.evidence.files
    .filter((file) => {
      const previous = parentEvidence.get(file.path);
      return previous !== undefined && previous.sha256 !== file.sha256;
    })
    .map((file) => file.path);
  const evidenceRemoved = parent.evidence.files
    .filter((file) => !currentEvidence.has(file.path))
    .map((file) => file.path);

  const parentDecisionIds = new Set(
    parent.context.decisions.map((decision) => decision.id),
  );
  const parentDecisions = new Map(
    parent.context.decisions.map((decision) => [decision.id, decision]),
  );
  const decisionsAdded = current.context.decisions
    .filter((decision) => !parentDecisionIds.has(decision.id))
    .map((decision) => decision.id);
  const decisionChanges = current.context.decisions.flatMap((decision) => {
    const previous = parentDecisions.get(decision.id);
    if (previous === undefined || previous.status === decision.status) {
      return [];
    }
    return [
      {
        decisionId: decision.id,
        summary: decision.summary,
        from: previous.status,
        to: decision.status,
      },
    ];
  });

  const parentTaskIds = new Set(parent.context.tasks.map((task) => task.id));
  const parentTasks = new Map(
    parent.context.tasks.map((task) => [task.id, task]),
  );
  const tasksAdded = current.context.tasks
    .filter((task) => !parentTaskIds.has(task.id))
    .map((task) => task.id);
  const taskStatusChanges = current.context.tasks.flatMap((task) => {
    const previous = parentTasks.get(task.id);
    if (previous === undefined || previous.status === task.status) {
      return [];
    }
    return [
      {
        taskId: task.id,
        title: task.title,
        from: previous.status,
        to: task.status,
      },
    ];
  });

  const parentConflictIds = new Set(
    (parent.conflicts ?? []).map((conflict) => conflict.id),
  );
  const conflictsAdded = current.conflicts
    .filter((conflict) => !parentConflictIds.has(conflict.id))
    .map((conflict) => conflict.id);

  return {
    parentId: parent.id,
    evidenceAdded,
    evidenceChanged,
    evidenceRemoved,
    decisionsAdded,
    decisionChanges,
    tasksAdded,
    taskStatusChanges,
    conflictsAdded,
    gitHeadChanged: (parent.git?.head ?? null) !== (current.git?.head ?? null),
  };
}

export async function captureProject(
  options: CaptureOptions,
): Promise<CaptureResult> {
  const gitRoot = await findGitRoot(options.cwd);
  const root = gitRoot ?? path.resolve(options.cwd);
  const now = new Date();
  const createdAt = now.toISOString();

  const inputFile =
    options.inputFile !== undefined
      ? await readInputFile(options.cwd, options.inputFile)
      : null;
  const parentStored = await loadLatestSnapshotOrNull(root);
  const parent = parentStored?.snapshot ?? null;

  const gitResult = await getGitSnapshot(root);
  const projectInfo = await readProjectInfo(root);
  const treeResult = await scanProjectTree(root);

  const explicitFiles = [
    ...(inputFile?.files ?? []),
    ...(options.files ?? []),
  ];
  const candidateResult = buildEvidenceCandidates({
    root,
    explicitFiles,
    configFiles: projectInfo.configFiles,
    git: gitResult.snapshot,
  });
  const evidenceResult = await collectEvidence(
    root,
    candidateResult.candidates,
  );

  const cliGoal = options.goal?.trim() ? options.goal : undefined;
  const nextStepsInput =
    inputFile?.nextSteps !== undefined || (options.nextSteps?.length ?? 0) > 0
      ? [
          ...(inputFile?.nextSteps ?? []),
          ...(options.nextSteps ?? []),
        ]
      : undefined;

  const mergeResult = mergeContext(
    parent?.context ?? null,
    {
      ...(cliGoal !== undefined
        ? { goal: cliGoal }
        : inputFile?.goal !== undefined
          ? { goal: inputFile.goal }
          : {}),
      decisions: [
        ...(inputFile?.decisions ?? []),
        ...(options.decisions ?? []),
      ],
      tasks: [
        ...(inputFile?.tasks ?? []),
        ...(options.tasks ?? []).map(
          (title): TaskInput => ({ title }),
        ),
      ],
      ...(nextStepsInput !== undefined ? { nextSteps: nextStepsInput } : {}),
      notes: [
        ...(inputFile?.notes ?? []),
        ...(options.notes ?? []),
      ],
    },
    createdAt,
  );
  const context = mergeResult.context;
  const conflictsById = new Map(
    (parent?.conflicts ?? []).map((conflict) => [conflict.id, conflict]),
  );
  for (const conflict of mergeResult.conflicts) {
    conflictsById.set(conflict.id, conflict);
  }
  const resolvedConflictIds = [
    ...new Set([
      ...(inputFile?.resolvedConflicts ?? []),
      ...(options.resolvedConflicts ?? []),
    ]),
  ];
  for (const conflictId of resolvedConflictIds) {
    if (!conflictsById.has(conflictId)) {
      throw new Error(
        `Cannot resolve unknown or already resolved conflict id: ${conflictId}`,
      );
    }
  }
  const resolvedConflictSet = new Set(resolvedConflictIds);
  const conflicts = [...conflictsById.values()].filter(
    (conflict) => !resolvedConflictSet.has(conflict.id),
  );

  const warnings = dedupeText([
    ...gitResult.warnings,
    ...projectInfo.warnings,
    ...treeResult.warnings,
    ...candidateResult.warnings,
    ...evidenceResult.warnings,
    ...(context.goal === null
      ? ["No explicit project goal was recorded. List recovery quality may be limited."]
      : []),
    ...(evidenceResult.evidence.files.length === 0
      ? ["No file evidence was recorded. Run capture in a project with readable files or pass --file."]
      : []),
    ...(conflicts.length > 0
      ? [
          `检测到 ${conflicts.length} 个未解决上下文冲突，继续前请先运行 resume 逐条确认。`,
        ]
      : []),
  ]);

  const id = createSnapshotId(now);
  const delta = buildDelta(parent, {
    context,
    evidence: evidenceResult.evidence,
    git: gitResult.snapshot,
    conflicts,
  });

  const snapshot = SnapshotSchema.parse({
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    id,
    createdAt,
    tool: {
      name: TOOL_NAME,
      version: TOOL_VERSION,
    },
    project: projectInfo.project,
    git: gitResult.snapshot,
    tree: treeResult.tree,
    context,
    evidence: evidenceResult.evidence,
    verification: {
      fileEvidence: "sha256",
      functional: "not-verified",
      note: FUNCTIONAL_VERIFICATION_NOTE,
    },
    conflicts,
    delta,
    warnings,
  });

  const markdown = renderSnapshotMarkdown(snapshot);
  const saved = await saveSnapshot(root, snapshot, markdown);

  return {
    ok: true,
    snapshot,
    jsonPath: saved.jsonPath,
    markdownPath: saved.markdownPath,
    handoffPath: saved.handoffPath,
    relativeJsonPath: saved.relativeJsonPath,
    relativeMarkdownPath: saved.relativeMarkdownPath,
    resolvedConflicts: resolvedConflictIds,
    warnings,
  };
}
