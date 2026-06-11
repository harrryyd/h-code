import {
  CheckpointRef,
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { NodeCrypto } from "@effect/platform-node";
import { describe, expect, it } from "vite-plus/test";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const runDecide = (input: Parameters<typeof decideOrchestrationCommand>[0]) =>
  Effect.runPromise(decideOrchestrationCommand(input).pipe(Effect.provide(NodeCrypto.layer)));

const asCommandId = (value: string): CommandId => CommandId.make(value);
const asEventId = (value: string): EventId => EventId.make(value);
const asProjectId = (value: string): ProjectId => ProjectId.make(value);
const asThreadId = (value: string): ThreadId => ThreadId.make(value);
const asTurnId = (value: string): TurnId => TurnId.make(value);
const asMessageId = (value: string): MessageId => MessageId.make(value);

type PlannedEvent = Omit<OrchestrationEvent, "sequence">;

function makeMessageEvent(input: {
  sequence: number;
  threadId: ThreadId;
  messageId: string;
  role: "user" | "assistant";
  text: string;
  turnId: TurnId | null;
  occurredAt: string;
  commandId: CommandId;
}): OrchestrationEvent {
  return {
    sequence: input.sequence,
    eventId: asEventId(`evt-message-${input.messageId}`),
    aggregateKind: "thread",
    aggregateId: input.threadId,
    type: "thread.message-sent",
    occurredAt: input.occurredAt,
    commandId: input.commandId,
    causationEventId: null,
    correlationId: input.commandId,
    metadata: {},
    payload: {
      threadId: input.threadId,
      messageId: asMessageId(input.messageId),
      role: input.role,
      text: input.text,
      turnId: input.turnId,
      streaming: false,
      createdAt: input.occurredAt,
      updatedAt: input.occurredAt,
    },
  };
}

async function seedThreadWithMessages(): Promise<OrchestrationReadModel> {
  const now = "2026-01-01T00:00:00.000Z";
  let model = createEmptyReadModel(now);

  model = await Effect.runPromise(
    projectEvent(model, {
      sequence: 1,
      eventId: asEventId("evt-project-create"),
      aggregateKind: "project",
      aggregateId: asProjectId("project-trim"),
      type: "project.created",
      occurredAt: now,
      commandId: asCommandId("cmd-project-create"),
      causationEventId: null,
      correlationId: asCommandId("cmd-project-create"),
      metadata: {},
      payload: {
        projectId: asProjectId("project-trim"),
        title: "Project Trim",
        workspaceRoot: "/tmp/project-trim",
        defaultModelSelection: null,
        scripts: [],
        createdAt: now,
        updatedAt: now,
      },
    }),
  );

  model = await Effect.runPromise(
    projectEvent(model, {
      sequence: 2,
      eventId: asEventId("evt-thread-create"),
      aggregateKind: "thread",
      aggregateId: asThreadId("thread-trim"),
      type: "thread.created",
      occurredAt: now,
      commandId: asCommandId("cmd-thread-create"),
      causationEventId: null,
      correlationId: asCommandId("cmd-thread-create"),
      metadata: {},
      payload: {
        threadId: asThreadId("thread-trim"),
        projectId: asProjectId("project-trim"),
        title: "Thread Trim",
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: null,
        createdAt: now,
        updatedAt: now,
      },
    }),
  );

  const messageEvents: ReadonlyArray<OrchestrationEvent> = [
    makeMessageEvent({
      sequence: 3,
      threadId: asThreadId("thread-trim"),
      messageId: "msg-1",
      role: "user",
      text: "First message",
      turnId: asTurnId("turn-1"),
      occurredAt: "2026-01-01T00:01:00.000Z",
      commandId: asCommandId("cmd-msg-1"),
    }),
    makeMessageEvent({
      sequence: 4,
      threadId: asThreadId("thread-trim"),
      messageId: "msg-2",
      role: "assistant",
      text: "Response 1",
      turnId: asTurnId("turn-1"),
      occurredAt: "2026-01-01T00:01:01.000Z",
      commandId: asCommandId("cmd-msg-2"),
    }),
    makeMessageEvent({
      sequence: 5,
      threadId: asThreadId("thread-trim"),
      messageId: "msg-3",
      role: "user",
      text: "Second message",
      turnId: asTurnId("turn-2"),
      occurredAt: "2026-01-01T00:02:00.000Z",
      commandId: asCommandId("cmd-msg-3"),
    }),
    makeMessageEvent({
      sequence: 6,
      threadId: asThreadId("thread-trim"),
      messageId: "msg-4",
      role: "assistant",
      text: "Response 2",
      turnId: asTurnId("turn-2"),
      occurredAt: "2026-01-01T00:02:01.000Z",
      commandId: asCommandId("cmd-msg-4"),
    }),
    makeMessageEvent({
      sequence: 7,
      threadId: asThreadId("thread-trim"),
      messageId: "msg-5",
      role: "user",
      text: "Third message",
      turnId: asTurnId("turn-3"),
      occurredAt: "2026-01-01T00:03:00.000Z",
      commandId: asCommandId("cmd-msg-5"),
    }),
    makeMessageEvent({
      sequence: 8,
      threadId: asThreadId("thread-trim"),
      messageId: "msg-6",
      role: "assistant",
      text: "Response 3",
      turnId: asTurnId("turn-3"),
      occurredAt: "2026-01-01T00:03:01.000Z",
      commandId: asCommandId("cmd-msg-6"),
    }),
    makeMessageEvent({
      sequence: 9,
      threadId: asThreadId("thread-trim"),
      messageId: "msg-unkeyed-1",
      role: "user",
      text: "Unkeyed message",
      turnId: null,
      occurredAt: "2026-01-01T00:04:00.000Z",
      commandId: asCommandId("cmd-msg-unkeyed"),
    }),
  ];

  for (const event of messageEvents) {
    model = await Effect.runPromise(projectEvent(model, event));
  }

  return model;
}

function normalizeTrimEvents(events: PlannedEvent | ReadonlyArray<PlannedEvent>) {
  const list = Array.isArray(events) ? events : [events];
  return list.map((event) => {
    if (event.type === "thread.trim-point-created") {
      return {
        type: event.type,
        aggregateKind: event.aggregateKind,
        aggregateId: event.aggregateId,
        commandId: event.commandId,
        payload: {
          threadId: event.payload.threadId,
          trimPoint: {
            prunedMessageCount: event.payload.trimPoint.prunedMessageCount,
            prunedTurnIds: event.payload.trimPoint.prunedTurnIds,
          },
        },
      };
    }
    if (event.type === "thread.session-stop-requested") {
      return {
        type: event.type,
        aggregateKind: event.aggregateKind,
        aggregateId: event.aggregateId,
        commandId: event.commandId,
        payload: {
          threadId: event.payload.threadId,
        },
      };
    }
    return event;
  });
}

describe("thread.context.trim decider", () => {
  it("emits trim-point-created and session-stop-requested events for a thread with messages", async () => {
    const readModel = await seedThreadWithMessages();

    const result = await runDecide({
      command: {
        type: "thread.context.trim",
        commandId: asCommandId("cmd-trim-all"),
        threadId: asThreadId("thread-trim"),
        createdAt: "2026-01-02T00:00:00.000Z",
      } as Extract<OrchestrationCommand, { type: "thread.context.trim" }>,
      readModel,
    });

    const events = Array.isArray(result) ? result : [result];
    expect(events.map((e) => e.type)).toEqual([
      "thread.trim-point-created",
      "thread.session-stop-requested",
    ]);

    const trimEvent = events.find((e) => e.type === "thread.trim-point-created");
    expect(trimEvent?.payload.trimPoint.prunedMessageCount).toBeGreaterThan(0);
  });

  it("sets prunedMessageCount to 0 for an empty thread (idempotent)", async () => {
    const now = "2026-01-01T00:00:00.000Z";
    let model = createEmptyReadModel(now);

    model = await Effect.runPromise(
      projectEvent(model, {
        sequence: 1,
        eventId: asEventId("evt-project-empty"),
        aggregateKind: "project",
        aggregateId: asProjectId("project-empty"),
        type: "project.created",
        occurredAt: now,
        commandId: asCommandId("cmd-project-empty"),
        causationEventId: null,
        correlationId: asCommandId("cmd-project-empty"),
        metadata: {},
        payload: {
          projectId: asProjectId("project-empty"),
          title: "Project Empty",
          workspaceRoot: "/tmp/project-empty",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      }),
    );

    model = await Effect.runPromise(
      projectEvent(model, {
        sequence: 2,
        eventId: asEventId("evt-thread-empty"),
        aggregateKind: "thread",
        aggregateId: asThreadId("thread-empty"),
        type: "thread.created",
        occurredAt: now,
        commandId: asCommandId("cmd-thread-empty"),
        causationEventId: null,
        correlationId: asCommandId("cmd-thread-empty"),
        metadata: {},
        payload: {
          threadId: asThreadId("thread-empty"),
          projectId: asProjectId("project-empty"),
          title: "Thread Empty",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5-codex",
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      }),
    );

    const result = await runDecide({
      command: {
        type: "thread.context.trim",
        commandId: asCommandId("cmd-trim-empty"),
        threadId: asThreadId("thread-empty"),
        createdAt: "2026-01-02T00:00:00.000Z",
      } as Extract<OrchestrationCommand, { type: "thread.context.trim" }>,
      readModel: model,
    });

    const events = Array.isArray(result) ? result : [result];
    const trimEvent = events.find((e) => e.type === "thread.trim-point-created");
    expect(trimEvent?.payload.trimPoint.prunedMessageCount).toBe(0);
    expect(trimEvent?.payload.trimPoint.prunedTurnIds).toEqual([]);
  });

  it("keeps only the last N turns when keepLastNTurns is specified", async () => {
    const readModel = await seedThreadWithMessages();

    const result = await runDecide({
      command: {
        type: "thread.context.trim",
        commandId: asCommandId("cmd-trim-3"),
        threadId: asThreadId("thread-trim"),
        keepLastNTurns: 2,
        createdAt: "2026-01-02T00:00:00.000Z",
      } as Extract<OrchestrationCommand, { type: "thread.context.trim" }>,
      readModel,
    });

    const events = Array.isArray(result) ? result : [result];
    const trimEvent = events.find((e) => e.type === "thread.trim-point-created");
    const normalized = normalizeTrimEvents(trimEvent!);
    expect(normalized[0]?.payload.trimPoint.prunedTurnIds).toEqual([asTurnId("turn-1")]);
  });

  it("survives all turns when keepLastNTurns >= total turns", async () => {
    const readModel = await seedThreadWithMessages();

    const result = await runDecide({
      command: {
        type: "thread.context.trim",
        commandId: asCommandId("cmd-trim-99"),
        threadId: asThreadId("thread-trim"),
        keepLastNTurns: 99,
        createdAt: "2026-01-02T00:00:00.000Z",
      } as Extract<OrchestrationCommand, { type: "thread.context.trim" }>,
      readModel,
    });

    const events = Array.isArray(result) ? result : [result];
    const trimEvent = events.find((e) => e.type === "thread.trim-point-created");
    expect(trimEvent?.payload.trimPoint.prunedTurnIds).toEqual([]);
  });

  it("rejects trim on a non-existent thread", async () => {
    const readModel = createEmptyReadModel("2026-01-01T00:00:00.000Z");

    await expect(
      runDecide({
        command: {
          type: "thread.context.trim",
          commandId: asCommandId("cmd-trim-unknown"),
          threadId: asThreadId("thread-unknown"),
          createdAt: "2026-01-02T00:00:00.000Z",
        } as Extract<OrchestrationCommand, { type: "thread.context.trim" }>,
        readModel,
      }),
    ).rejects.toBeDefined();
  });

  it("prunes all messages when keepLastNTurns is not specified (/clear without N)", async () => {
    const readModel = await seedThreadWithMessages();

    const result = await runDecide({
      command: {
        type: "thread.context.trim",
        commandId: asCommandId("cmd-trim-clear-all"),
        threadId: asThreadId("thread-trim"),
        createdAt: "2026-01-02T00:00:00.000Z",
      } as Extract<OrchestrationCommand, { type: "thread.context.trim" }>,
      readModel,
    });

    const events = Array.isArray(result) ? result : [result];
    const trimEvent = events.find((e) => e.type === "thread.trim-point-created");
    expect(trimEvent?.payload.trimPoint.prunedMessageCount).toBe(7);
    expect(trimEvent?.payload.trimPoint.prunedTurnIds).toEqual([
      asTurnId("turn-1"),
      asTurnId("turn-2"),
      asTurnId("turn-3"),
    ]);
  });

  it("rejects trim when thread has an active turn (latestTurn.state = running)", async () => {
    const now = "2026-01-01T00:00:00.000Z";
    let model = createEmptyReadModel(now);

    model = await Effect.runPromise(
      projectEvent(model, {
        sequence: 1,
        eventId: asEventId("evt-project-active"),
        aggregateKind: "project",
        aggregateId: asProjectId("project-active"),
        type: "project.created",
        occurredAt: now,
        commandId: asCommandId("cmd-project-active"),
        causationEventId: null,
        correlationId: asCommandId("cmd-project-active"),
        metadata: {},
        payload: {
          projectId: asProjectId("project-active"),
          title: "Project Active",
          workspaceRoot: "/tmp/project-active",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      }),
    );

    model = await Effect.runPromise(
      projectEvent(model, {
        sequence: 2,
        eventId: asEventId("evt-thread-active"),
        aggregateKind: "thread",
        aggregateId: asThreadId("thread-active"),
        type: "thread.created",
        occurredAt: now,
        commandId: asCommandId("cmd-thread-active"),
        causationEventId: null,
        correlationId: asCommandId("cmd-thread-active"),
        metadata: {},
        payload: {
          threadId: asThreadId("thread-active"),
          projectId: asProjectId("project-active"),
          title: "Active Thread",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5-codex",
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: DEFAULT_RUNTIME_MODE,
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      }),
    );

    model = await Effect.runPromise(
      projectEvent(model, {
        sequence: 3,
        eventId: asEventId("evt-session-active"),
        aggregateKind: "thread",
        aggregateId: asThreadId("thread-active"),
        type: "thread.session-set",
        occurredAt: "2026-01-01T00:05:00.000Z",
        commandId: asCommandId("cmd-session-active"),
        causationEventId: null,
        correlationId: asCommandId("cmd-session-active"),
        metadata: {},
        payload: {
          threadId: asThreadId("thread-active"),
          session: {
            threadId: asThreadId("thread-active"),
            status: "running" as const,
            providerName: "codex",
            runtimeMode: DEFAULT_RUNTIME_MODE,
            activeTurnId: asTurnId("turn-active"),
            lastError: null,
            updatedAt: "2026-01-01T00:05:00.000Z",
          },
        },
      }),
    );

    await expect(
      runDecide({
        command: {
          type: "thread.context.trim",
          commandId: asCommandId("cmd-trim-active"),
          threadId: asThreadId("thread-active"),
          createdAt: "2026-01-02T00:00:00.000Z",
        } as Extract<OrchestrationCommand, { type: "thread.context.trim" }>,
        readModel: model,
      }),
    ).rejects.toBeDefined();
  });

  it("accepts trim when thread has no latestTurn (idle)", async () => {
    const now = "2026-01-01T00:00:00.000Z";
    let model = createEmptyReadModel(now);

    model = await Effect.runPromise(
      projectEvent(model, {
        sequence: 1,
        eventId: asEventId("evt-project-idle"),
        aggregateKind: "project",
        aggregateId: asProjectId("project-idle"),
        type: "project.created",
        occurredAt: now,
        commandId: asCommandId("cmd-project-idle"),
        causationEventId: null,
        correlationId: asCommandId("cmd-project-idle"),
        metadata: {},
        payload: {
          projectId: asProjectId("project-idle"),
          title: "Project Idle",
          workspaceRoot: "/tmp/project-idle",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      }),
    );

    model = await Effect.runPromise(
      projectEvent(model, {
        sequence: 2,
        eventId: asEventId("evt-thread-idle"),
        aggregateKind: "thread",
        aggregateId: asThreadId("thread-idle"),
        type: "thread.created",
        occurredAt: now,
        commandId: asCommandId("cmd-thread-idle"),
        causationEventId: null,
        correlationId: asCommandId("cmd-thread-idle"),
        metadata: {},
        payload: {
          threadId: asThreadId("thread-idle"),
          projectId: asProjectId("project-idle"),
          title: "Idle Thread",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5-codex",
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: DEFAULT_RUNTIME_MODE,
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      }),
    );

    const result = await runDecide({
      command: {
        type: "thread.context.trim",
        commandId: asCommandId("cmd-trim-idle"),
        threadId: asThreadId("thread-idle"),
        createdAt: "2026-01-02T00:00:00.000Z",
      } as Extract<OrchestrationCommand, { type: "thread.context.trim" }>,
      readModel: model,
    });

    const events = Array.isArray(result) ? result : [result];
    expect(events.map((e) => e.type)).toEqual([
      "thread.trim-point-created",
      "thread.session-stop-requested",
    ]);
  });

  it("accepts trim when thread has a completed turn", async () => {
    const now = "2026-01-01T00:00:00.000Z";
    let model = createEmptyReadModel(now);

    model = await Effect.runPromise(
      projectEvent(model, {
        sequence: 1,
        eventId: asEventId("evt-project-done"),
        aggregateKind: "project",
        aggregateId: asProjectId("project-done"),
        type: "project.created",
        occurredAt: now,
        commandId: asCommandId("cmd-project-done"),
        causationEventId: null,
        correlationId: asCommandId("cmd-project-done"),
        metadata: {},
        payload: {
          projectId: asProjectId("project-done"),
          title: "Project Done",
          workspaceRoot: "/tmp/project-done",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      }),
    );

    model = await Effect.runPromise(
      projectEvent(model, {
        sequence: 2,
        eventId: asEventId("evt-thread-done"),
        aggregateKind: "thread",
        aggregateId: asThreadId("thread-done"),
        type: "thread.created",
        occurredAt: now,
        commandId: asCommandId("cmd-thread-done"),
        causationEventId: null,
        correlationId: asCommandId("cmd-thread-done"),
        metadata: {},
        payload: {
          threadId: asThreadId("thread-done"),
          projectId: asProjectId("project-done"),
          title: "Done Thread",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5-codex",
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: DEFAULT_RUNTIME_MODE,
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      }),
    );

    model = await Effect.runPromise(
      projectEvent(model, {
        sequence: 3,
        eventId: asEventId("evt-session-running"),
        aggregateKind: "thread",
        aggregateId: asThreadId("thread-done"),
        type: "thread.session-set",
        occurredAt: "2026-01-01T00:01:00.000Z",
        commandId: asCommandId("cmd-session-running"),
        causationEventId: null,
        correlationId: asCommandId("cmd-session-running"),
        metadata: {},
        payload: {
          threadId: asThreadId("thread-done"),
          session: {
            threadId: asThreadId("thread-done"),
            status: "running" as const,
            providerName: "codex",
            runtimeMode: DEFAULT_RUNTIME_MODE,
            activeTurnId: asTurnId("turn-done"),
            lastError: null,
            updatedAt: "2026-01-01T00:01:00.000Z",
          },
        },
      }),
    );

    model = await Effect.runPromise(
      projectEvent(model, {
        sequence: 4,
        eventId: asEventId("evt-turn-diff-completed"),
        aggregateKind: "thread",
        aggregateId: asThreadId("thread-done"),
        type: "thread.turn-diff-completed",
        occurredAt: "2026-01-01T00:02:00.000Z",
        commandId: asCommandId("cmd-turn-diff-completed"),
        causationEventId: null,
        correlationId: asCommandId("cmd-turn-diff-completed"),
        metadata: {},
        payload: {
          threadId: asThreadId("thread-done"),
          turnId: asTurnId("turn-done"),
          checkpointTurnCount: 1,
          checkpointRef: CheckpointRef.make("checkpoint-1"),
          status: "ready" as const,
          files: [],
          assistantMessageId: null,
          completedAt: "2026-01-01T00:02:00.000Z",
        },
      }),
    );

    const result = await runDecide({
      command: {
        type: "thread.context.trim",
        commandId: asCommandId("cmd-trim-done"),
        threadId: asThreadId("thread-done"),
        createdAt: "2026-01-02T00:00:00.000Z",
      } as Extract<OrchestrationCommand, { type: "thread.context.trim" }>,
      readModel: model,
    });

    const events = Array.isArray(result) ? result : [result];
    expect(events.map((e) => e.type)).toEqual([
      "thread.trim-point-created",
      "thread.session-stop-requested",
    ]);
  });
});

describe("thread.context.compact decider", () => {
  it("emits thread.context-compacted for a valid thread", async () => {
    const now = "2026-01-01T00:00:00.000Z";
    const threadId = asThreadId("thread-compact");
    let model = createEmptyReadModel(now);

    model = await Effect.runPromise(
      projectEvent(model, {
        sequence: 1,
        eventId: asEventId("evt-project-compact"),
        aggregateKind: "project",
        aggregateId: asProjectId("project-compact"),
        type: "project.created",
        occurredAt: now,
        commandId: asCommandId("cmd-project-compact"),
        causationEventId: null,
        correlationId: asCommandId("cmd-project-compact"),
        metadata: {},
        payload: {
          projectId: asProjectId("project-compact"),
          title: "Compact Project",
          workspaceRoot: "/tmp/compact-project",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      }),
    );

    model = await Effect.runPromise(
      projectEvent(model, {
        sequence: 2,
        eventId: asEventId("evt-thread-compact"),
        aggregateKind: "thread",
        aggregateId: threadId,
        type: "thread.created",
        occurredAt: now,
        commandId: asCommandId("cmd-thread-compact"),
        causationEventId: null,
        correlationId: asCommandId("cmd-thread-compact"),
        metadata: {},
        payload: {
          threadId,
          projectId: asProjectId("project-compact"),
          title: "Compact Thread",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5-codex",
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: DEFAULT_RUNTIME_MODE,
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      }),
    );

    const result = await runDecide({
      command: {
        type: "thread.context.compact",
        commandId: asCommandId("cmd-compact"),
        threadId,
        createdAt: "2026-01-02T00:00:00.000Z",
      } as Extract<OrchestrationCommand, { type: "thread.context.compact" }>,
      readModel: model,
    });

    const events = Array.isArray(result) ? result : [result];
    expect(events.map((e) => e.type)).toEqual(["thread.context-compacted"]);
  });

  it("rejects compact on non-existent thread", async () => {
    const readModel = createEmptyReadModel("2026-01-01T00:00:00.000Z");

    await expect(
      runDecide({
        command: {
          type: "thread.context.compact",
          commandId: asCommandId("cmd-compact-unknown"),
          threadId: asThreadId("thread-unknown"),
          createdAt: "2026-01-02T00:00:00.000Z",
        } as Extract<OrchestrationCommand, { type: "thread.context.compact" }>,
        readModel,
      }),
    ).rejects.toBeDefined();
  });

  it("rejects compact when thread has an active turn", async () => {
    const now = "2026-01-01T00:00:00.000Z";
    const threadId = asThreadId("thread-compact-active");
    let model = createEmptyReadModel(now);

    model = await Effect.runPromise(
      projectEvent(model, {
        sequence: 1,
        eventId: asEventId("evt-project-compact-active"),
        aggregateKind: "project",
        aggregateId: asProjectId("project-compact-active"),
        type: "project.created",
        occurredAt: now,
        commandId: asCommandId("cmd-project-compact-active"),
        causationEventId: null,
        correlationId: asCommandId("cmd-project-compact-active"),
        metadata: {},
        payload: {
          projectId: asProjectId("project-compact-active"),
          title: "Compact Active",
          workspaceRoot: "/tmp/compact-active",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      }),
    );

    model = await Effect.runPromise(
      projectEvent(model, {
        sequence: 2,
        eventId: asEventId("evt-thread-compact-active"),
        aggregateKind: "thread",
        aggregateId: threadId,
        type: "thread.created",
        occurredAt: now,
        commandId: asCommandId("cmd-thread-compact-active"),
        causationEventId: null,
        correlationId: asCommandId("cmd-thread-compact-active"),
        metadata: {},
        payload: {
          threadId,
          projectId: asProjectId("project-compact-active"),
          title: "Active Thread",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5-codex",
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: DEFAULT_RUNTIME_MODE,
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      }),
    );

    model = await Effect.runPromise(
      projectEvent(model, {
        sequence: 3,
        eventId: asEventId("evt-session-compact-active"),
        aggregateKind: "thread",
        aggregateId: threadId,
        type: "thread.session-set",
        occurredAt: "2026-01-01T00:05:00.000Z",
        commandId: asCommandId("cmd-session-compact-active"),
        causationEventId: null,
        correlationId: asCommandId("cmd-session-compact-active"),
        metadata: {},
        payload: {
          threadId,
          session: {
            threadId,
            status: "running" as const,
            providerName: "codex",
            runtimeMode: DEFAULT_RUNTIME_MODE,
            activeTurnId: asTurnId("turn-active-compact"),
            lastError: null,
            updatedAt: "2026-01-01T00:05:00.000Z",
          },
        },
      }),
    );

    await expect(
      runDecide({
        command: {
          type: "thread.context.compact",
          commandId: asCommandId("cmd-compact-active"),
          threadId,
          createdAt: "2026-01-02T00:00:00.000Z",
        } as Extract<OrchestrationCommand, { type: "thread.context.compact" }>,
        readModel: model,
      }),
    ).rejects.toBeDefined();
  });
});

describe("thread.context.summarize decider", () => {
  it("emits thread.context-summarized for a valid thread", async () => {
    const now = "2026-01-01T00:00:00.000Z";
    const threadId = asThreadId("thread-summarize");
    let model = createEmptyReadModel(now);

    model = await Effect.runPromise(
      projectEvent(model, {
        sequence: 1,
        eventId: asEventId("evt-project-summarize"),
        aggregateKind: "project",
        aggregateId: asProjectId("project-summarize"),
        type: "project.created",
        occurredAt: now,
        commandId: asCommandId("cmd-project-summarize"),
        causationEventId: null,
        correlationId: asCommandId("cmd-project-summarize"),
        metadata: {},
        payload: {
          projectId: asProjectId("project-summarize"),
          title: "Summarize Project",
          workspaceRoot: "/tmp/summarize-project",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      }),
    );

    model = await Effect.runPromise(
      projectEvent(model, {
        sequence: 2,
        eventId: asEventId("evt-thread-summarize"),
        aggregateKind: "thread",
        aggregateId: threadId,
        type: "thread.created",
        occurredAt: now,
        commandId: asCommandId("cmd-thread-summarize"),
        causationEventId: null,
        correlationId: asCommandId("cmd-thread-summarize"),
        metadata: {},
        payload: {
          threadId,
          projectId: asProjectId("project-summarize"),
          title: "Summarize Thread",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5-codex",
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: DEFAULT_RUNTIME_MODE,
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      }),
    );

    const result = await runDecide({
      command: {
        type: "thread.context.summarize",
        commandId: asCommandId("cmd-summarize"),
        threadId,
        summary: "The user asked about compacting threads.",
        compactDurationMs: 1200,
        createdAt: "2026-01-02T00:00:00.000Z",
      } as Extract<OrchestrationCommand, { type: "thread.context.summarize" }>,
      readModel: model,
    });

    const events = Array.isArray(result) ? result : [result];
    expect(events.map((e) => e.type)).toEqual(["thread.context-summarized"]);

    const summarizeEvent = events.find((e) => e.type === "thread.context-summarized");
    expect(summarizeEvent?.payload.summary).toBe("The user asked about compacting threads.");
    expect(summarizeEvent?.payload.compactDurationMs).toBe(1200);
  });

  it("rejects summarize on non-existent thread", async () => {
    const readModel = createEmptyReadModel("2026-01-01T00:00:00.000Z");

    await expect(
      runDecide({
        command: {
          type: "thread.context.summarize",
          commandId: asCommandId("cmd-summarize-unknown"),
          threadId: asThreadId("thread-unknown"),
          summary: "Test",
          createdAt: "2026-01-02T00:00:00.000Z",
        } as Extract<OrchestrationCommand, { type: "thread.context.summarize" }>,
        readModel,
      }),
    ).rejects.toBeDefined();
  });
});

describe("thread.context.trim with summary", () => {
  it("includes summary in trim point when provided", async () => {
    const readModel = await seedThreadWithMessages();

    const result = await runDecide({
      command: {
        type: "thread.context.trim",
        commandId: asCommandId("cmd-trim-summary"),
        threadId: asThreadId("thread-trim"),
        summary: "Compact summary text",
        createdAt: "2026-01-02T00:00:00.000Z",
      } as Extract<OrchestrationCommand, { type: "thread.context.trim" }>,
      readModel,
    });

    const events = Array.isArray(result) ? result : [result];
    const trimEvent = events.find((e) => e.type === "thread.trim-point-created");
    expect(trimEvent?.payload.trimPoint.summary).toBe("Compact summary text");
  });
});
