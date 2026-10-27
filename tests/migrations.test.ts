import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateSnapshotToCurrent } from "../src/core/migrations.js";
import { SnapshotSchema } from "../src/core/schema.js";
import {
  loadLatestSnapshot,
  loadSnapshot,
  saveSnapshot,
} from "../src/core/store.js";
import {
  createTempDir,
  removeTempDir,
  writeProjectFile,
} from "./helpers.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map(removeTempDir));
});

const CREATED_AT = "2026-10-01T00:00:00.000Z";

function createV1Snapshot(id = "snap_20261001T000000000Z_v1") {
  return {
    schemaVersion: 1,
    id,
    createdAt: CREATED_AT,
    tool: { name: "context-relay", version: "0.2.0" },
    project: {
      root: "D:/demo",
      rootName: "demo",
      packageFile: "package.json",
      lockfile: null,
      name: "demo",
      version: "1.0.0",
      packageManager: "npm",
      scriptNames: ["test"],
      dependencyCount: 0,
      devDependencyCount: 0,
    },
    git: null,
    tree: { entries: [], truncated: false },
    context: {
      goal: "Migrate v1 snapshots",
      decisions: [
        {
          id: "dec_v1",
          summary: "Keep snapshots immutable",
          rationale: "Audit history",
          createdAt: CREATED_AT,
        },
      ],
      tasks: [
        {
          id: "task_v1",
          title: "Implement migration",
          status: "in_progress",
          createdAt: CREATED_AT,
          updatedAt: CREATED_AT,
        },
      ],
      nextSteps: [],
      notes: [],
    },
    evidence: {
      files: [],
      skipped: [],
      truncated: false,
    },
    verification: {
      fileEvidence: "sha256",
      functional: "not-verified",
      note: "Hash evidence only.",
    },
    delta: {
      parentId: null,
      evidenceAdded: [],
      evidenceChanged: [],
      evidenceRemoved: [],
      decisionsAdded: ["dec_v1"],
      tasksAdded: ["task_v1"],
      taskStatusChanges: [],
      gitHeadChanged: false,
    },
    warnings: [],
  };
}

describe("snapshot schema migration", () => {
  it("upgrades a v1 snapshot to the current schema with defaults", () => {
    const raw = createV1Snapshot();
    const migrated = migrateSnapshotToCurrent(raw);
    const parsed = SnapshotSchema.parse(migrated);

    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.conflicts).toEqual([]);
    expect(parsed.context.decisions[0]).toMatchObject({
      id: "dec_v1",
      status: "active",
      revision: 1,
      supersedes: null,
      supersededBy: null,
      updatedAt: null,
    });
    expect(parsed.context.tasks[0]?.statusHistory).toEqual([]);
    expect(parsed.delta?.decisionChanges).toEqual([]);
    expect(parsed.delta?.conflictsAdded).toEqual([]);
    expect(raw).toMatchObject({ schemaVersion: 1 });
  });

  it("loads migrated snapshots from disk without rewriting the source file", async () => {
    const root = await createTempDir("context-relay-migration-");
    tempDirectories.push(root);

    const id = "snap_20261001T000000000Z_v1";
    const v1 = createV1Snapshot(id);
    await writeProjectFile(
      root,
      path.join(".context-relay", "snapshots", `${id}.json`),
      `${JSON.stringify(v1, null, 2)}\n`,
    );

    const latest = await loadLatestSnapshot(root);
    expect(latest.snapshot.schemaVersion).toBe(2);
    expect(latest.snapshot.context.decisions[0]?.status).toBe("active");

    const byId = await loadSnapshot(root, id);
    expect(byId.snapshot.id).toBe(id);

    const stored = await loadSnapshot(root, id);
    expect(stored.snapshot.context.tasks[0]?.statusHistory).toEqual([]);
  });

  it("keeps current-schema snapshots unchanged", async () => {
    const root = await createTempDir("context-relay-migration-");
    tempDirectories.push(root);

    const id = "snap_20261002T000000000Z_v2";
    const migrated = SnapshotSchema.parse(
      migrateSnapshotToCurrent(createV1Snapshot(id)),
    );
    await saveSnapshot(root, migrated, "# Snapshot\n");

    const loaded = await loadSnapshot(root, id);
    expect(loaded.snapshot).toEqual(migrated);
  });
});
