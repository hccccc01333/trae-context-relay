import path from "node:path";

export function toPosixPath(value: string): string {
  return value.replaceAll("\\", "/");
}

export function normalizeRelativePath(value: string): string {
  const slashPath = toPosixPath(value).trim();
  return path.posix.normalize(slashPath).replace(/^\.\//, "");
}

export function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative !== "" &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== ".." &&
    !path.isAbsolute(relative)
  );
}

export function resolveInsideRoot(
  root: string,
  inputPath: string,
): { absolutePath: string; relativePath: string } {
  const normalized = toPosixPath(inputPath).trim();

  if (normalized.length === 0) {
    throw new Error("A file path cannot be empty.");
  }
  if (normalized.includes("\0")) {
    throw new Error("A file path cannot contain NUL bytes.");
  }
  if (path.posix.isAbsolute(normalized) || /^[A-Za-z]:\//.test(normalized)) {
    throw new Error(`Expected a project-relative path, received: ${inputPath}`);
  }

  const segments = normalized.split("/");
  if (segments.includes("..")) {
    throw new Error(`Path traversal is not allowed: ${inputPath}`);
  }

  const absoluteRoot = path.resolve(root);
  const absolutePath = path.resolve(absoluteRoot, normalized);
  const relative = path.relative(absoluteRoot, absolutePath);

  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Path escapes the project root: ${inputPath}`);
  }

  return {
    absolutePath,
    relativePath: toPosixPath(relative),
  };
}
