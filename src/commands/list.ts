import { listSnapshots } from "../core/store.js";
import { writeJson } from "./io.js";

export interface ListCliInput {
  cwd: string;
  json: boolean;
}

export async function runListCommand(input: ListCliInput): Promise<void> {
  const snapshots = await listSnapshots(input.cwd);

  if (input.json) {
    writeJson({ ok: true, snapshots });
    return;
  }

  if (snapshots.length === 0) {
    process.stdout.write(
      "No ContextRelay snapshots found. Run \"context-relay capture\" first.\n",
    );
    return;
  }

  const lines = [`ContextRelay snapshots (${snapshots.length}, newest first):`];
  for (const snapshot of snapshots) {
    const git =
      snapshot.gitBranch === null && snapshot.gitHead === null
        ? "no git"
        : `${snapshot.gitBranch ?? "detached"} @ ${
            snapshot.gitHead?.slice(0, 7) ?? "no commits"
          }`;
    lines.push(
      `  ${snapshot.id}  ${snapshot.createdAt}  ${git}  evidence=${snapshot.evidenceCount}  goal=${
        snapshot.goal ?? "(not recorded)"
      }`,
    );
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}
