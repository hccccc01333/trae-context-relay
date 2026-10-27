# ContextRelay Handoff

## Goal

Implement the `context-relay diff` command on top of v0.3 snapshots.

## Decisions

- Snapshots are immutable; every capture writes a new JSON/Markdown pair.
  - Rationale: keep historical decisions and evidence auditable.
- Diff reuses the existing `SnapshotDelta`; no new schema or database.
  - Rationale: one delta model keeps stored and computed diffs consistent.
- Diff defaults to JSON for scriptability; `--human` prints the summary.
  - Rationale: scripts are the primary consumer.

## Tasks

- Done (claimed): Implement conflict tracking and task history.
  - Conflict detection, task `statusHistory`, and decision revisions are implemented.
- Done (claimed): Add v1 to v2 snapshot migration.
  - Old snapshots load through an in-memory migration.
- Todo: Implement the diff command.
  - Not started.

## Next steps

- Implement the diff command.
- Run `npm run check` before claiming completion.

## Notes

- v0.3 core is complete at the benchmark baseline.
- Do not modify existing snapshot files.

## Repository state at handoff

- Branch: `main`
- Baseline: `benchmark-v0.3-base`
- Working tree: clean
