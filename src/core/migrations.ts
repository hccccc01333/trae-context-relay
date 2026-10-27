import { SNAPSHOT_SCHEMA_VERSION } from "./constants.js";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function migrateDecision(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }
  return {
    ...value,
    status: value.status === "superseded" ? "superseded" : "active",
    revision:
      typeof value.revision === "number" && Number.isInteger(value.revision)
        ? value.revision
        : 1,
    supersedes:
      typeof value.supersedes === "string" ? value.supersedes : null,
    supersededBy:
      typeof value.supersededBy === "string" ? value.supersededBy : null,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null,
  };
}

function migrateTask(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }
  return {
    ...value,
    statusHistory: Array.isArray(value.statusHistory)
      ? value.statusHistory
      : [],
  };
}

/**
 * Upgrade stored snapshots that predate decision revisions and conflict
 * tracking. The returned value is still validated by SnapshotSchema.
 */
export function migrateSnapshotToCurrent(raw: unknown): unknown {
  if (!isRecord(raw)) {
    return raw;
  }
  if (raw.schemaVersion === SNAPSHOT_SCHEMA_VERSION) {
    return raw;
  }
  if (raw.schemaVersion !== 1) {
    return raw;
  }

  const migrated: JsonRecord = {
    ...raw,
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    conflicts: Array.isArray(raw.conflicts) ? raw.conflicts : [],
  };

  if (isRecord(raw.context)) {
    migrated.context = {
      ...raw.context,
      decisions: Array.isArray(raw.context.decisions)
        ? raw.context.decisions.map(migrateDecision)
        : raw.context.decisions,
      tasks: Array.isArray(raw.context.tasks)
        ? raw.context.tasks.map(migrateTask)
        : raw.context.tasks,
    };
  }

  if (isRecord(raw.delta)) {
    migrated.delta = {
      ...raw.delta,
      decisionChanges: Array.isArray(raw.delta.decisionChanges)
        ? raw.delta.decisionChanges
        : [],
      conflictsAdded: Array.isArray(raw.delta.conflictsAdded)
        ? raw.delta.conflictsAdded
        : [],
    };
  }

  return migrated;
}
