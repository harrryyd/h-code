import { CommandId, EventId, type OrchestrationEvent } from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  SeededWorkItemWriteback,
  SeededWorkItemWritebackError,
} from "../Services/SeededWorkItemWriteback.ts";
import {
  SeededWorkItemWritebackReactor,
  type SeededWorkItemWritebackReactorShape,
} from "../Services/SeededWorkItemWritebackReactor.ts";

type WritebackRequestedEvent = Extract<
  OrchestrationEvent,
  { type: "thread.seeded-work-item-writeback-requested" }
>;

const serverCommandId = (tag: string): CommandId =>
  CommandId.make(`server:${tag}:${crypto.randomUUID()}`);
const isSeededWorkItemWritebackError = Schema.is(SeededWorkItemWritebackError);

function summarizeWritebackKind(kind: WritebackRequestedEvent["payload"]["writebackKind"]): string {
  switch (kind) {
    case "refinement-context":
      return "refinement context";
    case "worker-progress":
      return "worker progress";
  }
}

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const writeback = yield* SeededWorkItemWriteback;

  const appendOutcomeActivity = (input: {
    readonly threadId: WritebackRequestedEvent["payload"]["threadId"];
    readonly tone: "info" | "error";
    readonly kind:
      | "manager.seeded-work-item-writeback.succeeded"
      | "manager.seeded-work-item-writeback.failed";
    readonly summary: string;
    readonly payload: Record<string, unknown>;
    readonly createdAt: string;
  }) =>
    orchestrationEngine.dispatch({
      type: "thread.activity.append",
      commandId: serverCommandId("seeded-work-item-writeback-activity"),
      threadId: input.threadId,
      activity: {
        id: EventId.make(crypto.randomUUID()),
        tone: input.tone,
        kind: input.kind,
        summary: input.summary,
        payload: input.payload,
        turnId: null,
        createdAt: input.createdAt,
      },
      createdAt: input.createdAt,
    });

  const processWritebackRequested = Effect.fn("processWritebackRequested")(function* (
    event: WritebackRequestedEvent,
  ) {
    const { payload } = event;
    const writebackLabel = summarizeWritebackKind(payload.writebackKind);
    const result = yield* Effect.exit(
      writeback.append({
        sourceKind: payload.sourceKind,
        sourceLabel: payload.sourceLabel,
        itemId: payload.itemId,
        title: payload.title,
        writebackKind: payload.writebackKind,
        body: payload.body,
      }),
    );

    if (Exit.isSuccess(result)) {
      yield* appendOutcomeActivity({
        threadId: payload.threadId,
        tone: "info",
        kind: "manager.seeded-work-item-writeback.succeeded",
        summary: `Appended ${writebackLabel} back to ${payload.sourceLabel} item ${payload.itemId}.`,
        payload: {
          itemId: payload.itemId,
          sourceKind: payload.sourceKind,
          sourceLabel: payload.sourceLabel,
          writebackKind: payload.writebackKind,
          body: payload.body,
          ...(result.value.externalReference !== undefined
            ? { externalReference: result.value.externalReference }
            : {}),
        },
        createdAt: payload.createdAt,
      });
      return;
    }

    const failReason = result.cause.reasons.find(Cause.isFailReason);
    const detail = isSeededWorkItemWritebackError(failReason?.error)
      ? failReason.error.detail
      : Cause.pretty(result.cause);

    yield* appendOutcomeActivity({
      threadId: payload.threadId,
      tone: "error",
      kind: "manager.seeded-work-item-writeback.failed",
      summary: `Failed to append ${writebackLabel} back to ${payload.sourceLabel} item ${payload.itemId}.`,
      payload: {
        itemId: payload.itemId,
        sourceKind: payload.sourceKind,
        sourceLabel: payload.sourceLabel,
        writebackKind: payload.writebackKind,
        body: payload.body,
        detail,
      },
      createdAt: payload.createdAt,
    });
  });

  const processWritebackRequestedSafely = (event: WritebackRequestedEvent) =>
    processWritebackRequested(event).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("seeded work item writeback reactor failed to process event", {
          eventType: event.type,
          threadId: event.payload.threadId,
          itemId: event.payload.itemId,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(processWritebackRequestedSafely);

  const start: SeededWorkItemWritebackReactorShape["start"] = Effect.fn("start")(function* () {
    yield* Effect.forkScoped(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
        if (event.type !== "thread.seeded-work-item-writeback-requested") {
          return Effect.void;
        }
        return worker.enqueue(event);
      }),
    );
  });

  return {
    start,
    drain: worker.drain,
  } satisfies SeededWorkItemWritebackReactorShape;
});

export const SeededWorkItemWritebackReactorLive = Layer.effect(
  SeededWorkItemWritebackReactor,
  make,
);
