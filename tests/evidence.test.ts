import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_EVIDENCE_FILE_BYTES,
} from "../src/core/constants.js";
import {
  buildEvidenceCandidates,
  collectEvidence,
} from "../src/core/evidence.js";
import {
  createTempDir,
  removeTempDir,
} from "./helpers.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map(removeTempDir));
});

describe("file evidence collection", () => {
  it("hashes regular files and skips files above the evidence limit", async () => {
    const root = await createTempDir("context-relay-evidence-");
    tempDirectories.push(root);
    const content = "export const verified = true;\n";
    await writeFile(path.join(root, "small.ts"), content, "utf8");
    await writeFile(
      path.join(root, "large.bin"),
      Buffer.alloc(MAX_EVIDENCE_FILE_BYTES + 1),
    );

    const result = await collectEvidence(root, [
      {
        relativePath: "small.ts",
        reasons: new Set(["explicit"]),
      },
      {
        relativePath: "large.bin",
        reasons: new Set(["explicit"]),
      },
    ]);

    expect(result.evidence.files).toHaveLength(1);
    expect(result.evidence.files[0]?.path).toBe("small.ts");
    expect(result.evidence.files[0]?.sha256).toBe(
      createHash("sha256").update(content).digest("hex"),
    );
    expect(result.evidence.skipped).toEqual([
      { path: "large.bin", reason: "too-large" },
    ]);
    expect(result.warnings.join("\n")).toContain("exceeds");
  });

  it("collects an explicitly requested public TRAE skill file", async () => {
    const root = await createTempDir("context-relay-skill-evidence-");
    tempDirectories.push(root);
    const relativePath = ".trae/skills/demo/SKILL.md";
    const content = "---\nname: demo\ndescription: demo skill\n---\n";
    const absolutePath = path.join(root, ".trae", "skills", "demo", "SKILL.md");
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");

    const candidates = buildEvidenceCandidates({
      root,
      explicitFiles: [relativePath],
      configFiles: [],
      git: null,
    });

    expect(candidates.warnings).toEqual([]);
    expect(candidates.candidates.map((candidate) => candidate.relativePath)).toEqual([
      relativePath,
    ]);

    const result = await collectEvidence(root, candidates.candidates);
    expect(result.evidence.files).toHaveLength(1);
    expect(result.evidence.files[0]?.path).toBe(relativePath);
    expect(result.evidence.files[0]?.sha256).toBe(
      createHash("sha256").update(content).digest("hex"),
    );
  });
});
