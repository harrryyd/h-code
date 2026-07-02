import { ProviderDriverKind, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import {
  toPersistenceDecodeError,
  toPersistenceSqlError,
  type ThreadMcpToggleRepositoryError,
} from "../Errors.ts";
import {
  DeleteThreadMcpTogglesByThreadIdInput,
  DeleteThreadMcpToggleInput,
  ListThreadMcpTogglesByThreadIdInput,
  ThreadMcpToggleRecord,
  ThreadMcpToggleRepository,
  type ThreadMcpToggleRepositoryShape,
  UpsertThreadMcpToggleInput,
} from "../Services/ThreadMcpToggles.ts";

const ThreadMcpToggleDbRow = Schema.Struct({
  threadId: ThreadId,
  providerKind: ProviderDriverKind,
  mcpServerName: Schema.String,
  enabled: Schema.Number,
  updatedAt: Schema.String,
});

const mapError =
  (sqlOperation: string, decodeOperation: string) =>
  (cause: unknown): ThreadMcpToggleRepositoryError =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const upsertRow = SqlSchema.void({
    Request: UpsertThreadMcpToggleInput,
    execute: (input) => sql`
      INSERT INTO thread_mcp_toggles (
        thread_id, provider_kind, mcp_server_name, enabled, updated_at
      ) VALUES (
        ${input.threadId}, ${input.providerKind}, ${input.mcpServerName},
        ${input.enabled ? 1 : 0}, ${input.updatedAt}
      )
      ON CONFLICT (thread_id, provider_kind, mcp_server_name)
      DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at
    `,
  });
  const listRows = SqlSchema.findAll({
    Request: ListThreadMcpTogglesByThreadIdInput,
    Result: ThreadMcpToggleDbRow,
    execute: ({ threadId }) => sql`
      SELECT
        thread_id AS "threadId",
        provider_kind AS "providerKind",
        mcp_server_name AS "mcpServerName",
        enabled,
        updated_at AS "updatedAt"
      FROM thread_mcp_toggles
      WHERE thread_id = ${threadId}
      ORDER BY provider_kind, mcp_server_name
    `,
  });
  const deleteRows = SqlSchema.void({
    Request: DeleteThreadMcpTogglesByThreadIdInput,
    execute: ({ threadId }) => sql`
      DELETE FROM thread_mcp_toggles WHERE thread_id = ${threadId}
    `,
  });
  const deleteRow = SqlSchema.void({
    Request: DeleteThreadMcpToggleInput,
    execute: ({ threadId, providerKind, mcpServerName }) => sql`
      DELETE FROM thread_mcp_toggles
      WHERE thread_id = ${threadId}
        AND provider_kind = ${providerKind}
        AND mcp_server_name = ${mcpServerName}
    `,
  });

  return {
    upsert: (input) =>
      upsertRow(input).pipe(
        Effect.mapError(mapError("ThreadMcpToggleRepository.upsert", "encode toggle")),
      ),
    listByThreadId: (input) =>
      listRows(input).pipe(
        Effect.mapError(mapError("ThreadMcpToggleRepository.list", "decode toggles")),
        Effect.map((rows) =>
          rows.map((row) => ({
            ...row,
            enabled: row.enabled !== 0,
          })),
        ),
      ),
    deleteAllForThread: (input) =>
      deleteRows(input).pipe(
        Effect.mapError(mapError("ThreadMcpToggleRepository.delete", "encode thread id")),
      ),
    delete: (input) =>
      deleteRow(input).pipe(
        Effect.mapError(mapError("ThreadMcpToggleRepository.deleteOne", "encode toggle key")),
      ),
  } satisfies ThreadMcpToggleRepositoryShape;
});

export const ThreadMcpToggleRepositoryLive = Layer.effect(ThreadMcpToggleRepository, make);
