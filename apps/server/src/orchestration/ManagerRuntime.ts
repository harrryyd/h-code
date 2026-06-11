// @effect-diagnostics nodeBuiltinImport:off
import * as fs from "node:fs/promises";

import type { ManagerQueueItem, ManagerSeededWorkItem } from "@t3tools/contracts";

export interface ManagerWorkItemSummary {
  readonly itemId: string;
  readonly title: string;
  readonly readiness: string;
  readonly delegationStatus: string;
  readonly hasRefinementHandoff: boolean;
}

export interface ManagerWorkspaceState {
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastProcessedEventSequence: number;
  readonly activeWorkItemSummaries: ReadonlyArray<ManagerWorkItemSummary>;
  readonly preferences: ReadonlyArray<string>;
  readonly runtimeCycleCount: number;
}

export interface ManagerRuntimeContext {
  readonly summary: string;
  readonly pendingQueueItemCount: number;
  readonly pendingQueueItemSummaries: ReadonlyArray<string>;
  readonly activeWorkItemCount: number;
  readonly activeWorkItemTitles: ReadonlyArray<string>;
  readonly preferences: ReadonlyArray<string>;
  readonly cycleCount: number;
}

export function createEmptyWorkspaceState(now: string): ManagerWorkspaceState {
  return {
    createdAt: now,
    updatedAt: now,
    lastProcessedEventSequence: 0,
    activeWorkItemSummaries: [],
    preferences: [],
    runtimeCycleCount: 0,
  };
}

export interface WorkspaceStatePatch {
  readonly updatedAt: string;
  readonly lastProcessedEventSequence?: number;
}

export function updateWorkspaceState(
  state: ManagerWorkspaceState,
  patch: WorkspaceStatePatch,
): ManagerWorkspaceState {
  return {
    ...state,
    updatedAt: patch.updatedAt,
    lastProcessedEventSequence:
      patch.lastProcessedEventSequence ?? state.lastProcessedEventSequence,
    runtimeCycleCount: state.runtimeCycleCount + 1,
  };
}

export function serializeWorkspaceState(state: ManagerWorkspaceState): string {
  return JSON.stringify(state, null, 2);
}

export function parseWorkspaceState(json: string): ManagerWorkspaceState {
  const parsed = JSON.parse(json);
  return {
    createdAt: String(parsed.createdAt ?? ""),
    updatedAt: String(parsed.updatedAt ?? ""),
    lastProcessedEventSequence: Number(parsed.lastProcessedEventSequence ?? 0),
    activeWorkItemSummaries: Array.isArray(parsed.activeWorkItemSummaries)
      ? parsed.activeWorkItemSummaries
      : [],
    preferences: Array.isArray(parsed.preferences) ? parsed.preferences : [],
    runtimeCycleCount: Number(parsed.runtimeCycleCount ?? 0),
  };
}

export async function writeWorkspaceStateToFile(
  filePath: string,
  state: ManagerWorkspaceState,
): Promise<void> {
  const serialized = serializeWorkspaceState(state);
  // @effect-diagnostics-next-line cryptoRandomUUID:off
  const tmpPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmpPath, serialized, "utf-8");
  await fs.rename(tmpPath, filePath);
}

export async function readWorkspaceStateFromFile(
  filePath: string,
  now: string,
): Promise<ManagerWorkspaceState> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return parseWorkspaceState(raw);
  } catch (error) {
    process.stderr.write(
      `[ManagerRuntime] Failed to read workspace state from '${filePath}', falling back to empty state: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
    return createEmptyWorkspaceState(now);
  }
}

export function reconstructRuntimeContext(input: {
  readonly workspaceState: ManagerWorkspaceState;
  readonly queueItems: ReadonlyArray<ManagerQueueItem>;
  readonly seededWorkItems: ReadonlyArray<ManagerSeededWorkItem>;
}): ManagerRuntimeContext {
  const pendingQueueItems = input.queueItems.filter((q) => q.status === "pending");
  const queueSummaries = pendingQueueItems.map((q) => `[${q.category}] ${q.summary}`);

  const workItemTitles = input.seededWorkItems.map((w) => w.title);

  const summaryParts: string[] = [];

  if (pendingQueueItems.length > 0) {
    summaryParts.push(`${pendingQueueItems.length} pending queue item(s) need attention`);
  }
  if (input.seededWorkItems.length > 0) {
    summaryParts.push(`${input.seededWorkItems.length} active seeded work item(s)`);
  }

  const summary =
    summaryParts.length > 0
      ? `Manager runtime context: ${summaryParts.join("; ")}.`
      : "Manager runtime context: no pending items to coordinate.";

  return {
    summary,
    pendingQueueItemCount: pendingQueueItems.length,
    pendingQueueItemSummaries: queueSummaries,
    activeWorkItemCount: input.seededWorkItems.length,
    activeWorkItemTitles: workItemTitles,
    preferences: input.workspaceState.preferences,
    cycleCount: input.workspaceState.runtimeCycleCount,
  };
}

export function buildPromptFromContext(context: ManagerRuntimeContext): string {
  const lines: string[] = ["## Manager Runtime Context", "", context.summary, ""];

  if (context.preferences.length > 0) {
    lines.push("### Learned Preferences");
    for (const pref of context.preferences) {
      lines.push(`- ${pref}`);
    }
    lines.push("");
  }

  if (context.pendingQueueItemSummaries.length > 0) {
    lines.push("### Pending Queue Items");
    for (const qs of context.pendingQueueItemSummaries) {
      lines.push(`- ${qs}`);
    }
    lines.push("");
  }

  if (context.activeWorkItemTitles.length > 0) {
    lines.push("### Active Work Items");
    for (const title of context.activeWorkItemTitles) {
      lines.push(`- ${title}`);
    }
    lines.push("");
  }

  lines.push(`Runtime cycle: ${context.cycleCount}`);

  return lines.join("\n");
}

const TOKEN_CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / TOKEN_CHARS_PER_TOKEN);
}
