import {
  createConflictId,
  createDecisionId,
  createTaskId,
} from "../utils/ids.js";
import { normalizeText } from "../utils/text.js";
import { MAX_NOTES } from "./constants.js";
import type {
  Conflict,
  Decision,
  DecisionInput,
  SnapshotContext,
  Task,
  TaskInput,
  TaskStatus,
} from "./schema.js";

export interface ContextUpdate {
  goal?: string;
  decisions?: DecisionInput[];
  tasks?: TaskInput[];
  nextSteps?: string[];
  notes?: string[];
}

export interface ContextMergeResult {
  context: SnapshotContext;
  conflicts: Conflict[];
}

interface NormalizedDecisionInput {
  id?: string;
  summary: string;
  rationale?: string;
  supersedes?: string;
}

function normalizeDecision(
  input: DecisionInput,
): NormalizedDecisionInput | null {
  if (typeof input === "string") {
    const summary = normalizeText(input);
    return summary.length > 0 ? { summary } : null;
  }

  const summary = normalizeText(input.summary);
  if (summary.length === 0) {
    return null;
  }
  const rationale = input.rationale
    ? normalizeText(input.rationale)
    : undefined;
  return {
    summary,
    ...(input.id ? { id: input.id } : {}),
    ...(rationale ? { rationale } : {}),
    ...(input.supersedes ? { supersedes: input.supersedes } : {}),
  };
}

function decisionKey(summary: string): string {
  return summary.trim().toLowerCase();
}

function createConflict(
  kind: Conflict["kind"],
  subjectId: string,
  subjectLabel: string,
  previous: string,
  incoming: string,
  detectedAt: string,
  note?: string,
): Conflict {
  return {
    id: createConflictId(kind, subjectId, detectedAt),
    kind,
    severity: "warning",
    subjectId,
    subjectLabel,
    previous,
    incoming,
    detectedAt,
    ...(note ? { note } : {}),
  };
}

function mergeDecisions(
  previous: Decision[],
  updates: DecisionInput[],
  now: string,
): { decisions: Decision[]; conflicts: Conflict[] } {
  const decisions = previous.map((decision) => ({ ...decision }));
  const byId = new Map(decisions.map((decision) => [decision.id, decision]));
  const activeBySummary = new Map(
    decisions
      .filter((decision) => decision.status === "active")
      .map((decision) => [decisionKey(decision.summary), decision]),
  );
  const conflicts: Conflict[] = [];

  for (const update of updates) {
    const normalized = normalizeDecision(update);
    if (normalized === null) {
      continue;
    }

    if (normalized.supersedes !== undefined) {
      const target = byId.get(normalized.supersedes);
      if (target === undefined) {
        throw new Error(
          `Cannot supersede unknown decision id: ${normalized.supersedes}`,
        );
      }
      if (target.status === "superseded") {
        throw new Error(
          `Decision ${target.id} is already superseded by ${
            target.supersededBy ?? "another decision"
          }.`,
        );
      }

      const revision = target.revision + 1;
      let id = normalized.id ?? createDecisionId(normalized.summary);
      if (id === target.id) {
        id = `${id}_r${revision}`;
      }
      if (byId.has(id)) {
        throw new Error(
          `Decision id already exists: ${id}. Choose a new id for the revision.`,
        );
      }

      const decision: Decision = {
        id,
        summary: normalized.summary,
        ...(normalized.rationale ? { rationale: normalized.rationale } : {}),
        createdAt: now,
        updatedAt: now,
        status: "active",
        revision,
        supersedes: target.id,
        supersededBy: null,
      };

      const targetKey = decisionKey(target.summary);
      if (activeBySummary.get(targetKey)?.id === target.id) {
        activeBySummary.delete(targetKey);
      }
      target.status = "superseded";
      target.supersededBy = id;
      target.updatedAt = now;

      decisions.push(decision);
      byId.set(decision.id, decision);
      activeBySummary.set(decisionKey(decision.summary), decision);
      continue;
    }

    const key = decisionKey(normalized.summary);
    const existing = activeBySummary.get(key);
    if (existing !== undefined) {
      const existingRationale = existing.rationale ?? "";
      const incomingRationale = normalized.rationale ?? "";
      if (existingRationale !== incomingRationale) {
        conflicts.push(
          createConflict(
            "decision_conflict",
            existing.id,
            existing.summary,
            existingRationale || "(no rationale)",
            incomingRationale || "(no rationale)",
            now,
            `请使用 supersedes: "${existing.id}" 显式修订该决策。`,
          ),
        );
      }
      continue;
    }

    let id = normalized.id ?? createDecisionId(normalized.summary);
    if (byId.has(id)) {
      throw new Error(
        `Decision id already exists: ${id}. Use supersedes to create a revision.`,
      );
    }

    const decision: Decision = {
      id,
      summary: normalized.summary,
      ...(normalized.rationale ? { rationale: normalized.rationale } : {}),
      createdAt: now,
      updatedAt: now,
      status: "active",
      revision: 1,
      supersedes: null,
      supersededBy: null,
    };

    decisions.push(decision);
    byId.set(id, decision);
    activeBySummary.set(key, decision);
  }

  return { decisions, conflicts };
}

function mergeTasks(
  previous: Task[],
  updates: TaskInput[],
  now: string,
): { tasks: Task[]; conflicts: Conflict[] } {
  const tasks = previous.map((task) => ({
    ...task,
    statusHistory: [...task.statusHistory],
  }));
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const byTitle = new Map(
    tasks.map((task) => [task.title.trim().toLowerCase(), task]),
  );
  const conflicts: Conflict[] = [];

  for (const update of updates) {
    const title = normalizeText(update.title);
    if (title.length === 0) {
      continue;
    }
    const titleKey = title.toLowerCase();
    const existing =
      (update.id ? byId.get(update.id) : undefined) ?? byTitle.get(titleKey);

    if (existing !== undefined) {
      let changed = false;
      const previousTitleKey = existing.title.trim().toLowerCase();
      if (normalizeText(existing.title) !== title) {
        existing.title = title;
        if (byTitle.get(previousTitleKey)?.id === existing.id) {
          byTitle.delete(previousTitleKey);
        }
        byTitle.set(titleKey, existing);
        changed = true;
      }
      if (update.status !== undefined && existing.status !== update.status) {
        if (
          existing.status === "done_claimed" &&
          update.status !== "done_claimed"
        ) {
          conflicts.push(
            createConflict(
              "task_reopened",
              existing.id,
              title,
              existing.status,
              update.status,
              now,
              "上一会话声明完成但未经功能验证；此处保留重新打开的状态作为冲突。",
            ),
          );
        } else if (
          existing.status === "blocked" &&
          update.status === "done_claimed"
        ) {
          conflicts.push(
            createConflict(
              "task_completed_from_blocked",
              existing.id,
              title,
              existing.status,
              update.status,
              now,
              "阻塞任务被声明完成，但没有记录解除阻塞的证据。",
            ),
          );
        }

        existing.statusHistory.push({
          from: existing.status,
          to: update.status,
          at: now,
        });
        existing.status = update.status;
        changed = true;
      }
      if (update.notes !== undefined) {
        const notes = normalizeText(update.notes);
        if (notes.length > 0 && existing.notes !== notes) {
          existing.notes = notes;
          changed = true;
        }
      }
      if (changed) {
        existing.updatedAt = now;
      }
      continue;
    }

    const status: TaskStatus = update.status ?? "todo";
    const notes = update.notes ? normalizeText(update.notes) : "";
    const task: Task = {
      id: update.id ?? createTaskId(title),
      title,
      status,
      ...(notes.length > 0 ? { notes } : {}),
      createdAt: now,
      updatedAt: now,
      statusHistory: [{ from: null, to: status, at: now }],
    };

    if (byId.has(task.id)) {
      throw new Error(`Duplicate task id supplied: ${task.id}`);
    }

    tasks.push(task);
    byId.set(task.id, task);
    byTitle.set(titleKey, task);
  }

  return { tasks, conflicts };
}

export function mergeContext(
  previous: SnapshotContext | null,
  update: ContextUpdate,
  now: string,
): ContextMergeResult {
  const goal =
    update.goal !== undefined
      ? normalizeText(update.goal) || null
      : (previous?.goal ?? null);

  const decisionMerge = mergeDecisions(
    previous?.decisions ?? [],
    update.decisions ?? [],
    now,
  );
  const taskMerge = mergeTasks(previous?.tasks ?? [], update.tasks ?? [], now);
  const nextSteps =
    update.nextSteps !== undefined
      ? update.nextSteps
          .map(normalizeText)
          .filter((value) => value.length > 0)
      : (previous?.nextSteps ?? []);

  const notes = [...(previous?.notes ?? [])];
  const seenNotes = new Set(notes);
  for (const note of update.notes ?? []) {
    const normalized = normalizeText(note);
    if (normalized.length > 0 && !seenNotes.has(normalized)) {
      notes.push(normalized);
      seenNotes.add(normalized);
    }
  }

  const conflicts: Conflict[] = [];
  const seenConflicts = new Set<string>();
  for (const conflict of [...decisionMerge.conflicts, ...taskMerge.conflicts]) {
    if (!seenConflicts.has(conflict.id)) {
      seenConflicts.add(conflict.id);
      conflicts.push(conflict);
    }
  }

  return {
    context: {
      goal,
      decisions: decisionMerge.decisions,
      tasks: taskMerge.tasks,
      nextSteps,
      notes: notes.slice(-MAX_NOTES),
    },
    conflicts,
  };
}
