import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  buildEvidenceCandidates,
} from "../src/core/evidence.js";
import { isExcludedPath } from "../src/core/exclusions.js";

describe("evidence exclusion policy", () => {
  it("excludes generated, hidden, and sensitive paths", () => {
    const excluded = [
      "node_modules/pkg/index.js",
      "dist/index.js",
      "coverage/lcov.info",
      ".context-relay/snapshots/snap_1.json",
      ".env",
      ".env.local",
      "config/.env",
      "certs/private.pem",
      "keys/service.key",
      "secrets/token.json",
      "src/.hidden/file.ts",
      "private.db",
    ];

    for (const file of excluded) {
      expect(isExcludedPath(file), file).toBe(true);
    }

    const included = [
      "src/index.ts",
      "tests/app.test.ts",
      "package.json",
      "README.md",
      "docs/architecture.md",
    ];
    for (const file of included) {
      expect(isExcludedPath(file), file).toBe(false);
    }
  });

  it("does not store excluded explicit files and rejects path traversal", () => {
    const root = path.join(tmpdir(), "context-relay-exclusion-root");
    const result = buildEvidenceCandidates({
      root,
      explicitFiles: [".env", "src/app.ts"],
      configFiles: ["package.json"],
      git: null,
    });

    expect(result.candidates.map((candidate) => candidate.relativePath)).toEqual(
      ["src/app.ts", "package.json"],
    );
    expect(result.warnings.join("\n")).toContain(".env");

    expect(() =>
      buildEvidenceCandidates({
        root,
        explicitFiles: ["../outside.ts"],
        configFiles: [],
        git: null,
      }),
    ).toThrow(/Invalid evidence path/);
  });
});
