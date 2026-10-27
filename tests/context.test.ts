import { describe, expect, it } from "vitest";
import { mergeContext } from "../src/core/context.js";
import type { SnapshotContext } from "../src/core/schema.js";

const FIRST_TIME = "2026-01-01T00:00:00.000Z";
const SECOND_TIME = "2026-01-02T00:00:00.000Z";

describe("incremental context memory", () => {
  it("preserves decisions and updates tasks without losing history", () => {
    const first: SnapshotContext = mergeContext(
      null,
      {
        goal: "Build a handoff engine",
        decisions: [
          "Use Git as the source of commit evidence",
          {
            summary: "Store snapshots locally",
            rationale: "Keep data private by default",
          },
        ],
        tasks: [
          { title: "Implement capture", status: "in_progress" },
        ],
        nextSteps: ["Implement resume"],
        notes: ["Session one"],
      },
      FIRST_TIME,
    ).context;

    const second = mergeContext(
      first,
      {
        decisions: [
          "Use Git as the source of commit evidence",
          "Use Zod for snapshot validation",
        ],
        tasks: [
          { title: "Implement capture", status: "done_claimed" },
          { title: "Implement resume" },
        ],
        notes: ["Session one", "Session two"],
      },
      SECOND_TIME,
    );

    expect(second.context.goal).toBe("Build a handoff engine");
    expect(second.context.decisions).toHaveLength(3);
    expect(
      second.context.decisions.map((decision) => decision.summary),
    ).toContain("Use Zod for snapshot validation");
    expect(second.context.tasks).toHaveLength(2);
    expect(second.context.tasks[0]?.status).toBe("done_claimed");
    expect(second.context.tasks[0]?.createdAt).toBe(FIRST_TIME);
    expect(second.context.tasks[0]?.updatedAt).toBe(SECOND_TIME);
    expect(second.context.tasks[1]?.status).toBe("todo");
    expect(second.context.nextSteps).toEqual(["Implement resume"]);
    expect(second.context.notes).toEqual(["Session one", "Session two"]);
    expect(second.conflicts).toEqual([]);

    expect(second.context.tasks[0]?.statusHistory).toEqual([
      { from: null, to: "in_progress", at: FIRST_TIME },
      { from: "in_progress", to: "done_claimed", at: SECOND_TIME },
    ]);
    expect(second.context.tasks[1]?.statusHistory).toEqual([
      { from: null, to: "todo", at: SECOND_TIME },
    ]);
  });

  it("replaces next steps only when explicitly supplied", () => {
    const first = mergeContext(
      null,
      {
        goal: "Goal",
        nextSteps: ["Old step"],
      },
      FIRST_TIME,
    );

    const carried = mergeContext(first.context, {}, SECOND_TIME);
    expect(carried.context.nextSteps).toEqual(["Old step"]);

    const cleared = mergeContext(
      first.context,
      { nextSteps: [] },
      SECOND_TIME,
    );
    expect(cleared.context.nextSteps).toEqual([]);
  });

  it("records a completed task being reopened as a conflict", () => {
    const first = mergeContext(
      null,
      {
        tasks: [{ title: "Implement parser", status: "done_claimed" }],
      },
      FIRST_TIME,
    );

    const second = mergeContext(
      first.context,
      {
        tasks: [{ title: "Implement parser", status: "in_progress" }],
      },
      SECOND_TIME,
    );

    const task = second.context.tasks[0];
    expect(task?.status).toBe("in_progress");
    expect(task?.statusHistory).toEqual([
      { from: null, to: "done_claimed", at: FIRST_TIME },
      { from: "done_claimed", to: "in_progress", at: SECOND_TIME },
    ]);
    expect(second.conflicts).toHaveLength(1);
    expect(second.conflicts[0]).toMatchObject({
      kind: "task_reopened",
      subjectId: task?.id,
      previous: "done_claimed",
      incoming: "in_progress",
      detectedAt: SECOND_TIME,
      severity: "warning",
    });
  });

  it("flags a blocked task claimed as done without unblock evidence", () => {
    const first = mergeContext(
      null,
      {
        tasks: [{ title: "Publish package", status: "blocked" }],
      },
      FIRST_TIME,
    );

    const second = mergeContext(
      first.context,
      {
        tasks: [{ title: "Publish package", status: "done_claimed" }],
      },
      SECOND_TIME,
    );

    expect(second.context.tasks[0]?.status).toBe("done_claimed");
    expect(second.conflicts).toHaveLength(1);
    expect(second.conflicts[0]).toMatchObject({
      kind: "task_completed_from_blocked",
      previous: "blocked",
      incoming: "done_claimed",
    });
  });

  it("supersedes a decision only when the previous id is explicit", () => {
    const first = mergeContext(
      null,
      {
        decisions: [
          {
            summary: "Store snapshots as JSON",
            rationale: "Easy to inspect",
          },
        ],
      },
      FIRST_TIME,
    );
    const previous = first.context.decisions[0];
    expect(previous).toBeDefined();
    expect(previous?.status).toBe("active");
    expect(previous?.revision).toBe(1);

    const second = mergeContext(
      first.context,
      {
        decisions: [
          {
            summary: "Store snapshots as JSON plus Markdown",
            rationale: "Agents need a readable handoff",
            supersedes: previous?.id,
          },
        ],
      },
      SECOND_TIME,
    );

    expect(second.conflicts).toEqual([]);
    expect(second.context.decisions).toHaveLength(2);

    const superseded = second.context.decisions.find(
      (decision) => decision.id === previous?.id,
    );
    expect(superseded).toMatchObject({
      status: "superseded",
      supersededBy: second.context.decisions[1]?.id,
      updatedAt: SECOND_TIME,
    });

    const revision = second.context.decisions[1];
    expect(revision).toMatchObject({
      status: "active",
      revision: 2,
      supersedes: previous?.id,
      supersededBy: null,
      createdAt: SECOND_TIME,
    });
    expect(second.context.decisions.filter(
      (decision) => decision.status === "active",
    )).toHaveLength(1);
  });

  it("reports a decision conflict when the rationale changes without supersedes", () => {
    const makeFirst = () =>
      mergeContext(
        null,
        {
          decisions: [
            {
              summary: "Use SQLite for storage",
              rationale: "Support complex queries",
            },
          ],
        },
        FIRST_TIME,
      );

    const first = makeFirst();
    const previous = first.context.decisions[0];
    const second = mergeContext(
      first.context,
      {
        decisions: [
          {
            summary: "Use SQLite for storage",
            rationale: "Avoid running a separate database server",
          },
        ],
      },
      SECOND_TIME,
    );

    expect(second.context.decisions).toHaveLength(1);
    expect(second.context.decisions[0]).toEqual(previous);
    expect(second.conflicts).toHaveLength(1);
    expect(second.conflicts[0]).toMatchObject({
      kind: "decision_conflict",
      subjectId: previous?.id,
      previous: "Support complex queries",
      incoming: "Avoid running a separate database server",
    });
  });

  it("keeps the existing decision when the same summary and rationale repeat", () => {
    const first = mergeContext(
      null,
      {
        decisions: [
          { summary: "Keep data local", rationale: "Privacy" },
        ],
      },
      FIRST_TIME,
    );

    const second = mergeContext(
      first.context,
      {
        decisions: [
          { summary: "Keep data local", rationale: "Privacy" },
        ],
      },
      SECOND_TIME,
    );

    expect(second.context.decisions).toHaveLength(1);
    expect(second.context.decisions[0]?.updatedAt).toBe(FIRST_TIME);
    expect(second.conflicts).toEqual([]);
  });

  it("rejects superseding an unknown or already superseded decision", () => {
    expect(() =>
      mergeContext(
        null,
        {
          decisions: [
            {
              summary: "New direction",
              supersedes: "dec_missing",
            },
          ],
        },
        FIRST_TIME,
      ),
    ).toThrow(/unknown decision id/i);

    const first = mergeContext(
      null,
      {
        decisions: [
          {
            summary: "Use REST",
            rationale: "Simple",
          },
        ],
      },
      FIRST_TIME,
    );

    const second = mergeContext(
      first.context,
      {
        decisions: [
          {
            summary: "Use GraphQL",
            supersedes: first.context.decisions[0]?.id,
          },
        ],
      },
      SECOND_TIME,
    );

    expect(() =>
      mergeContext(
        second.context,
        {
          decisions: [
            {
              summary: "Use tRPC",
              supersedes: first.context.decisions[0]?.id,
            },
          ],
        },
        SECOND_TIME,
      ),
    ).toThrow(/already superseded/i);
  });
});
