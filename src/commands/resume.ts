import { resumeProject } from "../core/resume.js";
import { writeJson } from "./io.js";

export interface ResumeCliInput {
  cwd: string;
  snapshotId?: string;
  json: boolean;
}

export async function runResumeCommand(
  input: ResumeCliInput,
): Promise<void> {
  const result = await resumeProject({
    cwd: input.cwd,
    snapshotId: input.snapshotId,
  });

  if (input.json) {
    writeJson(result);
    return;
  }

  process.stdout.write(result.prompt.endsWith("\n") ? result.prompt : `${result.prompt}\n`);
}
