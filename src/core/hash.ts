import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";

export type EvidenceReadFailureReason =
  | "missing"
  | "not-regular-file"
  | "too-large"
  | "unreadable";

export class EvidenceReadError extends Error {
  public readonly reason: EvidenceReadFailureReason;
  public readonly sizeBytes: number | null;

  public constructor(
    reason: EvidenceReadFailureReason,
    message: string,
    options?: { cause?: unknown; sizeBytes?: number },
  ) {
    super(message, { cause: options?.cause });
    this.name = "EvidenceReadError";
    this.reason = reason;
    this.sizeBytes = options?.sizeBytes ?? null;
  }
}

export interface FileFingerprint {
  sha256: string;
  sizeBytes: number;
  modifiedAt: string;
}

export async function fingerprintFile(
  absolutePath: string,
  maxBytes: number,
): Promise<FileFingerprint> {
  let stats;
  try {
    stats = await lstat(absolutePath);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    ) {
      throw new EvidenceReadError("missing", "File no longer exists.", {
        cause: error,
      });
    }
    throw new EvidenceReadError("unreadable", "Unable to inspect file.", {
      cause: error,
    });
  }

  if (!stats.isFile()) {
    throw new EvidenceReadError(
      "not-regular-file",
      "Path is not a regular file.",
      { sizeBytes: stats.size },
    );
  }

  if (stats.size > maxBytes) {
    throw new EvidenceReadError(
      "too-large",
      `File exceeds the ${maxBytes}-byte evidence limit.`,
      { sizeBytes: stats.size },
    );
  }

  let buffer: Buffer;
  try {
    buffer = await readFile(absolutePath);
  } catch (error) {
    throw new EvidenceReadError("unreadable", "Unable to read file.", {
      cause: error,
      sizeBytes: stats.size,
    });
  }

  if (buffer.byteLength > maxBytes) {
    throw new EvidenceReadError(
      "too-large",
      `File exceeds the ${maxBytes}-byte evidence limit.`,
      { sizeBytes: buffer.byteLength },
    );
  }

  return {
    sha256: createHash("sha256").update(buffer).digest("hex"),
    sizeBytes: buffer.byteLength,
    modifiedAt: stats.mtime.toISOString(),
  };
}
