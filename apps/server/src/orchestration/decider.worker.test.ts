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
import { describe, expect, it } from "vitest";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const asCommandId = (value: string): CommandId => CommandId.make(value);
const asEventId = (value: string): EventId => EventId.make(value);
const asProjectId = (value: string): ProjectId => ProjectId.make(value);
const asThreadId = (value: string): ThreadId => ThreadId.make(value);

type PlannedEvent = Omit<OrchestrationEvent, "sequence">;

async function seedWorkerDelegationReadModel(): Promise<OrchestrationReadModel> {
  const now = "2026-01-01T00:00:00.000Z";
  let model = createEmptyReadModel(now);

  const eventIds = {
    projectManager: asEventId("evt-project-manager"),
    threadManagerConsole: asEventId("evt-thread-manager-console"),
    projectApp: asEventId("evt-project-app"),
    threadRefiner: asEventId("evt-thread-refiner"),
    seedWorkItems: asEventId("evt-seed-work-items"),
  };

  model = await Effect.runPromise(
    projectEvent(model, {
      sequence: 1,
      eventId: eventIds.projectManager,
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
      eventId: eventIds.threadManagerConsole,
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

  model = await Effect.runPromise(
    projectEvent(model, {
      sequence: 3,
      eventId: eventIds.projectApp,
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

  model = await Effect.runPromise(
    projectEvent(model, {
      sequence: 4,
      eventId: eventIds.seedWorkItems,
      aggregateKind: "thread",
      aggregateId: asThreadId("manager-console"),
      type: "thread.seeded-work-items-upserted",
      occurredAt: now,
      commandId: asCommandId("cmd-seed"),
      causationEventId: null,
      correlationId: asCommandId("cmd-seed"),
      metadata: {},
      payload: {
        threadId: asThreadId("manager-console"),
        seededWorkItems: [
          {
            itemId: "work-refine",
            sourceKind: "todo-list",
            sourceLabel: "Sprint Backlog",
            title: "Billing CSV export",
            body: "The original Jira description for billing CSV export.",
            delegationIntent: "delegate",
            targetProjectId: asProjectId("app-project"),
            acceptanceCriteria: ["Export button visible", "CSV includes invoice data"],
            refinementHandoff: {
              refinerThreadId: asThreadId("refiner-thread-1"),
              sourceBody: "The original Jira description for billing CSV export.",
              refinedProblemStatement:
                "Users can export billing data as CSV from the invoices screen.",
              acceptanceCriteria: ["Export button visible", "CSV includes invoice data"],
              targetProjectId: asProjectId("app-project"),
              recordedAt: "2026-01-01T00:00:05.000Z",
            },
            readiness: "ready-for-worker",
            readinessReason: "Has project and acceptance criteria.",
            delegationStatus: "requested",
            delegationRequestedAt: "2026-01-01T00:00:05.000Z",
            createdAt: now,
            updatedAt: "2026-01-01T00:00:05.000Z",
          },
        ],
        updatedAt: now,
      },
    }),
  );

  model = await Effect.runPromise(
    projectEvent(model, {
      sequence: 5,
      eventId: eventIds.threadRefiner,
      aggregateKind: "thread",
      aggregateId: asThreadId("refiner-thread-1"),
      type: "thread.created",
      occurredAt: now,
      commandId: asCommandId("cmd-create-refiner"),
      causationEventId: null,
      correlationId: asCommandId("cmd-create-refiner"),
      metadata: {},
      payload: {
        threadId: asThreadId("refiner-thread-1"),
        projectId: asProjectId("app-project"),
        title: "Refine: Billing CSV export",
        managerMetadata: {
          role: "refiner",
          managerThreadId: asThreadId("manager-console"),
          seededWorkItemId: "work-refine",
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
    if (entry.type === "thread.created") {
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

describe("worker.delegate", () => {
  it("creates a Worker Thread in the target project with correct metadata", async () => {
    const readModel = await seedWorkerDelegationReadModel();
    const createdAt = "2026-01-01T00:00:10.000Z";

    const command: OrchestrationCommand = {
      type: "worker.delegate",
      commandId: asCommandId("cmd-worker-delegate"),
      workerThreadId: asThreadId("worker-thread-1"),
      refinerThreadId: asThreadId("refiner-thread-1"),
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5-codex",
      },
      runtimeMode: "full-access",
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      branch: null,
      worktreePath: null,
      createdAt,
    };

    const result = await Effect.runPromise(decideOrchestrationCommand({ command, readModel }));

    const events = normalizeEvent(result);

    expect(events).toEqual([
      expect.objectContaining({
        type: "thread.created",
        aggregateKind: "thread",
        aggregateId: asThreadId("worker-thread-1"),
        payload: expect.objectContaining({
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
          createdAt,
          updatedAt: createdAt,
        }),
      }),
    ]);
  });

  it("rejects delegation if the seeded work item has no refinement handoff", async () => {
    const readModel = await seedWorkerDelegationReadModel();
    const createdAt = "2026-01-01T00:00:10.000Z";

    const readModelWithoutHandoff: OrchestrationReadModel = {
      ...readModel,
      threads: readModel.threads.map((thread) => {
        if (thread.id !== asThreadId("manager-console")) return thread;
        return Object.assign({}, thread, {
          seededWorkItems: thread.seededWorkItems?.map((item) => {
            const copy = { ...item, refinementHandoff: undefined };
            return copy;
          }),
        });
      }),
    };

    const command: OrchestrationCommand = {
      type: "worker.delegate",
      commandId: asCommandId("cmd-worker-delegate"),
      workerThreadId: asThreadId("worker-thread-1"),
      refinerThreadId: asThreadId("refiner-thread-1"),
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5-codex",
      },
      runtimeMode: "full-access",
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      branch: null,
      worktreePath: null,
      createdAt,
    };

    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({ command, readModel: readModelWithoutHandoff }),
      ),
    ).rejects.toEqual(
      expect.objectContaining({
        detail: expect.stringContaining("does not have a refinement handoff"),
      }),
    );
  });

  it("rejects delegation if the seeded work item is not delegation-requested", async () => {
    const readModel = await seedWorkerDelegationReadModel();
    const createdAt = "2026-01-01T00:00:10.000Z";

    const readModelNotRequested: OrchestrationReadModel = {
      ...readModel,
      threads: readModel.threads.map((thread) => {
        if (thread.id !== asThreadId("manager-console")) return thread;
        return Object.assign({}, thread, {
          seededWorkItems: thread.seededWorkItems?.map((item) => {
            const copy = { ...item, delegationStatus: "idle" as const };
            return copy;
          }),
        });
      }),
    };

    const command: OrchestrationCommand = {
      type: "worker.delegate",
      commandId: asCommandId("cmd-worker-delegate"),
      workerThreadId: asThreadId("worker-thread-1"),
      refinerThreadId: asThreadId("refiner-thread-1"),
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5-codex",
      },
      runtimeMode: "full-access",
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      branch: null,
      worktreePath: null,
      createdAt,
    };

    await expect(
      Effect.runPromise(decideOrchestrationCommand({ command, readModel: readModelNotRequested })),
    ).rejects.toEqual(
      expect.objectContaining({
        detail: expect.stringContaining("delegation status is 'idle'"),
      }),
    );
  });
});
