import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS thread_mcp_toggles (
      thread_id TEXT NOT NULL,
      provider_kind TEXT NOT NULL,
      mcp_server_name TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (thread_id, provider_kind, mcp_server_name)
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_thread_mcp_toggles_thread
    ON thread_mcp_toggles(thread_id)
  `;
});
