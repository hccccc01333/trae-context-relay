import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(
  fileURLToPath(new URL("..", import.meta.url)),
);
const TSX_CLI = path.join(PROJECT_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const CLI_ENTRY = path.join(PROJECT_ROOT, "src", "cli.ts");

export interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export async function createTempDir(prefix = "context-relay-test-"): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

export async function removeTempDir(directory: string): Promise<void> {
  await rm(directory, { recursive: true, force: true });
}

export async function writeProjectFile(
  root: string,
  relativePath: string,
  content: string,
): Promise<string> {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf8");
  return absolutePath;
}

export async function readProjectFile(
  root: string,
  relativePath: string,
): Promise<string> {
  return readFile(path.join(root, relativePath), "utf8");
}

export function runGit(root: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function runGitBuffer(root: string, args: string[]): Buffer {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "buffer",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export async function initializeGitRepo(root: string): Promise<void> {
  runGit(root, ["init", "-b", "main"]);
  runGit(root, ["config", "user.name", "ContextRelay Test"]);
  runGit(root, ["config", "user.email", "context-relay@example.com"]);
}

export function commitAll(root: string, message: string): string {
  runGit(root, ["add", "-A"]);
  runGit(root, ["commit", "-m", message]);
  return runGit(root, ["rev-parse", "HEAD"]);
}

export function runCli(cwd: string, args: string[]): CliResult {
  const result = spawnSync(process.execPath, [TSX_CLI, CLI_ENTRY, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 20 * 1024 * 1024,
    env: {
      ...process.env,
      NO_COLOR: "1",
    },
  });

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

export function parseJsonOutput<T>(stdout: string): T {
  return JSON.parse(stdout) as T;
}

export function expectCliSuccess(result: CliResult): void {
  if (result.status !== 0) {
    throw new Error(
      `CLI failed with status ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
}
