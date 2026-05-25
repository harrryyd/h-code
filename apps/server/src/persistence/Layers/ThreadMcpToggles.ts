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
  ThreadMcpToggleRecord,
  ThreadMcpToggleRepository,
  type ThreadMcpToggleRepositoryShape,
  DeleteThreadMcpTogglesByThreadIdInput,
  ListThreadMcpTogglesByThreadIdInput,
  UpsertThreadMcpToggleInput,
} from "../Services/ThreadMcpToggles.ts";

const ThreadMcpToggleDbRow = Schema.Struct({
  threadId: ThreadId,
  providerKind: ProviderDriverKind,
  mcpServerName: Schema.String,
  enabled: Schema.Number,
  updatedAt: Schema.String,
});

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown): ThreadMcpToggleRepositoryError =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

function toThreadMcpToggleRecord(
  row: typeof ThreadMcpToggleDbRow.Type,
): typeof ThreadMcpToggleRecord.Type {
  return {
    threadId: row.threadId,
    providerKind: row.providerKind,
    mcpServerName: row.mcpServerName,
    enabled: row.enabled !== 0,
    updatedAt: row.updatedAt,
  };
}

const makeThreadMcpToggleRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertRow = SqlSchema.void({
    Request: UpsertThreadMcpToggleInput,
    execute: (input) =>
      sql`
        INSERT INTO thread_mcp_toggles (
          thread_id,
          provider_kind,
          mcp_server_name,
          enabled,
          updated_at
        )
        VALUES (
          ${input.threadId},
          ${input.providerKind},
          ${input.mcpServerName},
          ${input.enabled ? 1 : 0},
          ${input.updatedAt}
        )
        ON CONFLICT (thread_id, provider_kind, mcp_server_name)
        DO UPDATE SET
          enabled = excluded.enabled,
          updated_at = excluded.updated_at
      `,
  });

  const listRowsByThreadId = SqlSchema.findAll({
    Request: ListThreadMcpTogglesByThreadIdInput,
    Result: ThreadMcpToggleDbRow,
    execute: ({ threadId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          provider_kind AS "providerKind",
          mcp_server_name AS "mcpServerName",
          enabled AS "enabled",
          updated_at AS "updatedAt"
        FROM thread_mcp_toggles
        WHERE thread_id = ${threadId}
        ORDER BY provider_kind ASC, mcp_server_name ASC
      `,
  });

  const deleteRowsByThreadId = SqlSchema.void({
    Request: DeleteThreadMcpTogglesByThreadIdInput,
    execute: ({ threadId }) =>
      sql`
        DELETE FROM thread_mcp_toggles
        WHERE thread_id = ${threadId}
      `,
  });

  const upsert: ThreadMcpToggleRepositoryShape["upsert"] = (input) =>
    upsertRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ThreadMcpToggleRepository.upsert:query",
          "ThreadMcpToggleRepository.upsert:encodeRequest",
        ),
      ),
    );

  const listByThreadId: ThreadMcpToggleRepositoryShape["listByThreadId"] = (input) =>
    listRowsByThreadId(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ThreadMcpToggleRepository.listByThreadId:query",
          "ThreadMcpToggleRepository.listByThreadId:decodeRows",
        ),
      ),
      Effect.map((rows) => rows.map((row) => toThreadMcpToggleRecord(row))),
    );

  const deleteAllForThread: ThreadMcpToggleRepositoryShape["deleteAllForThread"] = (input) =>
    deleteRowsByThreadId(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ThreadMcpToggleRepository.deleteAllForThread:query",
          "ThreadMcpToggleRepository.deleteAllForThread:encodeRequest",
        ),
      ),
    );

  return {
    upsert,
    listByThreadId,
    deleteAllForThread,
  } satisfies ThreadMcpToggleRepositoryShape;
});

export const ThreadMcpToggleRepositoryLive = Layer.effect(
  ThreadMcpToggleRepository,
  makeThreadMcpToggleRepository,
);
