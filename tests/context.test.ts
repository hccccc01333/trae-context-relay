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
    );

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

    expect(second.goal).toBe("Build a handoff engine");
    expect(second.decisions).toHaveLength(3);
    expect(second.decisions.map((decision) => decision.summary)).toContain(
      "Use Zod for snapshot validation",
    );
    expect(second.tasks).toHaveLength(2);
    expect(second.tasks[0]?.status).toBe("done_claimed");
    expect(second.tasks[0]?.createdAt).toBe(FIRST_TIME);
    expect(second.tasks[0]?.updatedAt).toBe(SECOND_TIME);
    expect(second.tasks[1]?.status).toBe("todo");
    expect(second.nextSteps).toEqual(["Implement resume"]);
    expect(second.notes).toEqual(["Session one", "Session two"]);
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

    const carried = mergeContext(first, {}, SECOND_TIME);
    expect(carried.nextSteps).toEqual(["Old step"]);

    const cleared = mergeContext(first, { nextSteps: [] }, SECOND_TIME);
    expect(cleared.nextSteps).toEqual([]);
  });
});
