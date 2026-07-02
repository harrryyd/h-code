import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const addColumnIfMissing = Effect.fn("addColumnIfMissing")(function* (
  table: "projection_projects" | "projection_threads",
) {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(${sql(table)})
  `;
  if (!columns.some((column) => column.name === "manager_metadata_json")) {
    yield* sql`
      ALTER TABLE ${sql(table)}
      ADD COLUMN manager_metadata_json TEXT
    `;
  }
});

export default Effect.gen(function* () {
  yield* addColumnIfMissing("projection_projects");
  yield* addColumnIfMissing("projection_threads");
});
