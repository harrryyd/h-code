import {
  CheckpointRef,
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationCommand,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as PlatformError from "effect/PlatformError";
import { NodeCrypto } from "@effect/platform-node";

import { decideOrchestrationCommand } from "./decider.ts";
import type { OrchestrationProjectorDecodeError } from "./Errors.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const randomEventId = Crypto.Crypto.pipe(Effect.flatMap((crypto) => crypto.randomUUIDv4));

const asCommandId = (value: string): CommandId => CommandId.make(value);
const asProjectId = (value: string): ProjectId => ProjectId.make(value);
const asThreadId = (value: string): ThreadId => ThreadId.make(value);
const asTurnId = (value: string): TurnId => TurnId.make(value);

function seedThreadEffect(readModel: OrchestrationReadModel, overrides?: {
  archivedAt?: string | null;
}): Effect.Effect<
  OrchestrationReadModel,
  OrchestrationProjectorDecodeError | PlatformError.PlatformError,
  Crypto.Crypto
> {
  return Effect.gen(function* () {
    const now = "2026-01-01T00:00:00.000Z";
    let model = readModel;

    if (!model.projects.some((p) => p.id === asProjectId("project-1"))) {
      model = yield* projectEvent(model, {
        sequence: model.snapshotSequence + 1,
        eventId: CommandId.make(yield* randomEventId) as unknown as never,
        aggregateKind: "project",
        aggregateId: asProjectId("project-1"),
        type: "project.created",
        occurredAt: now,
        commandId: asCommandId("cmd-project-create"),
        causationEventId: null,
        correlationId: asCommandId("cmd-project-create"),
        metadata: {},
        payload: {
          projectId: asProjectId("project-1"),
          title: "Project 1",
          workspaceRoot: "/tmp/project-1",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      } as never);
    }

    model = yield* projectEvent(model, {
      sequence: model.snapshotSequence + 1,
      eventId: CommandId.make(yield* randomEventId) as unknown as never,
      aggregateKind: "thread",
      aggregateId: asThreadId("thread-1"),
      type: "thread.created",
      occurredAt: now,
      commandId: asCommandId("cmd-thread-create"),
      causationEventId: null,
      correlationId: asCommandId("cmd-thread-create"),
      metadata: {},
      payload: {
        threadId: asThreadId("thread-1"),
        projectId: asProjectId("project-1"),
        title: "Test Thread",
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "full-access",
        branch: "feat/my-branch",
        worktreePath: "/tmp/worktree-thread-1",
        createdAt: overrides?.archivedAt ?? now,
        updatedAt: now,
      },
    } as never);

    if (overrides?.archivedAt) {
      model = yield* projectEvent(model, {
        sequence: model.snapshotSequence + 1,
        eventId: CommandId.make(yield* randomEventId) as unknown as never,
        aggregateKind: "thread",
        aggregateId: asThreadId("thread-1"),
        type: "thread.archived",
        occurredAt: overrides.archivedAt,
        commandId: asCommandId("cmd-archive"),
        causationEventId: null,
        correlationId: asCommandId("cmd-archive"),
        metadata: {},
        payload: {
          threadId: asThreadId("thread-1"),
          archivedAt: overrides.archivedAt,
          updatedAt: overrides.archivedAt,
        },
      } as never);
    }

    return model;
  });
}

describe("thread.archive-and-new decider", () => {
  it.effect("emits thread.archived-and-new-created and thread.session-stop-requested", () =>
    Effect.gen(function* () {
      const readModel = yield* seedThreadEffect(
        createEmptyReadModel("2026-01-01T00:00:00.000Z"),
      );

      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.archive-and-new",
          commandId: asCommandId("cmd-archive-new"),
          threadId: asThreadId("thread-1"),
          newThreadId: asThreadId("thread-new"),
          createdAt: "2026-01-02T00:00:00.000Z",
        } as Extract<OrchestrationCommand, { type: "thread.archive-and-new" }>,
        readModel,
      });

      const events = Array.isArray(result) ? result : [result];
      assert.strictEqual(events.length, 2);
      assert.strictEqual(events[0]?.type, "thread.archived-and-new-created");
      assert.strictEqual(events[1]?.type, "thread.session-stop-requested");

      if (events[0]?.type === "thread.archived-and-new-created") {
        assert.strictEqual(events[0].payload.archivedThreadId, "thread-1");
        assert.strictEqual(events[0].payload.newThreadId, "thread-new");
        assert.strictEqual(events[0].payload.createdAt, "2026-01-02T00:00:00.000Z");
      }

      if (events[1]?.type === "thread.session-stop-requested") {
        assert.strictEqual(events[1].payload.threadId, "thread-1");
      }
    }).pipe(Effect.provide(NodeCrypto.layer)));

  it.effect("rejects when thread does not exist", () =>
    Effect.gen(function* () {
      const readModel = createEmptyReadModel("2026-01-01T00:00:00.000Z");

      const result = yield* Effect.exit(
        decideOrchestrationCommand({
          command: {
            type: "thread.archive-and-new",
            commandId: asCommandId("cmd-archive-new"),
            threadId: asThreadId("thread-missing"),
            newThreadId: asThreadId("thread-new"),
            createdAt: "2026-01-02T00:00:00.000Z",
          } as Extract<OrchestrationCommand, { type: "thread.archive-and-new" }>,
          readModel,
        }),
      );

      assert.strictEqual(result._tag, "Failure");
    }).pipe(Effect.provide(NodeCrypto.layer)));

  it.effect("rejects when thread is already archived", () =>
    Effect.gen(function* () {
      const readModel = yield* seedThreadEffect(
        createEmptyReadModel("2026-01-01T00:00:00.000Z"),
        { archivedAt: "2026-01-01T00:30:00.000Z" },
      );

      const result = yield* Effect.exit(
        decideOrchestrationCommand({
          command: {
            type: "thread.archive-and-new",
            commandId: asCommandId("cmd-archive-new"),
            threadId: asThreadId("thread-1"),
            newThreadId: asThreadId("thread-new"),
            createdAt: "2026-01-02T00:00:00.000Z",
          } as Extract<OrchestrationCommand, { type: "thread.archive-and-new" }>,
          readModel,
        }),
      );

      assert.strictEqual(result._tag, "Failure");
    }).pipe(Effect.provide(NodeCrypto.layer)));

  it.effect("rejects when new thread ID already exists", () =>
    Effect.gen(function* () {
      const readModel = yield* seedThreadEffect(
        createEmptyReadModel("2026-01-01T00:00:00.000Z"),
      );

      const modelWithCollision = yield* projectEvent(readModel, {
        sequence: readModel.snapshotSequence + 1,
        eventId: CommandId.make(yield* randomEventId) as unknown as never,
        aggregateKind: "thread",
        aggregateId: asThreadId("thread-new"),
        type: "thread.created",
        occurredAt: "2026-01-01T00:01:00.000Z",
        commandId: asCommandId("cmd-collision-create"),
        causationEventId: null,
        correlationId: asCommandId("cmd-collision-create"),
        metadata: {},
        payload: {
          threadId: asThreadId("thread-new"),
          projectId: asProjectId("project-1"),
          title: "Collision Thread",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5-codex",
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt: "2026-01-01T00:01:00.000Z",
          updatedAt: "2026-01-01T00:01:00.000Z",
        },
      } as never);

      const result = yield* Effect.exit(
        decideOrchestrationCommand({
          command: {
            type: "thread.archive-and-new",
            commandId: asCommandId("cmd-archive-new"),
            threadId: asThreadId("thread-1"),
            newThreadId: asThreadId("thread-new"),
            createdAt: "2026-01-02T00:00:00.000Z",
          } as Extract<OrchestrationCommand, { type: "thread.archive-and-new" }>,
          readModel: modelWithCollision,
        }),
      );

      assert.strictEqual(result._tag, "Failure");
    }).pipe(Effect.provide(NodeCrypto.layer)));

  it.effect("rejects archive-and-new when thread has an active turn", () =>
    Effect.gen(function* () {
      const readModel = yield* seedThreadEffect(
        createEmptyReadModel("2026-01-01T00:00:00.000Z"),
      );

      const modelWithActiveTurn = yield* projectEvent(readModel, {
        sequence: readModel.snapshotSequence + 1,
        eventId: CommandId.make("evt-session-active") as unknown as never,
        aggregateKind: "thread",
        aggregateId: asThreadId("thread-1"),
        type: "thread.session-set",
        occurredAt: "2026-01-01T00:05:00.000Z",
        commandId: asCommandId("cmd-session-active"),
        causationEventId: null,
        correlationId: asCommandId("cmd-session-active"),
        metadata: {},
        payload: {
          threadId: asThreadId("thread-1"),
          session: {
            threadId: asThreadId("thread-1"),
            status: "running" as const,
            providerName: "codex",
            runtimeMode: DEFAULT_RUNTIME_MODE,
            activeTurnId: asTurnId("turn-active"),
            lastError: null,
            updatedAt: "2026-01-01T00:05:00.000Z",
          },
        },
      } as never);

      const result = yield* Effect.exit(
        decideOrchestrationCommand({
          command: {
            type: "thread.archive-and-new",
            commandId: asCommandId("cmd-archive-new-active"),
            threadId: asThreadId("thread-1"),
            newThreadId: asThreadId("thread-new"),
            createdAt: "2026-01-02T00:00:00.000Z",
          } as Extract<OrchestrationCommand, { type: "thread.archive-and-new" }>,
          readModel: modelWithActiveTurn,
        }),
      );

      assert.strictEqual(result._tag, "Failure");
    }).pipe(Effect.provide(NodeCrypto.layer)));

  it.effect("accepts archive-and-new when thread has a completed turn", () =>
    Effect.gen(function* () {
      const readModel = yield* seedThreadEffect(
        createEmptyReadModel("2026-01-01T00:00:00.000Z"),
      );

      let model = yield* projectEvent(readModel, {
        sequence: readModel.snapshotSequence + 1,
        eventId: CommandId.make("evt-session-running") as unknown as never,
        aggregateKind: "thread",
        aggregateId: asThreadId("thread-1"),
        type: "thread.session-set",
        occurredAt: "2026-01-01T00:01:00.000Z",
        commandId: asCommandId("cmd-session-running"),
        causationEventId: null,
        correlationId: asCommandId("cmd-session-running"),
        metadata: {},
        payload: {
          threadId: asThreadId("thread-1"),
          session: {
            threadId: asThreadId("thread-1"),
            status: "running" as const,
            providerName: "codex",
            runtimeMode: DEFAULT_RUNTIME_MODE,
            activeTurnId: asTurnId("turn-done"),
            lastError: null,
            updatedAt: "2026-01-01T00:01:00.000Z",
          },
        },
      } as never);

      model = yield* projectEvent(model, {
        sequence: readModel.snapshotSequence + 2,
        eventId: CommandId.make("evt-turn-diff-completed") as unknown as never,
        aggregateKind: "thread",
        aggregateId: asThreadId("thread-1"),
        type: "thread.turn-diff-completed",
        occurredAt: "2026-01-01T00:02:00.000Z",
        commandId: asCommandId("cmd-turn-diff-completed"),
        causationEventId: null,
        correlationId: asCommandId("cmd-turn-diff-completed"),
        metadata: {},
        payload: {
          threadId: asThreadId("thread-1"),
          turnId: asTurnId("turn-done"),
          checkpointTurnCount: 1,
          checkpointRef: CheckpointRef.make("checkpoint-1"),
          status: "ready" as const,
          files: [],
          assistantMessageId: null,
          completedAt: "2026-01-01T00:02:00.000Z",
        },
      } as never);

      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.archive-and-new",
          commandId: asCommandId("cmd-archive-new-done"),
          threadId: asThreadId("thread-1"),
          newThreadId: asThreadId("thread-new"),
          createdAt: "2026-01-02T00:00:00.000Z",
        } as Extract<OrchestrationCommand, { type: "thread.archive-and-new" }>,
        readModel: model,
      });

      const events = Array.isArray(result) ? result : [result];
      assert.strictEqual(events.length, 2);
      assert.strictEqual(events[0]?.type, "thread.archived-and-new-created");
      assert.strictEqual(events[1]?.type, "thread.session-stop-requested");
    }).pipe(Effect.provide(NodeCrypto.layer)));

  it.effect("accepts archive-and-new when thread has no latestTurn (idle)", () =>
    Effect.gen(function* () {
      const readModel = yield* seedThreadEffect(
        createEmptyReadModel("2026-01-01T00:00:00.000Z"),
      );

      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.archive-and-new",
          commandId: asCommandId("cmd-archive-new-idle"),
          threadId: asThreadId("thread-1"),
          newThreadId: asThreadId("thread-new"),
          createdAt: "2026-01-02T00:00:00.000Z",
        } as Extract<OrchestrationCommand, { type: "thread.archive-and-new" }>,
        readModel,
      });

      const events = Array.isArray(result) ? result : [result];
      assert.strictEqual(events.length, 2);
      assert.strictEqual(events[0]?.type, "thread.archived-and-new-created");
      assert.strictEqual(events[1]?.type, "thread.session-stop-requested");
    }).pipe(Effect.provide(NodeCrypto.layer)));
});
