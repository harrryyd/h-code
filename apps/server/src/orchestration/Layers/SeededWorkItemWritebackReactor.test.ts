import {
  CommandId,
  EventId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as PubSub from "effect/PubSub";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  SeededWorkItemWriteback,
  SeededWorkItemWritebackError,
  type SeededWorkItemWritebackShape,
} from "../Services/SeededWorkItemWriteback.ts";
import { SeededWorkItemWritebackReactor } from "../Services/SeededWorkItemWritebackReactor.ts";
import { SeededWorkItemWritebackReactorLive } from "./SeededWorkItemWritebackReactor.ts";

function makeWritebackRequestedEvent(input: {
  readonly itemId: string;
  readonly sourceKind: "jira-set" | "todo-list";
  readonly sourceLabel: string;
  readonly title: string;
  readonly writebackKind: "refinement-context" | "worker-progress";
  readonly body: string;
}): Extract<OrchestrationEvent, { type: "thread.seeded-work-item-writeback-requested" }> {
  return {
    sequence: 1,
    eventId: EventId.make("event-writeback-requested"),
    type: "thread.seeded-work-item-writeback-requested",
    aggregateKind: "thread",
    aggregateId: ThreadId.make("manager-console"),
    occurredAt: "2026-01-01T00:00:00.000Z",
    commandId: CommandId.make("cmd-writeback-request"),
    causationEventId: null,
    correlationId: CommandId.make("cmd-writeback-request"),
    metadata: {},
    payload: {
      threadId: ThreadId.make("manager-console"),
      itemId: input.itemId,
      sourceKind: input.sourceKind,
      sourceLabel: input.sourceLabel,
      title: input.title,
      writebackKind: input.writebackKind,
      body: input.body,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  };
}

describe("SeededWorkItemWritebackReactor", () => {
  let runtime: ManagedRuntime.ManagedRuntime<SeededWorkItemWritebackReactor, never> | null = null;
  let scope: Scope.Closeable | null = null;

  afterEach(async () => {
    if (scope) {
      await Effect.runPromise(Scope.close(scope, Exit.void));
    }
    scope = null;
    if (runtime) {
      await runtime.dispose();
    }
    runtime = null;
  });

  async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
    const deadline = (await Effect.runPromise(Clock.currentTimeMillis)) + timeoutMs;
    while (!predicate()) {
      if ((await Effect.runPromise(Clock.currentTimeMillis)) >= deadline) {
        throw new Error("Timed out waiting for expectation.");
      }
      await Effect.runPromise(Effect.yieldNow);
    }
  }

  async function createHarness(append: SeededWorkItemWritebackShape["append"]) {
    const domainEvents = Effect.runSync(PubSub.unbounded<OrchestrationEvent>());
    const dispatch = vi.fn((_command: OrchestrationCommand) => Effect.succeed({ sequence: 1 }));
    runtime = ManagedRuntime.make(
      SeededWorkItemWritebackReactorLive.pipe(
        Layer.provide(
          Layer.succeed(OrchestrationEngineService, {
            readEvents: () => Stream.empty,
            dispatch,
            streamDomainEvents: Stream.fromPubSub(domainEvents),
          }),
        ),
        Layer.provide(Layer.succeed(SeededWorkItemWriteback, { append })),
      ),
    );
    const reactor = await runtime.runPromise(Effect.service(SeededWorkItemWritebackReactor));
    scope = await Effect.runPromise(Scope.make("sequential"));
    await Effect.runPromise(reactor.start().pipe(Scope.provide(scope)));
    await Effect.runPromise(Effect.yieldNow);

    return {
      reactor,
      dispatch,
      publish: (event: OrchestrationEvent) =>
        Effect.runPromise(PubSub.publish(domainEvents, event)),
    };
  }

  it("dispatches a success activity when refinement context is appended back to a Jira item", async () => {
    const append = vi.fn((input: Parameters<SeededWorkItemWritebackShape["append"]>[0]) =>
      Effect.succeed({
        externalReference: `jira-comment:${input.itemId}`,
      }),
    );
    const harness = await createHarness(append);

    await harness.publish(
      makeWritebackRequestedEvent({
        itemId: "JIRA-21",
        sourceKind: "jira-set",
        sourceLabel: "Jira",
        title: "Refine manager writeback",
        writebackKind: "refinement-context",
        body: "Refined problem statement and acceptance criteria.",
      }),
    );
    await waitFor(() => append.mock.calls.length === 1);
    await Effect.runPromise(harness.reactor.drain);

    expect(append).toHaveBeenCalledWith({
      sourceKind: "jira-set",
      sourceLabel: "Jira",
      itemId: "JIRA-21",
      title: "Refine manager writeback",
      writebackKind: "refinement-context",
      body: "Refined problem statement and acceptance criteria.",
    });
    expect(harness.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "thread.activity.append",
        threadId: "manager-console",
        activity: expect.objectContaining({
          tone: "info",
          kind: "manager.seeded-work-item-writeback.succeeded",
          summary: "Appended refinement context back to Jira item JIRA-21.",
          payload: expect.objectContaining({
            itemId: "JIRA-21",
            sourceKind: "jira-set",
            writebackKind: "refinement-context",
            externalReference: "jira-comment:JIRA-21",
          }),
        }),
      }),
    );
  });

  it("dispatches a failure activity when worker-progress writeback fails", async () => {
    const append = vi.fn(() =>
      Effect.fail(
        new SeededWorkItemWritebackError({
          detail: "Atlassian MCP is unavailable for append-only comments.",
        }),
      ),
    );
    const harness = await createHarness(append);

    await harness.publish(
      makeWritebackRequestedEvent({
        itemId: "todo-21",
        sourceKind: "todo-list",
        sourceLabel: "Todo",
        title: "Track worker progress",
        writebackKind: "worker-progress",
        body: "Worker finished the investigation and is awaiting review.",
      }),
    );
    await waitFor(() => harness.dispatch.mock.calls.length === 1);
    await Effect.runPromise(harness.reactor.drain);

    expect(harness.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "thread.activity.append",
        threadId: "manager-console",
        activity: expect.objectContaining({
          tone: "error",
          kind: "manager.seeded-work-item-writeback.failed",
          summary: "Failed to append worker progress back to Todo item todo-21.",
          payload: expect.objectContaining({
            itemId: "todo-21",
            sourceKind: "todo-list",
            writebackKind: "worker-progress",
            detail: "Atlassian MCP is unavailable for append-only comments.",
          }),
        }),
      }),
    );
  });
});
