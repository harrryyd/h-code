import { ProviderDriverKind, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";

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
export const ListThreadMcpTogglesByThreadIdInput = Schema.Struct({ threadId: ThreadId });
export const DeleteThreadMcpTogglesByThreadIdInput = Schema.Struct({ threadId: ThreadId });
export const DeleteThreadMcpToggleInput = Schema.Struct({
  threadId: ThreadId,
  providerKind: ProviderDriverKind,
  mcpServerName: Schema.String,
});

export interface ThreadMcpToggleRepositoryShape {
  readonly upsert: (
    input: typeof UpsertThreadMcpToggleInput.Type,
  ) => Effect.Effect<void, ThreadMcpToggleRepositoryError>;
  readonly listByThreadId: (
    input: typeof ListThreadMcpTogglesByThreadIdInput.Type,
  ) => Effect.Effect<ReadonlyArray<ThreadMcpToggleRecord>, ThreadMcpToggleRepositoryError>;
  readonly deleteAllForThread: (
    input: typeof DeleteThreadMcpTogglesByThreadIdInput.Type,
  ) => Effect.Effect<void, ThreadMcpToggleRepositoryError>;
  readonly delete: (
    input: typeof DeleteThreadMcpToggleInput.Type,
  ) => Effect.Effect<void, ThreadMcpToggleRepositoryError>;
}

export class ThreadMcpToggleRepository extends Context.Reference<ThreadMcpToggleRepositoryShape>(
  "t3/persistence/Services/ThreadMcpToggles/ThreadMcpToggleRepository",
  {
    defaultValue: () => ({
      upsert: () => Effect.void,
      listByThreadId: () => Effect.succeed([]),
      deleteAllForThread: () => Effect.void,
      delete: () => Effect.void,
    }),
  },
) {}
