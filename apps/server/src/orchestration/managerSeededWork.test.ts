import { ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  applyRefinementHandoffToSeededWorkItem,
  materializeSeededWorkItems,
} from "./managerSeededWork.ts";

describe("manager seeded work classification", () => {
  it("classifies seeded work items by delegation readiness", () => {
    const seededWorkItems = materializeSeededWorkItems({
      sourceKind: "todo-list",
      sourceLabel: "Sprint Backlog",
      createdAt: "2026-01-01T00:00:00.000Z",
      items: [
        {
          itemId: "work-ready",
          title: "Ready item",
          body: "Has a project and acceptance criteria.",
          delegationIntent: "delegate",
          targetProjectId: ProjectId.make("project-a"),
          acceptanceCriteria: ["Done"],
        },
        {
          itemId: "work-refine",
          title: "Needs refinement",
          body: "No acceptance criteria yet.",
          delegationIntent: "delegate",
          targetProjectId: ProjectId.make("project-a"),
          acceptanceCriteria: [],
        },
        {
          itemId: "work-human",
          title: "Human owned",
          body: "Keep this with the human.",
          delegationIntent: "human-owned",
          targetProjectId: ProjectId.make("project-a"),
          acceptanceCriteria: ["Handled"],
        },
        {
          itemId: "work-blocked",
          title: "Blocked on context",
          body: "Needs a project selection first.",
          delegationIntent: "delegate",
          targetProjectId: null,
          acceptanceCriteria: ["Investigated"],
        },
      ],
    });

    expect(seededWorkItems.map((item) => item.readiness)).toEqual([
      "ready-for-worker",
      "needs-refinement",
      "human-owned",
      "blocked-on-context",
    ]);
    expect(seededWorkItems.map((item) => item.delegationStatus)).toEqual([
      "idle",
      "idle",
      "idle",
      "idle",
    ]);
  });

  it("applies a refinement handoff and marks ready work for delegation", () => {
    const [seededWorkItem] = materializeSeededWorkItems({
      sourceKind: "todo-list",
      sourceLabel: "Sprint Backlog",
      createdAt: "2026-01-01T00:00:00.000Z",
      items: [
        {
          itemId: "work-refine",
          title: "Needs refinement",
          body: "No acceptance criteria yet.",
          delegationIntent: "delegate",
          targetProjectId: ProjectId.make("project-a"),
          acceptanceCriteria: [],
        },
      ],
    });

    const next = applyRefinementHandoffToSeededWorkItem({
      seededWorkItem: seededWorkItem!,
      refinementHandoff: {
        refinerThreadId: ThreadId.make("refiner-thread-1"),
        sourceBody: "No acceptance criteria yet.",
        refinedProblemStatement: "Support CSV export from billing history.",
        acceptanceCriteria: ["Export action is visible", "CSV download includes invoice rows"],
        targetProjectId: ProjectId.make("project-b"),
        recordedAt: "2026-01-01T00:00:05.000Z",
      },
    });

    expect(next.body).toBe("Support CSV export from billing history.");
    expect(next.targetProjectId).toBe("project-b");
    expect(next.readiness).toBe("ready-for-worker");
    expect(next.delegationStatus).toBe("requested");
    expect(next.delegationRequestedAt).toBe("2026-01-01T00:00:05.000Z");
    expect(next.refinementHandoff).toEqual({
      refinerThreadId: "refiner-thread-1",
      sourceBody: "No acceptance criteria yet.",
      refinedProblemStatement: "Support CSV export from billing history.",
      acceptanceCriteria: ["Export action is visible", "CSV download includes invoice rows"],
      targetProjectId: "project-b",
      recordedAt: "2026-01-01T00:00:05.000Z",
    });
  });
});
