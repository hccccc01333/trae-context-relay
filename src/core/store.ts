import {
  access,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  DATA_DIR_NAME,
  HANDOFF_FILE_NAME,
  SNAPSHOTS_DIR_NAME,
  SNAPSHOT_SCHEMA_VERSION,
  STORE_GITIGNORE,
} from "./constants.js";
import { migrateSnapshotToCurrent } from "./migrations.js";
import { SnapshotSchema, type Snapshot } from "./schema.js";
import { toPosixPath } from "../utils/path.js";

export interface DataPaths {
  root: string;
  dataDir: string;
  snapshotsDir: string;
  handoffPath: string;
}

export interface StoredSnapshot {
  snapshot: Snapshot;
  jsonPath: string;
  markdownPath: string;
  relativeJsonPath: string;
  relativeMarkdownPath: string;
}

export interface SnapshotSummary {
  id: string;
  createdAt: string;
  goal: string | null;
  gitHead: string | null;
  gitBranch: string | null;
  evidenceCount: number;
  jsonPath: string;
}

export interface SaveSnapshotResult {
  jsonPath: string;
  markdownPath: string;
  handoffPath: string;
  relativeJsonPath: string;
  relativeMarkdownPath: string;
}

export function getDataPaths(root: string): DataPaths {
  const dataDir = path.join(root, DATA_DIR_NAME);
  return {
    root,
    dataDir,
    snapshotsDir: path.join(dataDir, SNAPSHOTS_DIR_NAME),
    handoffPath: path.join(dataDir, HANDOFF_FILE_NAME),
  };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureStore(root: string): Promise<DataPaths> {
  const paths = getDataPaths(root);
  await mkdir(paths.snapshotsDir, { recursive: true });

  const ignorePath = path.join(paths.dataDir, ".gitignore");
  if (!(await pathExists(ignorePath))) {
    try {
      await writeFile(ignorePath, STORE_GITIGNORE, {
        encoding: "utf8",
        flag: "wx",
      });
    } catch (error) {
      if (
        !(
          error instanceof Error &&
          "code" in error &&
          error.code === "EEXIST"
        )
      ) {
        throw error;
      }
    }
  }

  return paths;
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporaryPath, content, "utf8");
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function validateSnapshotId(id: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error(
      "Snapshot id must contain only letters, digits, underscores, or hyphens.",
    );
  }
  return id;
}

export async function saveSnapshot(
  root: string,
  snapshot: Snapshot,
  markdown: string,
): Promise<SaveSnapshotResult> {
  const parsed = SnapshotSchema.parse(snapshot);
  const paths = await ensureStore(root);
  const jsonPath = path.join(paths.snapshotsDir, `${parsed.id}.json`);
  const markdownPath = path.join(paths.snapshotsDir, `${parsed.id}.md`);

  if (await pathExists(jsonPath)) {
    throw new Error(`Snapshot already exists: ${parsed.id}`);
  }

  await atomicWrite(jsonPath, `${JSON.stringify(parsed, null, 2)}\n`);
  await atomicWrite(markdownPath, markdown.endsWith("\n") ? markdown : `${markdown}\n`);
  await writeFile(
    paths.handoffPath,
    markdown.endsWith("\n") ? markdown : `${markdown}\n`,
    "utf8",
  );

  return {
    jsonPath,
    markdownPath,
    handoffPath: paths.handoffPath,
    relativeJsonPath: toPosixPath(path.relative(root, jsonPath)),
    relativeMarkdownPath: toPosixPath(path.relative(root, markdownPath)),
  };
}

async function snapshotJsonFiles(root: string): Promise<string[]> {
  const paths = getDataPaths(root);
  let entries;
  try {
    entries = await readdir(paths.snapshotsDir, { withFileTypes: true });
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort()
    .reverse();
}

async function readSnapshotFile(
  root: string,
  fileName: string,
): Promise<StoredSnapshot> {
  const paths = getDataPaths(root);
  const jsonPath = path.join(paths.snapshotsDir, fileName);
  const markdownPath = jsonPath.replace(/\.json$/, ".md");

  let raw: string;
  try {
    raw = await readFile(jsonPath, "utf8");
  } catch (error) {
    throw new Error(
      `Unable to read snapshot ${fileName}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error(
      `Snapshot ${fileName} is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const result = SnapshotSchema.safeParse(
    migrateSnapshotToCurrent(parsedJson),
  );
  if (!result.success) {
    throw new Error(
      `Snapshot ${fileName} does not match schema v${SNAPSHOT_SCHEMA_VERSION}: ${result.error.message}`,
    );
  }

  const expectedId = fileName.replace(/\.json$/, "");
  if (result.data.id !== expectedId) {
    throw new Error(
      `Snapshot file ${fileName} contains a different id: ${result.data.id}`,
    );
  }

  return {
    snapshot: result.data,
    jsonPath,
    markdownPath,
    relativeJsonPath: toPosixPath(path.relative(root, jsonPath)),
    relativeMarkdownPath: toPosixPath(path.relative(root, markdownPath)),
  };
}

export async function loadLatestSnapshotOrNull(
  root: string,
): Promise<StoredSnapshot | null> {
  const files = await snapshotJsonFiles(root);
  const latest = files[0];
  if (latest === undefined) {
    return null;
  }
  return readSnapshotFile(root, latest);
}

export async function loadLatestSnapshot(root: string): Promise<StoredSnapshot> {
  const latest = await loadLatestSnapshotOrNull(root);
  if (latest === null) {
    throw new Error(
      `No snapshots found in ${getDataPaths(root).snapshotsDir}. Run "context-relay capture" first.`,
    );
  }
  return latest;
}

export async function loadSnapshot(
  root: string,
  id: string,
): Promise<StoredSnapshot> {
  const safeId = validateSnapshotId(id);
  return readSnapshotFile(root, `${safeId}.json`);
}

export async function listSnapshots(root: string): Promise<SnapshotSummary[]> {
  const files = await snapshotJsonFiles(root);
  const summaries: SnapshotSummary[] = [];

  for (const fileName of files) {
    const stored = await readSnapshotFile(root, fileName);
    summaries.push({
      id: stored.snapshot.id,
      createdAt: stored.snapshot.createdAt,
      goal: stored.snapshot.context.goal,
      gitHead: stored.snapshot.git?.head ?? null,
      gitBranch: stored.snapshot.git?.branch ?? null,
      evidenceCount: stored.snapshot.evidence.files.length,
      jsonPath: stored.jsonPath,
    });
  }

  return summaries.sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
}
