import { afterEach, describe, expect, it } from "vitest";
import { parseGitStatus } from "../src/core/git.js";
import {
  commitAll,
  createTempDir,
  initializeGitRepo,
  removeTempDir,
  runGit,
  runGitBuffer,
  writeProjectFile,
} from "./helpers.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map(removeTempDir));
});

describe("parseGitStatus", () => {
  it("parses NUL-delimited records, renames, deletions, and excluded paths", () => {
    const raw = Buffer.from(
      [
        " M src/modified.ts",
        "A  src/staged.ts",
        "?? src/untracked.ts",
        " D src/deleted.ts",
        "R  src/new-name.ts",
        "src/old-name.ts",
        "?? .env",
        "?? node_modules/pkg/index.js",
        "?? .context-relay/snapshots/x.json",
        "?? private.pem",
        " M .trae/skills/context-relay/SKILL.md",
        "?? .trae/settings.json",
        "",
      ].join("\0"),
    );

    const parsed = parseGitStatus(raw);

    expect(parsed.status.modified).toContain("src/modified.ts");
    expect(parsed.status.staged).toContain("src/staged.ts");
    expect(parsed.status.untracked).toContain("src/untracked.ts");
    expect(parsed.status.deleted).toContain("src/deleted.ts");
    expect(parsed.status.renamed).toEqual([
      { from: "src/old-name.ts", to: "src/new-name.ts" },
    ]);
    expect(parsed.changedFiles).toContain("src/new-name.ts");
    expect(parsed.changedFiles).toContain("src/old-name.ts");
    expect(parsed.changedFiles).toContain(
      ".trae/skills/context-relay/SKILL.md",
    );
    expect(parsed.changedFiles).not.toContain(".env");
    expect(parsed.changedFiles).not.toContain("node_modules/pkg/index.js");
    expect(parsed.changedFiles).not.toContain(
      ".context-relay/snapshots/x.json",
    );
    expect(parsed.changedFiles).not.toContain(".trae/settings.json");
    expect(parsed.excludedPathCount).toBe(5);
    expect(parsed.status.clean).toBe(false);
  });

  it("reads the real git rename field order with -z", async () => {
    const root = await createTempDir("context-relay-git-");
    tempDirectories.push(root);
    await initializeGitRepo(root);
    await writeProjectFile(root, "old-name.ts", "export const value = 1;\n");
    commitAll(root, "initial");

    runGit(root, ["mv", "old-name.ts", "new-name.ts"]);
    const rawStatus = runGitBuffer(root, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
    ]);
    const parsed = parseGitStatus(rawStatus);

    expect(parsed.status.renamed).toEqual([
      { from: "old-name.ts", to: "new-name.ts" },
    ]);
  });
});
