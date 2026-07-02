import * as Effect from "effect/Effect";
import * as Migrator from "effect/unstable/sql/Migrator";
import * as SqlClient from "effect/unstable/sql/SqlClient";

type JournalRow = {
  readonly migrationId: number;
  readonly name: string;
};

const LEGACY_FORK_NAMES: ReadonlyMap<number, string> = new Map([
  [31, "ThreadMcpToggles"],
  [32, "ManagerProjectionMetadata"],
  [33, "ManagerSeededWorkItems"],
] as const);

const LEGACY_AUTH_NAMES: ReadonlyMap<number, string> = new Map([
  [34, "AuthAuthorizationScopes"],
  [35, "AuthPairingProofKeyThumbprint"],
] as const);

const columnNames = Effect.fn("columnNames")(function* (table: string) {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly name: string }>`PRAGMA table_info(${sql(table)})`;
  return new Set(rows.map((row) => row.name));
});

const failBadState = (message: string) =>
  new Migrator.MigrationError({
    kind: "BadState",
    message: `Cannot reconcile legacy h-code migrations: ${message}. Restore the pre-upgrade state-directory backup before retrying.`,
  });

/**
 * v0.0.27 h-code used upstream migration ids 31-35 for fork migrations.
 * Re-map only the exact known legacy journal and only after verifying schema facts.
 */
export const reconcileLegacyHcodeMigrationJournal = Effect.fn(
  "reconcileLegacyHcodeMigrationJournal",
)(function* () {
  const sql = yield* SqlClient.SqlClient;
  const journalExists = yield* sql<{ readonly count: number }>`
    SELECT COUNT(*) AS count
    FROM sqlite_master
    WHERE type = 'table' AND name = 'effect_sql_migrations'
  `;
  if ((journalExists[0]?.count ?? 0) === 0) return false;

  const rows = yield* sql<JournalRow>`
    SELECT migration_id AS "migrationId", name
    FROM effect_sql_migrations
    WHERE migration_id BETWEEN 31 AND 35
    ORDER BY migration_id
  `;
  const byId = new Map(rows.map((row) => [row.migrationId, row.name]));
  const hasLegacyForkJournal = [...LEGACY_FORK_NAMES].every(([id, name]) => byId.get(id) === name);
  if (!hasLegacyForkJournal) return false;

  for (const [id, name] of byId) {
    const expectedName = LEGACY_FORK_NAMES.get(id) ?? LEGACY_AUTH_NAMES.get(id);
    if (expectedName !== name) {
      return yield* failBadState(
        `journal entry ${id} is "${name}", expected "${expectedName ?? "<no entry>"}"`,
      );
    }
  }

  const [mcpColumns, projectColumns, threadColumns, pairingColumns, sessionColumns] =
    yield* Effect.all([
      columnNames("thread_mcp_toggles"),
      columnNames("projection_projects"),
      columnNames("projection_threads"),
      columnNames("auth_pairing_links"),
      columnNames("auth_sessions"),
    ]);

  const hasMcpSchema = [
    "thread_id",
    "provider_kind",
    "mcp_server_name",
    "enabled",
    "updated_at",
  ].every((column) => mcpColumns.has(column));
  if (!hasMcpSchema) {
    return yield* failBadState("ThreadMcpToggles is journaled but its table is incomplete");
  }
  if (!projectColumns.has("manager_metadata_json") || !threadColumns.has("manager_metadata_json")) {
    return yield* failBadState(
      "ManagerProjectionMetadata is journaled but manager metadata columns are missing",
    );
  }
  if (!threadColumns.has("seeded_work_items_json")) {
    return yield* failBadState(
      "ManagerSeededWorkItems is journaled but seeded_work_items_json is missing",
    );
  }

  const hasScopedAuth =
    pairingColumns.has("scopes") &&
    !pairingColumns.has("role") &&
    sessionColumns.has("scopes") &&
    !sessionColumns.has("role");
  const hasProofKey = pairingColumns.has("proof_key_thumbprint");
  if (byId.has(34) && !hasScopedAuth) {
    return yield* failBadState(
      "AuthAuthorizationScopes is journaled but the scoped auth schema is absent",
    );
  }
  if (byId.has(35) && !hasProofKey) {
    return yield* failBadState(
      "AuthPairingProofKeyThumbprint is journaled but proof_key_thumbprint is absent",
    );
  }
  if (hasProofKey && !hasScopedAuth) {
    return yield* failBadState("proof-key auth schema exists without scoped auth schema");
  }

  yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id BETWEEN 31 AND 35`;
      if (hasScopedAuth) {
        yield* sql`
          INSERT INTO effect_sql_migrations (migration_id, name)
          VALUES (31, 'AuthAuthorizationScopes')
        `;
      }
      if (hasProofKey) {
        yield* sql`
          INSERT INTO effect_sql_migrations (migration_id, name)
          VALUES (32, 'AuthPairingProofKeyThumbprint')
        `;
      }
    }),
  );
  yield* Effect.logWarning("Reconciled legacy h-code migration journal").pipe(
    Effect.annotateLogs({ legacyMigrationIds: rows.map((row) => row.migrationId) }),
  );
  return true;
});
