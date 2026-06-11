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

const decideOrchestrationCommand = (input: Parameters<typeof decideOrchestrationCommandRaw>[0]) =>
  decideOrchestrationCommandRaw(input).pipe(Effect.provide(NodeCrypto.layer));
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const asCommandId = (value: string): CommandId => CommandId.make(value);
const asEventId = (value: string): EventId => EventId.make(value);
const asProjectId = (value: string): ProjectId => ProjectId.make(value);
const asThreadId = (value: string): ThreadId => ThreadId.make(value);

type PlannedEvent = Omit<OrchestrationEvent, "sequence">;

async function seedEscalationReadModel(): Promise<OrchestrationReadModel> {
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

  return model;
}

function normalizeEvent(event: PlannedEvent | ReadonlyArray<PlannedEvent>): PlannedEvent[] {
  const events = Array.isArray(event) ? event : [event];
  return events.map((entry) => {
    if (entry.type === "thread.manager-queue-items-upserted") {
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

describe("worker.escalate", () => {
  it("creates a Manager Queue Item on the Manager Console", async () => {
    const readModel = await seedEscalationReadModel();
    const createdAt = "2026-01-01T00:00:10.000Z";

    const command: OrchestrationCommand = {
      type: "worker.escalate",
      commandId: asCommandId("cmd-escalate-1"),
      threadId: asThreadId("worker-thread-1"),
      escalationId: "escalation-001",
      category: "blocker",
      summary: "Need approval for file deletion",
      detail: "The worker wants to delete src/legacy/ but it may be used by other teams.",
      createdAt,
    };

    const result = await Effect.runPromise(decideOrchestrationCommand({ command, readModel }));

    const events = normalizeEvent(result);

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
              status: "pending",
              createdAt,
              addressedAt: null,
              dismissedAt: null,
            }),
          ],
          updatedAt: createdAt,
        }),
      }),
    ]);
  });

  it("appends to existing queue items to maintain FIFO order", async () => {
    let readModel = await seedEscalationReadModel();
    const now = "2026-01-01T00:00:05.000Z";

    // Pre-seed with an existing queue item
    readModel = await Effect.runPromise(
      projectEvent(readModel, {
        sequence: 5,
        eventId: asEventId("evt-queue-seed"),
        aggregateKind: "thread",
        aggregateId: asThreadId("manager-console"),
        type: "thread.manager-queue-items-upserted",
        occurredAt: now,
        commandId: asCommandId("cmd-escalate-0"),
        causationEventId: null,
        correlationId: asCommandId("cmd-escalate-0"),
        metadata: {},
        payload: {
          threadId: asThreadId("manager-console"),
          managerQueueItems: [
            {
              itemId: "escalation-000",
              escalationThreadId: asThreadId("worker-thread-1"),
              category: "question",
              summary: "What is the deployment process?",
              detail: "Need clarification on how deployments are handled.",
              status: "pending",
              createdAt: now,
              addressedAt: null,
              dismissedAt: null,
            },
          ],
          updatedAt: now,
        },
      }),
    );

    const createdAt = "2026-01-01T00:00:10.000Z";
    const command: OrchestrationCommand = {
      type: "worker.escalate",
      commandId: asCommandId("cmd-escalate-1"),
      threadId: asThreadId("worker-thread-1"),
      escalationId: "escalation-001",
      category: "blocker",
      summary: "Need approval for file deletion",
      detail: "The worker wants to delete src/legacy/ but it may be used by other teams.",
      createdAt,
    };

    const result = await Effect.runPromise(decideOrchestrationCommand({ command, readModel }));

    const events = normalizeEvent(result);

    expect(events).toEqual([
      expect.objectContaining({
        type: "thread.manager-queue-items-upserted",
        aggregateKind: "thread",
        aggregateId: asThreadId("manager-console"),
        payload: expect.objectContaining({
          threadId: asThreadId("manager-console"),
          managerQueueItems: [
            expect.objectContaining({ itemId: "escalation-000" }),
            expect.objectContaining({ itemId: "escalation-001" }),
          ],
          updatedAt: createdAt,
        }),
      }),
    ]);
  });

  it("rejects escalation when escalationId already exists (duplicate-safe)", async () => {
    let readModel = await seedEscalationReadModel();
    const now = "2026-01-01T00:00:05.000Z";

    // Pre-seed with the same escalation
    readModel = await Effect.runPromise(
      projectEvent(readModel, {
        sequence: 5,
        eventId: asEventId("evt-queue-seed"),
        aggregateKind: "thread",
        aggregateId: asThreadId("manager-console"),
        type: "thread.manager-queue-items-upserted",
        occurredAt: now,
        commandId: asCommandId("cmd-escalate-initial"),
        causationEventId: null,
        correlationId: asCommandId("cmd-escalate-initial"),
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
              createdAt: now,
              addressedAt: null,
              dismissedAt: null,
            },
          ],
          updatedAt: now,
        },
      }),
    );

    const createdAt = "2026-01-01T00:00:10.000Z";
    const command: OrchestrationCommand = {
      type: "worker.escalate",
      commandId: asCommandId("cmd-escalate-dup"),
      threadId: asThreadId("worker-thread-1"),
      escalationId: "escalation-001",
      category: "blocker",
      summary: "Need approval for file deletion",
      detail: "The worker wants to delete src/legacy/ but it may be used by other teams.",
      createdAt,
    };

    await expect(
      Effect.runPromise(decideOrchestrationCommand({ command, readModel })),
    ).rejects.toEqual(
      expect.objectContaining({
        detail: expect.stringContaining("already exists on Manager Console"),
      }),
    );
  });

  it("rejects escalation from a non-worker thread", async () => {
    const readModel = await seedEscalationReadModel();
    const createdAt = "2026-01-01T00:00:10.000Z";

    const command: OrchestrationCommand = {
      type: "worker.escalate",
      commandId: asCommandId("cmd-escalate-bad"),
      threadId: asThreadId("manager-console"),
      escalationId: "escalation-001",
      category: "blocker",
      summary: "Should fail",
      detail: "Manager console is not a worker thread.",
      createdAt,
    };

    await expect(
      Effect.runPromise(decideOrchestrationCommand({ command, readModel })),
    ).rejects.toEqual(
      expect.objectContaining({
        detail: expect.stringContaining("is not a Worker Thread"),
      }),
    );
  });

  it("rejects escalation when thread does not exist", async () => {
    const readModel = await seedEscalationReadModel();
    const createdAt = "2026-01-01T00:00:10.000Z";

    const command: OrchestrationCommand = {
      type: "worker.escalate",
      commandId: asCommandId("cmd-escalate-bad"),
      threadId: asThreadId("nonexistent-thread"),
      escalationId: "escalation-001",
      category: "blocker",
      summary: "Should fail",
      detail: "This thread does not exist.",
      createdAt,
    };

    await expect(
      Effect.runPromise(decideOrchestrationCommand({ command, readModel })),
    ).rejects.toEqual(
      expect.objectContaining({
        detail: expect.stringContaining("does not exist"),
      }),
    );
  });
});
