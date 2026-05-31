// @effect-diagnostics nodeBuiltinImport:off
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import {
  ProjectId,
  ThreadId,
  type ManagerQueueItem,
  type ManagerSeededWorkItem,
} from "@t3tools/contracts";

import {
  buildPromptFromContext,
  createEmptyWorkspaceState,
  estimateTokens,
  parseWorkspaceState,
  readWorkspaceStateFromFile,
  reconstructRuntimeContext,
  serializeWorkspaceState,
  updateWorkspaceState,
  writeWorkspaceStateToFile,
  type ManagerRuntimeContext,
  type ManagerWorkspaceState,
} from "./ManagerRuntime.ts";

describe("ManagerWorkspaceState", () => {
  it("round-trips state through serialize and parse", () => {
    const now = "2026-01-01T00:00:00.000Z";
    const state = createEmptyWorkspaceState(now);

    const serialized = serializeWorkspaceState(state);
    const parsed = parseWorkspaceState(serialized);

    expect(parsed).toEqual(state);
  });

  it("creates empty state with expected defaults", () => {
    const now = "2026-01-01T00:00:00.000Z";
    const state = createEmptyWorkspaceState(now);

    expect(state.createdAt).toBe(now);
    expect(state.updatedAt).toBe(now);
    expect(state.lastProcessedEventSequence).toBe(0);
    expect(state.activeWorkItemSummaries).toEqual([]);
    expect(state.preferences).toEqual([]);
    expect(state.runtimeCycleCount).toBe(0);
  });

  it("updateWorkspaceState bumps updatedAt and increments cycle count", () => {
    const now = "2026-01-01T00:00:00.000Z";
    const later = "2026-01-02T00:00:00.000Z";
    const state = createEmptyWorkspaceState(now);

    const updated = updateWorkspaceState(state, {
      updatedAt: later,
      lastProcessedEventSequence: 5,
    });

    expect(updated.createdAt).toBe(now);
    expect(updated.updatedAt).toBe(later);
    expect(updated.lastProcessedEventSequence).toBe(5);
    expect(updated.runtimeCycleCount).toBe(1);
  });

  it("does not mutate input state on update", () => {
    const now = "2026-01-01T00:00:00.000Z";
    const state = createEmptyWorkspaceState(now);
    const original = { ...state };

    updateWorkspaceState(state, {
      updatedAt: "2026-01-02T00:00:00.000Z",
      lastProcessedEventSequence: 10,
    });

    expect(state).toEqual(original);
  });
});

describe("ManagerWorkspaceState file persistence", () => {
  const makeTempDir = () => fs.mkdtemp(path.join(os.tmpdir(), "manager-runtime-test-"));

  it("round-trips state through file write and read", async () => {
    const dir = await makeTempDir();
    const stateFile = path.join(dir, "manager-state.json");
    const now = "2026-01-01T00:00:00.000Z";

    const state = createEmptyWorkspaceState(now);
    const updated = updateWorkspaceState(state, {
      updatedAt: now,
      lastProcessedEventSequence: 7,
    });

    await writeWorkspaceStateToFile(stateFile, updated);
    const loaded = await readWorkspaceStateFromFile(stateFile, now);

    expect(loaded).toEqual(updated);

    await fs.rm(dir, { recursive: true });
  });

  it("returns empty default state when file does not exist", async () => {
    const dir = await makeTempDir();
    const stateFile = path.join(dir, "nonexistent.json");
    const now = "2026-01-01T00:00:00.000Z";

    const loaded = await readWorkspaceStateFromFile(stateFile, now);

    expect(loaded).toEqual(createEmptyWorkspaceState(now));

    await fs.rm(dir, { recursive: true });
  });

  it("returns empty default state when file contains invalid JSON", async () => {
    const dir = await makeTempDir();
    const stateFile = path.join(dir, "corrupt.json");
    const now = "2026-01-01T00:00:00.000Z";

    await fs.writeFile(stateFile, "not json at all {{{", "utf-8");
    const loaded = await readWorkspaceStateFromFile(stateFile, now);

    expect(loaded).toEqual(createEmptyWorkspaceState(now));

    await fs.rm(dir, { recursive: true });
  });
});

function makeMockQueueItem(overrides: Partial<ManagerQueueItem> = {}): ManagerQueueItem {
  return {
    itemId: "q-1",
    escalationThreadId: ThreadId.make("worker-thread-1"),
    category: "question",
    summary: "How should I handle this error?",
    detail: "Encountered a type error in file x.ts.",
    status: "pending",
    createdAt: "2026-06-01T00:00:00.000Z",
    addressedAt: null,
    dismissedAt: null,
    ...overrides,
  } as unknown as ManagerQueueItem;
}

function makeMockSeededWorkItem(
  overrides: Partial<ManagerSeededWorkItem> = {},
): ManagerSeededWorkItem {
  return {
    itemId: "sw-1",
    sourceKind: "todo-list",
    sourceLabel: "Sprint Backlog",
    title: "Add login page",
    body: "Implement login page with OAuth support.",
    delegationIntent: "delegate",
    targetProjectId: ProjectId.make("project-a"),
    acceptanceCriteria: ["User can log in", "Supports OAuth"],
    readiness: "ready-for-worker",
    readinessReason: "Has project and acceptance criteria.",
    delegationStatus: "idle",
    delegationRequestedAt: null,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  } as unknown as ManagerSeededWorkItem;
}

describe("Manager Runtime Context reconstruction", () => {
  it("builds runtime context from workspace state and queue items", () => {
    const now = "2026-06-01T00:00:00.000Z";
    const state = createEmptyWorkspaceState(now);

    const context = reconstructRuntimeContext({
      workspaceState: state,
      queueItems: [makeMockQueueItem()],
      seededWorkItems: [],
    });

    expect(context.pendingQueueItemCount).toBe(1);
    expect(context.pendingQueueItemSummaries).toHaveLength(1);
    expect(context.pendingQueueItemSummaries[0]).toContain("How should I handle this error?");
    expect(context.activeWorkItemCount).toBe(0);
    expect(context.preferences).toEqual([]);
    expect(context.cycleCount).toBe(0);
  });

  it("filters out non-pending queue items", () => {
    const now = "2026-06-01T00:00:00.000Z";
    const state = createEmptyWorkspaceState(now);

    const context = reconstructRuntimeContext({
      workspaceState: state,
      queueItems: [
        makeMockQueueItem({ itemId: "q-1", status: "pending" }),
        makeMockQueueItem({ itemId: "q-2", status: "addressed" }),
        makeMockQueueItem({ itemId: "q-3", status: "dismissed" }),
      ],
      seededWorkItems: [],
    });

    expect(context.pendingQueueItemCount).toBe(1);
  });

  it("includes seeded work item titles in context", () => {
    const now = "2026-06-01T00:00:00.000Z";
    const state = createEmptyWorkspaceState(now);

    const context = reconstructRuntimeContext({
      workspaceState: state,
      queueItems: [],
      seededWorkItems: [
        makeMockSeededWorkItem({ itemId: "sw-1", title: "Add login" }),
        makeMockSeededWorkItem({ itemId: "sw-2", title: "Fix auth bug" }),
      ],
    });

    expect(context.activeWorkItemCount).toBe(2);
    expect(context.activeWorkItemTitles).toEqual(["Add login", "Fix auth bug"]);
  });

  it("includes workspace preferences when present", () => {
    const now = "2026-06-01T00:00:00.000Z";
    const state: ManagerWorkspaceState = {
      ...createEmptyWorkspaceState(now),
      preferences: ["prefer functional style", "use Effect-TS"],
    };

    const context = reconstructRuntimeContext({
      workspaceState: state,
      queueItems: [],
      seededWorkItems: [],
    });

    expect(context.preferences).toEqual(["prefer functional style", "use Effect-TS"]);
  });

  it("empty inputs produce empty but well-formed context", () => {
    const now = "2026-06-01T00:00:00.000Z";
    const state = createEmptyWorkspaceState(now);

    const context = reconstructRuntimeContext({
      workspaceState: state,
      queueItems: [],
      seededWorkItems: [],
    });

    expect(context.pendingQueueItemCount).toBe(0);
    expect(context.activeWorkItemCount).toBe(0);
    expect(context.cycleCount).toBe(0);
    expect(context.summary).toBeTruthy();
  });
});

describe("Token estimation", () => {
  it("estimates tokens with ~4 chars per token approximation", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("hello")).toBeGreaterThanOrEqual(1);
    expect(estimateTokens("hello")).toBeLessThanOrEqual(3);

    const oneHundredChars = "a".repeat(100);
    expect(estimateTokens(oneHundredChars)).toBe(25);
  });

  it("estimateTokens returns zero for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });
});

describe("Prompt building and token efficiency", () => {
  it("builds a prompt from runtime context", () => {
    const now = "2026-06-01T00:00:00.000Z";
    const state: ManagerWorkspaceState = {
      ...createEmptyWorkspaceState(now),
      preferences: ["prefer functional style"],
    };

    const context = reconstructRuntimeContext({
      workspaceState: state,
      queueItems: [makeMockQueueItem({ summary: "How to handle errors?", category: "question" })],
      seededWorkItems: [makeMockSeededWorkItem({ title: "Add login page" })],
    });

    const prompt = buildPromptFromContext(context);

    expect(prompt).toContain("Manager Runtime Context");
    expect(prompt).toContain("How to handle errors?");
    expect(prompt).toContain("Add login page");
    expect(prompt).toContain("prefer functional style");
  });

  it("summary-based context uses far fewer tokens than detail-based full transcript", () => {
    const now = "2026-06-01T00:00:00.000Z";
    const state = createEmptyWorkspaceState(now);

    const queueItems = Array.from({ length: 50 }, (_, i) =>
      makeMockQueueItem({
        itemId: `q-${i}`,
        summary: `Task number ${i}: process item`,
        detail:
          `Detailed description for item ${i} that has a lot of text which would normally bloat a transcript.`.repeat(
            5,
          ),
      }),
    );

    const runtimeContext = reconstructRuntimeContext({
      workspaceState: state,
      queueItems,
      seededWorkItems: [],
    });

    const prompt = buildPromptFromContext(runtimeContext);
    const runtimeTokens = estimateTokens(prompt);

    // Full transcript approach: includes verbose detail fields
    const fullTranscriptDetailText = queueItems
      .map((q) => `${q.summary}\n${q.detail}`)
      .join("\n\n");
    const fullTranscriptTokens = estimateTokens(fullTranscriptDetailText);

    // Runtime context summaries should use significantly fewer tokens
    // than including all verbose details
    expect(runtimeTokens).toBeLessThan(fullTranscriptTokens);
    expect(runtimeTokens).toBeLessThanOrEqual(fullTranscriptTokens * 0.5);
  });

  it("demonstrates token efficiency vs full transcript approach", () => {
    const now = "2026-06-01T00:00:00.000Z";
    const state = createEmptyWorkspaceState(now);
    const queueItems = Array.from({ length: 50 }, (_, i) =>
      makeMockQueueItem({
        itemId: `q-${i}`,
        summary: `Item ${i} question`,
        detail:
          `This is a very long detailed message that would consume many tokens in a full transcript for item ${i}. It repeats many times to simulate real-world chat verbosity. `.repeat(
            20,
          ),
      }),
    );

    const runtimeContext = reconstructRuntimeContext({
      workspaceState: state,
      queueItems,
      seededWorkItems: [],
    });

    const prompt = buildPromptFromContext(runtimeContext);
    const runtimeTokens = estimateTokens(prompt);

    // Full transcript approach: reconstruct all detail fields verbatim
    const fullTranscriptText = queueItems
      .map((q) => `[${q.category}] ${q.summary}\nDetail: ${q.detail}`)
      .join("\n\n");
    const fullTranscriptTokens = estimateTokens(fullTranscriptText);

    // Runtime context should use significantly fewer tokens than full transcript
    // because it uses summaries, not verbose details
    const ratio = runtimeTokens / fullTranscriptTokens;
    expect(ratio).toBeLessThan(0.3);
  });
});
