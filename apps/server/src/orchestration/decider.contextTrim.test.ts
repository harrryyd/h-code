import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const asCommandId = (value: string): CommandId => CommandId.make(value);
const asEventId = (value: string): EventId => EventId.make(value);
const asProjectId = (value: string): ProjectId => ProjectId.make(value);
const asThreadId = (value: string): ThreadId => ThreadId.make(value);
const asTurnId = (value: string): TurnId => TurnId.make(value);
const asMessageId = (value: string) => value;

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
      messageId: input.messageId,
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

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "thread.context.trim",
          commandId: asCommandId("cmd-trim-all"),
          threadId: asThreadId("thread-trim"),
          createdAt: "2026-01-02T00:00:00.000Z",
        } as Extract<OrchestrationCommand, { type: "thread.context.trim" }>,
        readModel,
      }),
    );

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

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "thread.context.trim",
          commandId: asCommandId("cmd-trim-empty"),
          threadId: asThreadId("thread-empty"),
          createdAt: "2026-01-02T00:00:00.000Z",
        } as Extract<OrchestrationCommand, { type: "thread.context.trim" }>,
        readModel: model,
      }),
    );

    const events = Array.isArray(result) ? result : [result];
    const trimEvent = events.find((e) => e.type === "thread.trim-point-created");
    expect(trimEvent?.payload.trimPoint.prunedMessageCount).toBe(0);
    expect(trimEvent?.payload.trimPoint.prunedTurnIds).toEqual([]);
  });

  it("keeps only the last N turns when keepLastNTurns is specified", async () => {
    const readModel = await seedThreadWithMessages();

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "thread.context.trim",
          commandId: asCommandId("cmd-trim-3"),
          threadId: asThreadId("thread-trim"),
          keepLastNTurns: 2,
          createdAt: "2026-01-02T00:00:00.000Z",
        } as Extract<OrchestrationCommand, { type: "thread.context.trim" }>,
        readModel,
      }),
    );

    const events = Array.isArray(result) ? result : [result];
    const trimEvent = events.find((e) => e.type === "thread.trim-point-created");
    const normalized = normalizeTrimEvents(trimEvent!);
    expect(normalized[0]?.payload.trimPoint.prunedTurnIds).toEqual([
      asTurnId("turn-1"),
    ]);
  });

  it("survives all turns when keepLastNTurns >= total turns", async () => {
    const readModel = await seedThreadWithMessages();

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "thread.context.trim",
          commandId: asCommandId("cmd-trim-99"),
          threadId: asThreadId("thread-trim"),
          keepLastNTurns: 99,
          createdAt: "2026-01-02T00:00:00.000Z",
        } as Extract<OrchestrationCommand, { type: "thread.context.trim" }>,
        readModel,
      }),
    );

    const events = Array.isArray(result) ? result : [result];
    const trimEvent = events.find((e) => e.type === "thread.trim-point-created");
    expect(trimEvent?.payload.trimPoint.prunedTurnIds).toEqual([]);
  });

  it("rejects trim on a non-existent thread", async () => {
    const readModel = createEmptyReadModel("2026-01-01T00:00:00.000Z");

    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          command: {
            type: "thread.context.trim",
            commandId: asCommandId("cmd-trim-unknown"),
            threadId: asThreadId("thread-unknown"),
            createdAt: "2026-01-02T00:00:00.000Z",
          } as Extract<OrchestrationCommand, { type: "thread.context.trim" }>,
          readModel,
        }),
      ),
    ).rejects.toBeDefined();
  });

  it("prunes all messages when keepLastNTurns is not specified (/clear without N)", async () => {
    const readModel = await seedThreadWithMessages();

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "thread.context.trim",
          commandId: asCommandId("cmd-trim-clear-all"),
          threadId: asThreadId("thread-trim"),
          createdAt: "2026-01-02T00:00:00.000Z",
        } as Extract<OrchestrationCommand, { type: "thread.context.trim" }>,
        readModel,
      }),
    );

    const events = Array.isArray(result) ? result : [result];
    const trimEvent = events.find((e) => e.type === "thread.trim-point-created");
    expect(trimEvent?.payload.trimPoint.prunedMessageCount).toBe(6);
    expect(trimEvent?.payload.trimPoint.prunedTurnIds).toEqual([
      asTurnId("turn-1"),
      asTurnId("turn-2"),
      asTurnId("turn-3"),
    ]);
  });
});
