import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runHcodeMigrations } from "./HcodeMigrations.ts";
import { runMigrations } from "./Migrations.ts";
import * as NodeSqliteClient from "./NodeSqliteClient.ts";

const readColumns = Effect.fn("readColumns")(function* (table: string) {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly name: string }>`PRAGMA table_info(${sql(table)})`;
  return rows.map((row) => row.name);
});

it.effect("keeps upstream and fork journals separate and is idempotent", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations();
    yield* runHcodeMigrations();
    assert.deepEqual(yield* runMigrations(), []);
    assert.deepEqual(yield* runHcodeMigrations(), []);

    const upstream = yield* sql<{ readonly id: number; readonly name: string }>`
        SELECT migration_id AS id, name
        FROM effect_sql_migrations
        WHERE migration_id >= 31
        ORDER BY migration_id
      `;
    const fork = yield* sql<{ readonly id: number; readonly name: string }>`
        SELECT migration_id AS id, name
        FROM hcode_sql_migrations
        ORDER BY migration_id
      `;
    assert.deepEqual(upstream, [
      { id: 31, name: "AuthAuthorizationScopes" },
      { id: 32, name: "AuthPairingProofKeyThumbprint" },
    ]);
    assert.deepEqual(fork, [
      { id: 1, name: "ThreadMcpToggles" },
      { id: 2, name: "ManagerProjectionMetadata" },
      { id: 3, name: "ManagerSeededWorkItems" },
    ]);
  }).pipe(Effect.provide(NodeSqliteClient.layerMemory())),
);

it.effect("reconciles the legacy 31-33 fork journal from schema facts", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({ toMigrationInclusive: 30 });
    yield* sql`
        CREATE TABLE thread_mcp_toggles (
          thread_id TEXT NOT NULL,
          provider_kind TEXT NOT NULL,
          mcp_server_name TEXT NOT NULL,
          enabled INTEGER NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (thread_id, provider_kind, mcp_server_name)
        )
      `;
    yield* sql`ALTER TABLE projection_projects ADD COLUMN manager_metadata_json TEXT`;
    yield* sql`ALTER TABLE projection_threads ADD COLUMN manager_metadata_json TEXT`;
    yield* sql`
        ALTER TABLE projection_threads
        ADD COLUMN seeded_work_items_json TEXT NOT NULL DEFAULT '[]'
      `;
    yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES
          (31, 'ThreadMcpToggles'),
          (32, 'ManagerProjectionMetadata'),
          (33, 'ManagerSeededWorkItems')
      `;

    yield* runMigrations();
    yield* runHcodeMigrations();

    const upstream = yield* sql<{ readonly id: number; readonly name: string }>`
        SELECT migration_id AS id, name
        FROM effect_sql_migrations
        WHERE migration_id >= 31
        ORDER BY migration_id
      `;
    assert.deepEqual(upstream, [
      { id: 31, name: "AuthAuthorizationScopes" },
      { id: 32, name: "AuthPairingProofKeyThumbprint" },
    ]);
    assert.include(yield* readColumns("auth_pairing_links"), "proof_key_thumbprint");
    assert.include(yield* readColumns("projection_threads"), "seeded_work_items_json");
  }).pipe(Effect.provide(NodeSqliteClient.layerMemory())),
);

it.effect("reconciles the legacy 31-35 journal when fork and auth schema already exist", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations();
    yield* sql`
        CREATE TABLE thread_mcp_toggles (
          thread_id TEXT NOT NULL,
          provider_kind TEXT NOT NULL,
          mcp_server_name TEXT NOT NULL,
          enabled INTEGER NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (thread_id, provider_kind, mcp_server_name)
        )
      `;
    yield* sql`ALTER TABLE projection_projects ADD COLUMN manager_metadata_json TEXT`;
    yield* sql`ALTER TABLE projection_threads ADD COLUMN manager_metadata_json TEXT`;
    yield* sql`
        ALTER TABLE projection_threads
        ADD COLUMN seeded_work_items_json TEXT NOT NULL DEFAULT '[]'
      `;
    yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id BETWEEN 31 AND 32`;
    yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES
          (31, 'ThreadMcpToggles'),
          (32, 'ManagerProjectionMetadata'),
          (33, 'ManagerSeededWorkItems'),
          (34, 'AuthAuthorizationScopes'),
          (35, 'AuthPairingProofKeyThumbprint')
      `;

    yield* runMigrations();
    yield* runHcodeMigrations();

    const upstream = yield* sql<{ readonly id: number; readonly name: string }>`
        SELECT migration_id AS id, name
        FROM effect_sql_migrations
        WHERE migration_id >= 31
        ORDER BY migration_id
      `;
    const fork = yield* sql<{ readonly id: number; readonly name: string }>`
        SELECT migration_id AS id, name
        FROM hcode_sql_migrations
        ORDER BY migration_id
      `;
    assert.deepEqual(upstream, [
      { id: 31, name: "AuthAuthorizationScopes" },
      { id: 32, name: "AuthPairingProofKeyThumbprint" },
    ]);
    assert.deepEqual(fork, [
      { id: 1, name: "ThreadMcpToggles" },
      { id: 2, name: "ManagerProjectionMetadata" },
      { id: 3, name: "ManagerSeededWorkItems" },
    ]);
  }).pipe(Effect.provide(NodeSqliteClient.layerMemory())),
);

it.effect("fails with an actionable diagnostic when a journaled fork schema is missing", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({ toMigrationInclusive: 30 });
    yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES
          (31, 'ThreadMcpToggles'),
          (32, 'ManagerProjectionMetadata'),
          (33, 'ManagerSeededWorkItems')
      `;

    const error = yield* Effect.flip(runMigrations());
    assert.include(error.message, "ThreadMcpToggles is journaled");
    assert.include(error.message, "Restore the pre-upgrade state-directory backup");
  }).pipe(Effect.provide(NodeSqliteClient.layerMemory())),
);
