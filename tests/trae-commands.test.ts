import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PROJECT_ROOT = path.resolve(
  fileURLToPath(new URL("..", import.meta.url)),
);
const COMMANDS_DIR = path.join(PROJECT_ROOT, ".trae", "commands");
const SKILL_PATH = ".trae/skills/context-relay/SKILL.md";
const COMMAND_NAME_PATTERN = /^[\p{L}\d_\-\.]+$/u;

interface PromptCommand {
  fileName: string;
  name: string;
  description: string;
  argumentHint: string;
  body: string;
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (match === null) {
    throw new Error("Prompt command is missing YAML frontmatter");
  }

  const fields: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key.length > 0) {
      fields[key] = value;
    }
  }
  return fields;
}

async function readPromptCommand(fileName: string): Promise<PromptCommand> {
  const content = await readFile(path.join(COMMANDS_DIR, fileName), "utf8");
  const fields = parseFrontmatter(content);
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  return {
    fileName,
    name: fields.name ?? "",
    description: fields.description ?? "",
    argumentHint: fields["argument-hint"] ?? "",
    body,
  };
}

describe("TRAE prompt commands", () => {
  it("registers handoff and resume as native prompt files", async () => {
    const files = (await readdir(COMMANDS_DIR))
      .filter((fileName) => fileName.endsWith(".prompt.md"))
      .sort();
    expect(files).toEqual(["handoff.prompt.md", "resume.prompt.md"]);

    for (const fileName of files) {
      const command = await readPromptCommand(fileName);
      const expectedName = fileName.replace(/\.prompt\.md$/, "");
      expect(command.name, fileName).toBe(expectedName);
      expect(command.name, fileName).toMatch(COMMAND_NAME_PATTERN);
      expect(command.description.length, fileName).toBeGreaterThan(0);
      expect(command.argumentHint.length, fileName).toBeGreaterThan(0);
      expect(command.body, fileName).toContain(SKILL_PATH);
    }
  });

  it("maps each command to the matching skill workflow", async () => {
    const handoff = await readPromptCommand("handoff.prompt.md");
    expect(handoff.body).toContain("工作流 A");
    expect(handoff.body).toContain("capture --input");

    const resume = await readPromptCommand("resume.prompt.md");
    expect(resume.body).toContain("工作流 B");
    expect(resume.body).toContain("resume --snapshot");
  });
});
