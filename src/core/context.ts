import { createDecisionId, createTaskId } from "../utils/ids.js";
import { normalizeText } from "../utils/text.js";
import { MAX_NOTES } from "./constants.js";
import type {
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

function normalizeDecision(input: DecisionInput): {
  summary: string;
  rationale?: string;
} | null {
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
  return rationale ? { summary, rationale } : { summary };
}

function mergeDecisions(
  previous: Decision[],
  updates: DecisionInput[],
  now: string,
): Decision[] {
  const result = [...previous];
  const known = new Set(
    previous.map((decision) => decision.summary.trim().toLowerCase()),
  );

  for (const update of updates) {
    const normalized = normalizeDecision(update);
    if (normalized === null) {
      continue;
    }

    const key = normalized.summary.toLowerCase();
    if (known.has(key)) {
      continue;
    }
    known.add(key);
    result.push({
      id: createDecisionId(normalized.summary),
      summary: normalized.summary,
      ...(normalized.rationale ? { rationale: normalized.rationale } : {}),
      createdAt: now,
    });
  }

  return result;
}

function mergeTasks(
  previous: Task[],
  updates: TaskInput[],
  now: string,
): Task[] {
  const result = previous.map((task) => ({ ...task }));
  const byId = new Map(result.map((task) => [task.id, task]));
  const byTitle = new Map(
    result.map((task) => [task.title.trim().toLowerCase(), task]),
  );

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
      if (normalizeText(existing.title) !== title) {
        existing.title = title;
        changed = true;
        byTitle.set(titleKey, existing);
      }
      if (update.status !== undefined && existing.status !== update.status) {
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
    };

    if (byId.has(task.id)) {
      throw new Error(`Duplicate task id supplied: ${task.id}`);
    }

    result.push(task);
    byId.set(task.id, task);
    byTitle.set(titleKey, task);
  }

  return result;
}

export function mergeContext(
  previous: SnapshotContext | null,
  update: ContextUpdate,
  now: string,
): SnapshotContext {
  const goal =
    update.goal !== undefined
      ? normalizeText(update.goal) || null
      : (previous?.goal ?? null);

  const decisions = mergeDecisions(
    previous?.decisions ?? [],
    update.decisions ?? [],
    now,
  );
  const tasks = mergeTasks(previous?.tasks ?? [], update.tasks ?? [], now);
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

  return {
    goal,
    decisions,
    tasks,
    nextSteps,
    notes: notes.slice(-MAX_NOTES),
  };
}
