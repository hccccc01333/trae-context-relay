#!/usr/bin/env node

import { Command } from "commander";
import { TOOL_VERSION } from "./core/constants.js";
import { runCaptureCommand } from "./commands/capture.js";
import { runListCommand } from "./commands/list.js";
import { runResumeCommand } from "./commands/resume.js";

function collect(value: string, previous: string[] | undefined): string[] {
  return [...(previous ?? []), value];
}

const program = new Command();

program
  .name("context-relay")
  .description(
    "Local, Git-backed context handoff and recovery for AI coding agents.",
  )
  .version(TOOL_VERSION)
  .showHelpAfterError();

program
  .command("capture")
  .description(
    "Capture Git state, file hashes, project structure, and explicit session context.",
  )
  .option("--goal <text>", "project goal carried across sessions")
  .option("--decision <text>", "record a technical decision (repeatable)", collect, [])
  .option("--task <title>", "record a task (repeatable; status updates require --input)", collect, [])
  .option("--next <step>", "record a next step (repeatable)", collect, [])
  .option("--note <text>", "record a note (repeatable)", collect, [])
  .option("--file <path>", "add a project-relative evidence file (repeatable)", collect, [])
  .option("--input <file>", "read structured context from a JSON file")
  .option("--json", "print machine-readable JSON", false)
  .action(
    async (options: {
      goal?: string;
      decision: string[];
      task: string[];
      next: string[];
      note: string[];
      file: string[];
      input?: string;
      json: boolean;
    }) => {
      await runCaptureCommand({
        cwd: process.cwd(),
        goal: options.goal,
        decisions: options.decision,
        tasks: options.task,
        nextSteps: options.next,
        notes: options.note,
        files: options.file,
        inputFile: options.input,
        json: options.json,
      });
    },
  );

program
  .command("resume")
  .description(
    "Verify the latest snapshot against the current project and print a recovery prompt.",
  )
  .option("--snapshot <id>", "use a specific snapshot id instead of the latest")
  .option("--json", "print machine-readable JSON", false)
  .action(async (options: { snapshot?: string; json: boolean }) => {
    await runResumeCommand({
      cwd: process.cwd(),
      snapshotId: options.snapshot,
      json: options.json,
    });
  });

program
  .command("list")
  .description("List stored snapshots, newest first.")
  .option("--json", "print machine-readable JSON", false)
  .action(async (options: { json: boolean }) => {
    await runListCommand({
      cwd: process.cwd(),
      json: options.json,
    });
  });

async function main(): Promise<void> {
  await program.parseAsync(process.argv);
}

main().catch((error: unknown) => {
  const debug = process.env.CONTEXT_RELAY_DEBUG === "1";
  if (debug && error instanceof Error && error.stack) {
    process.stderr.write(`${error.stack}\n`);
  } else {
    process.stderr.write(
      `context-relay: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
  process.exitCode = 1;
});
