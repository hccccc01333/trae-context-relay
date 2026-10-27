import { captureProject } from "../core/capture.js";
import { truncateMiddle } from "../utils/text.js";
import { writeJson } from "./io.js";

export interface CaptureCliInput {
  cwd: string;
  inputFile?: string;
  goal?: string;
  decisions?: string[];
  tasks?: string[];
  nextSteps?: string[];
  notes?: string[];
  files?: string[];
  resolvedConflicts?: string[];
  json: boolean;
}

export async function runCaptureCommand(
  input: CaptureCliInput,
): Promise<void> {
  const result = await captureProject({
    cwd: input.cwd,
    inputFile: input.inputFile,
    goal: input.goal,
    decisions: input.decisions,
    tasks: input.tasks,
    nextSteps: input.nextSteps,
    notes: input.notes,
    files: input.files,
    resolvedConflicts: input.resolvedConflicts,
  });

  if (input.json) {
    writeJson(result);
    return;
  }

  const snapshot = result.snapshot;
  const gitState =
    snapshot.git === null
      ? "unavailable"
      : `${snapshot.git.branch ?? "detached HEAD"} @ ${
          snapshot.git.headShort ?? "no commits"
        }; ${snapshot.git.status.clean ? "clean" : `${snapshot.git.changedFiles.length} changed path(s)`}`;

  const lines = [
    `ContextRelay snapshot saved: ${snapshot.id}`,
    `  JSON:      ${result.relativeJsonPath}`,
    `  Markdown:  ${result.relativeMarkdownPath}`,
    `  Handoff:   .context-relay/HANDOFF.md`,
    `  Goal:      ${snapshot.context.goal ? truncateMiddle(snapshot.context.goal, 100) : "(not recorded)"}`,
    `  Git:       ${gitState}`,
    `  Evidence:  ${snapshot.evidence.files.length} file(s) hashed, ${snapshot.evidence.skipped.length} skipped`,
    `  Decisions: ${snapshot.context.decisions.length}`,
    `  Tasks:     ${snapshot.context.tasks.length}`,
    `  Conflicts: ${snapshot.conflicts.length}`,
    `  Functional status: NOT VERIFIED (hash evidence only)`,
  ];

  if (result.resolvedConflicts.length > 0) {
    lines.push(
      `  Resolved:  ${result.resolvedConflicts.length} explicitly confirmed conflict(s)`,
    );
  }

  if (snapshot.delta !== null) {
    lines.push(
      `  Delta:     +${snapshot.delta.evidenceAdded.length} files, ${snapshot.delta.evidenceChanged.length} hash changes, ${snapshot.delta.decisionsAdded.length} new decisions, ${snapshot.delta.decisionChanges.length} decision status changes, ${snapshot.delta.conflictsAdded.length} new conflicts`,
    );
  }

  if (result.warnings.length > 0) {
    lines.push("", "Warnings:");
    for (const warning of result.warnings) {
      lines.push(`  - ${warning}`);
    }
  }

  lines.push("", 'Resume with: context-relay resume');
  process.stdout.write(`${lines.join("\n")}\n`);
}
