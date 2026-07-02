import {
  CommandId,
  EventId,
  IsoDateTime,
  NonNegativeInt,
  OrchestrationAggregateKind,
  OrchestrationEventMetadata,
  ProjectId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

/**
 * Decode-only compatibility for events emitted by pre-v0.0.28 h-code.
 * These schemas are deliberately server-private and are never accepted as
 * client commands or projected into the active thread model.
 */
export const LegacyOrchestrationEventType = Schema.Literals([
  "thread.trim-point-created",
  "thread.context-summarized",
  "thread.context-compacted",
  "thread.archived-and-new-created",
]);

const ContextTrimPoint = Schema.Struct({
  id: EventId,
  createdAt: IsoDateTime,
  beforeEntryId: Schema.String,
  prunedMessageCount: NonNegativeInt,
  prunedTurnIds: Schema.Array(TurnId),
  summary: Schema.optional(Schema.String),
});

const LegacyEventBase = {
  sequence: NonNegativeInt,
  eventId: EventId,
  aggregateKind: OrchestrationAggregateKind,
  aggregateId: Schema.Union([ProjectId, ThreadId]),
  occurredAt: IsoDateTime,
  commandId: Schema.NullOr(CommandId),
  causationEventId: Schema.NullOr(EventId),
  correlationId: Schema.NullOr(CommandId),
  metadata: OrchestrationEventMetadata,
} as const;

export const LegacyOrchestrationEvent = Schema.Union([
  Schema.Struct({
    ...LegacyEventBase,
    type: Schema.Literal("thread.trim-point-created"),
    payload: Schema.Struct({ threadId: ThreadId, trimPoint: ContextTrimPoint }),
  }),
  Schema.Struct({
    ...LegacyEventBase,
    type: Schema.Literal("thread.context-summarized"),
    payload: Schema.Struct({
      threadId: ThreadId,
      trimPointId: Schema.String,
      summary: Schema.String,
      compactDurationMs: Schema.optional(NonNegativeInt),
    }),
  }),
  Schema.Struct({
    ...LegacyEventBase,
    type: Schema.Literal("thread.context-compacted"),
    payload: Schema.Struct({
      threadId: ThreadId,
      summary: Schema.String,
      compactDurationMs: Schema.optional(NonNegativeInt),
    }),
  }),
  Schema.Struct({
    ...LegacyEventBase,
    type: Schema.Literal("thread.archived-and-new-created"),
    payload: Schema.Struct({
      archivedThreadId: ThreadId,
      newThreadId: ThreadId,
      createdAt: IsoDateTime,
    }),
  }),
]);
export type LegacyOrchestrationEvent = typeof LegacyOrchestrationEvent.Type;
