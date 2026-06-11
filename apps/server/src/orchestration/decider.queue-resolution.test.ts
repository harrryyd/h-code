import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  ProjectId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  ProviderInstanceId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vite-plus/test";

import { NodeCrypto } from "@effect/platform-node";

import { decideOrchestrationCommand as decideOrchestrationCommandRaw } from "./decider.ts";

const decideOrchestrationCommand = (
  input: Parameters<typeof decideOrchestrationCommandRaw>[0],
) => decideOrchestrationCommandRaw(input).pipe(Effect.provide(NodeCrypto.layer));
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const asCommandId = (value: string): CommandId => CommandId.make(value);
const asEventId = (value: string): EventId => EventId.make(value);
const asProjectId = (value: string): ProjectId => ProjectId.make(value);
const asThreadId = (value: string): ThreadId => ThreadId.make(value);

type PlannedEvent = Omit<OrchestrationEvent, "sequence">;

async function seedResolutionReadModel(): Promise<OrchestrationReadModel> {
  const now = "2026-01-01T00:00:00.000Z";
  let model = createEmptyReadModel(now);

  // Manager Workspace + Console
  model = await Effect.runPromise(
    projectEvent(model, {
      sequence: 1,
      eventId: asEventId("evt-project-manager"),
      aggregateKind: "project",
      aggregateId: asProjectId("manager-workspace"),
      type: "project.created",
      occurredAt: now,
      commandId: asCommandId("cmd-manager-bootstrap"),
      causationEventId: null,
      correlationId: asCommandId("cmd-manager-bootstrap"),
      metadata: {},
      payload: {
        projectId: asProjectId("manager-workspace"),
        title: "Manager Workspace",
        workspaceRoot: "/tmp/manager",
        managerMetadata: { role: "workspace" },
        defaultModelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
        },
        scripts: [],
        createdAt: now,
        updatedAt: now,
      },
    }),
  );

  model = await Effect.runPromise(
    projectEvent(model, {
      sequence: 2,
      eventId: asEventId("evt-thread-manager-console"),
      aggregateKind: "thread",
      aggregateId: asThreadId("manager-console"),
      type: "thread.created",
      occurredAt: now,
      commandId: asCommandId("cmd-manager-bootstrap"),
      causationEventId: null,
      correlationId: asCommandId("cmd-manager-bootstrap"),
      metadata: {},
      payload: {
        threadId: asThreadId("manager-console"),
        projectId: asProjectId("manager-workspace"),
        title: "Manager Console",
        managerMetadata: { role: "console" },
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
        },
        runtimeMode: "full-access",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        branch: null,
        worktreePath: "/tmp/manager",
        createdAt: now,
        updatedAt: now,
      },
    }),
  );

  // App project
  model = await Effect.runPromise(
    projectEvent(model, {
      sequence: 3,
      eventId: asEventId("evt-project-app"),
      aggregateKind: "project",
      aggregateId: asProjectId("app-project"),
      type: "project.created",
      occurredAt: now,
      commandId: asCommandId("cmd-project-create"),
      causationEventId: null,
      correlationId: asCommandId("cmd-project-create"),
      metadata: {},
      payload: {
        projectId: asProjectId("app-project"),
        title: "App Project",
        workspaceRoot: "/tmp/app",
        defaultModelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
        },
        scripts: [],
        createdAt: now,
        updatedAt: now,
      },
    }),
  );

  // Worker thread delegated from manager
  model = await Effect.runPromise(
    projectEvent(model, {
      sequence: 4,
      eventId: asEventId("evt-thread-worker"),
      aggregateKind: "thread",
      aggregateId: asThreadId("worker-thread-1"),
      type: "thread.created",
      occurredAt: now,
      commandId: asCommandId("cmd-worker-delegate"),
      causationEventId: null,
      correlationId: asCommandId("cmd-worker-delegate"),
      metadata: {},
      payload: {
        threadId: asThreadId("worker-thread-1"),
        projectId: asProjectId("app-project"),
        title: "Billing CSV export",
        managerMetadata: {
          role: "worker",
          managerThreadId: asThreadId("manager-console"),
          seededWorkItemId: "work-refine",
          sourceBody: "The original Jira description for billing CSV export.",
          refinedBrief: "Users can export billing data as CSV from the invoices screen.",
          acceptanceCriteria: ["Export button visible", "CSV includes invoice data"],
        },
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
        },
        runtimeMode: "full-access",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        branch: null,
        worktreePath: null,
        createdAt: now,
        updatedAt: now,
      },
    }),
  );

  // Escalation on manager console
  model = await Effect.runPromise(
    projectEvent(model, {
      sequence: 5,
      eventId: asEventId("evt-escalation-001"),
      aggregateKind: "thread",
      aggregateId: asThreadId("manager-console"),
      type: "thread.manager-queue-items-upserted",
      occurredAt: "2026-01-01T00:00:05.000Z",
      commandId: asCommandId("cmd-escalate-001"),
      causationEventId: null,
      correlationId: asCommandId("cmd-escalate-001"),
      metadata: {},
      payload: {
        threadId: asThreadId("manager-console"),
        managerQueueItems: [
          {
            itemId: "escalation-001",
            escalationThreadId: asThreadId("worker-thread-1"),
            category: "blocker",
            summary: "Need approval for file deletion",
            detail: "The worker wants to delete src/legacy/ but it may be used by other teams.",
            status: "pending",
            createdAt: "2026-01-01T00:00:05.000Z",
            addressedAt: null,
            dismissedAt: null,
          },
        ],
        updatedAt: "2026-01-01T00:00:05.000Z",
      },
    }),
  );

  return model;
}

function normalizeEvents(events: PlannedEvent | ReadonlyArray<PlannedEvent>): PlannedEvent[] {
  const list = Array.isArray(events) ? events : [events];
  return list.map((entry) => {
    if (entry.type === "thread.manager-queue-items-upserted") {
      return {
        type: entry.type,
        aggregateKind: entry.aggregateKind,
        aggregateId: entry.aggregateId,
        payload: entry.payload,
      };
    }
    if (entry.type === "thread.activity-appended") {
      return {
        type: entry.type,
        aggregateKind: entry.aggregateKind,
        aggregateId: entry.aggregateId,
        payload: entry.payload,
      };
    }
    return entry;
  });
}

describe("manager.resolve-queue-item", () => {
  it("resolves pending queue item and writes instruction to worker thread", async () => {
    const readModel = await seedResolutionReadModel();
    const createdAt = "2026-01-01T00:00:10.000Z";

    const command: OrchestrationCommand = {
      type: "manager.resolve-queue-item",
      commandId: asCommandId("cmd-resolve-1"),
      threadId: asThreadId("manager-console"),
      itemId: "escalation-001",
      instruction: "Go ahead and delete the legacy directory.",
      createdAt,
    };

    const result = await Effect.runPromise(decideOrchestrationCommand({ command, readModel }));

    const events = normalizeEvents(result);

    expect(events).toEqual([
      expect.objectContaining({
        type: "thread.manager-queue-items-upserted",
        aggregateKind: "thread",
        aggregateId: asThreadId("manager-console"),
        payload: expect.objectContaining({
          threadId: asThreadId("manager-console"),
          managerQueueItems: [
            expect.objectContaining({
              itemId: "escalation-001",
              escalationThreadId: asThreadId("worker-thread-1"),
              category: "blocker",
              summary: "Need approval for file deletion",
              detail: "The worker wants to delete src/legacy/ but it may be used by other teams.",
              status: "addressed",
              createdAt: "2026-01-01T00:00:05.000Z",
              addressedAt: createdAt,
              dismissedAt: null,
            }),
          ],
          updatedAt: createdAt,
        }),
      }),
      expect.objectContaining({
        type: "thread.activity-appended",
        aggregateKind: "thread",
        aggregateId: asThreadId("worker-thread-1"),
        payload: expect.objectContaining({
          threadId: asThreadId("worker-thread-1"),
          activity: expect.objectContaining({
            tone: "info",
            kind: "manager.queue-item.resolved",
            summary: "Go ahead and delete the legacy directory.",
            payload: expect.objectContaining({
              queueItemId: "escalation-001",
              category: "blocker",
            }),
            turnId: null,
            createdAt,
          }),
        }),
      }),
    ]);
  });

  it("preserves other queue items in FIFO order when one is resolved", async () => {
    let readModel = await seedResolutionReadModel();

    // Add a second queue item
    readModel = await Effect.runPromise(
      projectEvent(readModel, {
        sequence: 6,
        eventId: asEventId("evt-escalation-002"),
        aggregateKind: "thread",
        aggregateId: asThreadId("manager-console"),
        type: "thread.manager-queue-items-upserted",
        occurredAt: "2026-01-01T00:00:07.000Z",
        commandId: asCommandId("cmd-escalate-002"),
        causationEventId: null,
        correlationId: asCommandId("cmd-escalate-002"),
        metadata: {},
        payload: {
          threadId: asThreadId("manager-console"),
          managerQueueItems: [
            {
              itemId: "escalation-001",
              escalationThreadId: asThreadId("worker-thread-1"),
              category: "blocker",
              summary: "Need approval for file deletion",
              detail: "The worker wants to delete src/legacy/ but it may be used by other teams.",
              status: "pending",
              createdAt: "2026-01-01T00:00:05.000Z",
              addressedAt: null,
              dismissedAt: null,
            },
            {
              itemId: "escalation-002",
              escalationThreadId: asThreadId("worker-thread-1"),
              category: "question",
              summary: "Which logging library?",
              detail: "Should we use pino or winston?",
              status: "pending",
              createdAt: "2026-01-01T00:00:07.000Z",
              addressedAt: null,
              dismissedAt: null,
            },
          ],
          updatedAt: "2026-01-01T00:00:07.000Z",
        },
      }),
    );

    const createdAt = "2026-01-01T00:00:10.000Z";

    // Resolve the first item
    const command: OrchestrationCommand = {
      type: "manager.resolve-queue-item",
      commandId: asCommandId("cmd-resolve-1"),
      threadId: asThreadId("manager-console"),
      itemId: "escalation-001",
      instruction: "Use pino, it's faster.",
      createdAt,
    };

    const result = await Effect.runPromise(decideOrchestrationCommand({ command, readModel }));

    const events = normalizeEvents(result);

    expect(events).toEqual([
      expect.objectContaining({
        type: "thread.manager-queue-items-upserted",
        aggregateKind: "thread",
        aggregateId: asThreadId("manager-console"),
        payload: expect.objectContaining({
          threadId: asThreadId("manager-console"),
          managerQueueItems: [
            expect.objectContaining({
              itemId: "escalation-001",
              status: "addressed",
              addressedAt: createdAt,
            }),
            expect.objectContaining({
              itemId: "escalation-002",
              status: "pending",
            }),
          ],
          updatedAt: createdAt,
        }),
      }),
      expect.objectContaining({
        type: "thread.activity-appended",
        aggregateKind: "thread",
        aggregateId: asThreadId("worker-thread-1"),
      }),
    ]);
  });

  it("rejects when thread is not the Manager Console", async () => {
    const readModel = await seedResolutionReadModel();
    const createdAt = "2026-01-01T00:00:10.000Z";

    const command: OrchestrationCommand = {
      type: "manager.resolve-queue-item",
      commandId: asCommandId("cmd-resolve-bad"),
      threadId: asThreadId("worker-thread-1"),
      itemId: "escalation-001",
      instruction: "This should fail.",
      createdAt,
    };

    await expect(
      Effect.runPromise(decideOrchestrationCommand({ command, readModel })),
    ).rejects.toEqual(
      expect.objectContaining({
        detail: expect.stringContaining("is not the Manager Console"),
      }),
    );
  });

  it("rejects when queue item is not found", async () => {
    const readModel = await seedResolutionReadModel();
    const createdAt = "2026-01-01T00:00:10.000Z";

    const command: OrchestrationCommand = {
      type: "manager.resolve-queue-item",
      commandId: asCommandId("cmd-resolve-missing"),
      threadId: asThreadId("manager-console"),
      itemId: "nonexistent-item",
      instruction: "This should fail.",
      createdAt,
    };

    await expect(
      Effect.runPromise(decideOrchestrationCommand({ command, readModel })),
    ).rejects.toEqual(
      expect.objectContaining({
        detail: expect.stringContaining("not found on Manager Console"),
      }),
    );
  });

  it("rejects when queue item is already addressed", async () => {
    let readModel = await seedResolutionReadModel();

    // Mark item as already addressed
    readModel = await Effect.runPromise(
      projectEvent(readModel, {
        sequence: 6,
        eventId: asEventId("evt-resolved-already"),
        aggregateKind: "thread",
        aggregateId: asThreadId("manager-console"),
        type: "thread.manager-queue-items-upserted",
        occurredAt: "2026-01-01T00:00:07.000Z",
        commandId: asCommandId("cmd-resolve-prev"),
        causationEventId: null,
        correlationId: asCommandId("cmd-resolve-prev"),
        metadata: {},
        payload: {
          threadId: asThreadId("manager-console"),
          managerQueueItems: [
            {
              itemId: "escalation-001",
              escalationThreadId: asThreadId("worker-thread-1"),
              category: "blocker",
              summary: "Need approval for file deletion",
              detail: "The worker wants to delete src/legacy/ but it may be used by other teams.",
              status: "addressed",
              createdAt: "2026-01-01T00:00:05.000Z",
              addressedAt: "2026-01-01T00:00:07.000Z",
              dismissedAt: null,
            },
          ],
          updatedAt: "2026-01-01T00:00:07.000Z",
        },
      }),
    );

    const createdAt = "2026-01-01T00:00:10.000Z";

    const command: OrchestrationCommand = {
      type: "manager.resolve-queue-item",
      commandId: asCommandId("cmd-resolve-dup"),
      threadId: asThreadId("manager-console"),
      itemId: "escalation-001",
      instruction: "This should fail.",
      createdAt,
    };

    await expect(
      Effect.runPromise(decideOrchestrationCommand({ command, readModel })),
    ).rejects.toEqual(
      expect.objectContaining({
        detail: expect.stringContaining("cannot be resolved because it is already"),
      }),
    );
  });

  it("rejects when queue item is already dismissed", async () => {
    let readModel = await seedResolutionReadModel();

    // Mark item as dismissed
    readModel = await Effect.runPromise(
      projectEvent(readModel, {
        sequence: 6,
        eventId: asEventId("evt-dismissed"),
        aggregateKind: "thread",
        aggregateId: asThreadId("manager-console"),
        type: "thread.manager-queue-items-upserted",
        occurredAt: "2026-01-01T00:00:07.000Z",
        commandId: asCommandId("cmd-dismiss"),
        causationEventId: null,
        correlationId: asCommandId("cmd-dismiss"),
        metadata: {},
        payload: {
          threadId: asThreadId("manager-console"),
          managerQueueItems: [
            {
              itemId: "escalation-001",
              escalationThreadId: asThreadId("worker-thread-1"),
              category: "blocker",
              summary: "Need approval for file deletion",
              detail: "The worker wants to delete src/legacy/ but it may be used by other teams.",
              status: "dismissed",
              createdAt: "2026-01-01T00:00:05.000Z",
              addressedAt: null,
              dismissedAt: "2026-01-01T00:00:07.000Z",
            },
          ],
          updatedAt: "2026-01-01T00:00:07.000Z",
        },
      }),
    );

    const createdAt = "2026-01-01T00:00:10.000Z";

    const command: OrchestrationCommand = {
      type: "manager.resolve-queue-item",
      commandId: asCommandId("cmd-resolve-dismissed"),
      threadId: asThreadId("manager-console"),
      itemId: "escalation-001",
      instruction: "This should fail.",
      createdAt,
    };

    await expect(
      Effect.runPromise(decideOrchestrationCommand({ command, readModel })),
    ).rejects.toEqual(
      expect.objectContaining({
        detail: expect.stringContaining("cannot be resolved because it is already"),
      }),
    );
  });

  it("rejects when linked escalation thread is not a worker", async () => {
    const createdAt = "2026-01-01T00:00:10.000Z";

    let badModel = await seedResolutionReadModel();

    // Override the queue item to point to manager-console (not a worker)
    badModel = await Effect.runPromise(
      projectEvent(badModel, {
        sequence: 6,
        eventId: asEventId("evt-bad-escalation"),
        aggregateKind: "thread",
        aggregateId: asThreadId("manager-console"),
        type: "thread.manager-queue-items-upserted",
        occurredAt: "2026-01-01T00:00:07.000Z",
        commandId: asCommandId("cmd-escalate-bad"),
        causationEventId: null,
        correlationId: asCommandId("cmd-escalate-bad"),
        metadata: {},
        payload: {
          threadId: asThreadId("manager-console"),
          managerQueueItems: [
            {
              itemId: "escalation-bad",
              escalationThreadId: asThreadId("manager-console"),
              category: "blocker",
              summary: "Bad escalation to non-worker",
              detail: "This escalation points to the manager console itself.",
              status: "pending",
              createdAt: "2026-01-01T00:00:07.000Z",
              addressedAt: null,
              dismissedAt: null,
            },
          ],
          updatedAt: "2026-01-01T00:00:07.000Z",
        },
      }),
    );

    const badCommand: OrchestrationCommand = {
      type: "manager.resolve-queue-item",
      commandId: asCommandId("cmd-resolve-bad"),
      threadId: asThreadId("manager-console"),
      itemId: "escalation-bad",
      instruction: "This should fail.",
      createdAt,
    };

    await expect(
      Effect.runPromise(decideOrchestrationCommand({ command: badCommand, readModel: badModel })),
    ).rejects.toEqual(
      expect.objectContaining({
        detail: expect.stringContaining("is not a Worker Thread"),
      }),
    );
  });
});
