import { ProviderDriverKind, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Schema from "effect/Schema";
import type * as Effect from "effect/Effect";

import type { ThreadMcpToggleRepositoryError } from "../Errors.ts";

export const ThreadMcpToggleRecord = Schema.Struct({
  threadId: ThreadId,
  providerKind: ProviderDriverKind,
  mcpServerName: Schema.String,
  enabled: Schema.Boolean,
  updatedAt: Schema.String,
});
export type ThreadMcpToggleRecord = typeof ThreadMcpToggleRecord.Type;

export const UpsertThreadMcpToggleInput = ThreadMcpToggleRecord;
export type UpsertThreadMcpToggleInput = typeof UpsertThreadMcpToggleInput.Type;

export const ListThreadMcpTogglesByThreadIdInput = Schema.Struct({
  threadId: ThreadId,
});
export type ListThreadMcpTogglesByThreadIdInput = typeof ListThreadMcpTogglesByThreadIdInput.Type;

export const DeleteThreadMcpTogglesByThreadIdInput = Schema.Struct({
  threadId: ThreadId,
});
export type DeleteThreadMcpTogglesByThreadIdInput =
  typeof DeleteThreadMcpTogglesByThreadIdInput.Type;

export interface ThreadMcpToggleRepositoryShape {
  readonly upsert: (
    input: UpsertThreadMcpToggleInput,
  ) => Effect.Effect<void, ThreadMcpToggleRepositoryError>;
  readonly listByThreadId: (
    input: ListThreadMcpTogglesByThreadIdInput,
  ) => Effect.Effect<ReadonlyArray<ThreadMcpToggleRecord>, ThreadMcpToggleRepositoryError>;
  readonly deleteAllForThread: (
    input: DeleteThreadMcpTogglesByThreadIdInput,
  ) => Effect.Effect<void, ThreadMcpToggleRepositoryError>;
}

export class ThreadMcpToggleRepository extends Context.Service<
  ThreadMcpToggleRepository,
  ThreadMcpToggleRepositoryShape
>()("t3/persistence/Services/ThreadMcpToggles/ThreadMcpToggleRepository") {}
