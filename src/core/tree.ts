import { readdir } from "node:fs/promises";
import path from "node:path";
import {
  MAX_TREE_DEPTH,
  MAX_TREE_ENTRIES,
} from "./constants.js";
import { isExcludedDirectoryName, isExcludedPath } from "./exclusions.js";
import type { ProjectTree, TreeEntry } from "./schema.js";
import { toPosixPath } from "../utils/path.js";

export interface TreeScanResult {
  tree: ProjectTree;
  warnings: string[];
  skippedSymlinks: number;
}

export async function scanProjectTree(root: string): Promise<TreeScanResult> {
  const entries: TreeEntry[] = [];
  const warnings: string[] = [];
  let truncated = false;
  let skippedSymlinks = 0;

  async function walk(
    absoluteDir: string,
    relativeDir: string,
    depth: number,
  ): Promise<void> {
    if (entries.length >= MAX_TREE_ENTRIES) {
      truncated = true;
      return;
    }

    let directoryEntries;
    try {
      directoryEntries = await readdir(absoluteDir, { withFileTypes: true });
    } catch (error) {
      warnings.push(
        `Unable to read directory ${relativeDir || "."}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }

    directoryEntries.sort((left, right) =>
      left.name.localeCompare(right.name, "en"),
    );

    for (const entry of directoryEntries) {
      if (entries.length >= MAX_TREE_ENTRIES) {
        truncated = true;
        break;
      }

      const relativePath = relativeDir
        ? `${relativeDir}/${entry.name}`
        : entry.name;

      if (
        entry.isSymbolicLink() ||
        isExcludedPath(relativePath) ||
        (entry.isDirectory() && isExcludedDirectoryName(entry.name))
      ) {
        if (entry.isSymbolicLink()) {
          skippedSymlinks += 1;
        }
        continue;
      }

      if (entry.isDirectory()) {
        entries.push({
          path: toPosixPath(relativePath),
          type: "directory",
        });
        if (depth >= MAX_TREE_DEPTH) {
          truncated = true;
        } else {
          await walk(
            path.join(absoluteDir, entry.name),
            relativePath,
            depth + 1,
          );
        }
      } else if (entry.isFile()) {
        entries.push({
          path: toPosixPath(relativePath),
          type: "file",
        });
      }
    }
  }

  await walk(root, "", 1);

  if (truncated) {
    warnings.push(
      `Directory tree was truncated at ${MAX_TREE_ENTRIES} entries or ${MAX_TREE_DEPTH} levels.`,
    );
  }
  if (skippedSymlinks > 0) {
    warnings.push(
      `${skippedSymlinks} symbolic link(s) were excluded from the directory tree.`,
    );
  }

  return {
    tree: { entries, truncated },
    warnings,
    skippedSymlinks,
  };
}
