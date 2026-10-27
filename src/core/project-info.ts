import { access, readFile } from "node:fs/promises";
import path from "node:path";
import type { ProjectInfo } from "./schema.js";
import { MAX_INPUT_FILE_BYTES } from "./constants.js";
import { stripBom } from "../utils/text.js";

interface Lockfile {
  name: string;
  packageManager: string;
}

const LOCKFILES: Lockfile[] = [
  { name: "pnpm-lock.yaml", packageManager: "pnpm" },
  { name: "yarn.lock", packageManager: "yarn" },
  { name: "bun.lockb", packageManager: "bun" },
  { name: "package-lock.json", packageManager: "npm" },
];

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function scriptNames(value: unknown): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [];
  }
  return Object.entries(value)
    .filter(([, entry]) => typeof entry === "string")
    .map(([name]) => name)
    .sort((left, right) => left.localeCompare(right, "en"));
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function dependencyCount(value: unknown): number {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return 0;
  }
  return Object.keys(value).length;
}

function declaredPackageManager(value: unknown): string | null {
  const raw = stringValue(value);
  if (raw === null) {
    return null;
  }
  const [name] = raw.split("@");
  return name && name.length > 0 ? name : null;
}

export interface ProjectInfoResult {
  project: ProjectInfo;
  warnings: string[];
  configFiles: string[];
}

export async function readProjectInfo(
  root: string,
): Promise<ProjectInfoResult> {
  const warnings: string[] = [];
  const configFiles: string[] = [];
  const packagePath = path.join(root, "package.json");

  let packageData: Record<string, unknown> | null = null;
  if (await exists(packagePath)) {
    configFiles.push("package.json");
    try {
      const raw = await readFile(packagePath, "utf8");
      if (Buffer.byteLength(raw, "utf8") > MAX_INPUT_FILE_BYTES) {
        warnings.push("package.json was too large to read as project metadata.");
      } else {
        const parsed: unknown = JSON.parse(stripBom(raw));
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          packageData = parsed as Record<string, unknown>;
        } else {
          warnings.push("package.json did not contain a JSON object.");
        }
      }
    } catch (error) {
      warnings.push(
        `Unable to read package.json: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  let lockfile: Lockfile | null = null;
  for (const candidate of LOCKFILES) {
    if (await exists(path.join(root, candidate.name))) {
      lockfile = candidate;
      configFiles.push(candidate.name);
      break;
    }
  }

  const packageManager =
    declaredPackageManager(packageData?.packageManager) ??
    lockfile?.packageManager ??
    null;

  return {
    project: {
      root,
      rootName: path.basename(root),
      packageFile: packageData === null ? null : "package.json",
      lockfile: lockfile?.name ?? null,
      name: stringValue(packageData?.name),
      version: stringValue(packageData?.version),
      packageManager,
      scriptNames: scriptNames(packageData?.scripts),
      dependencyCount: dependencyCount(packageData?.dependencies),
      devDependencyCount: dependencyCount(packageData?.devDependencies),
    },
    warnings,
    configFiles,
  };
}
