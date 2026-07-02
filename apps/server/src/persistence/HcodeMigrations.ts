import * as Effect from "effect/Effect";
import * as Migrator from "effect/unstable/sql/Migrator";

import Migration0001 from "./HcodeMigrations/001_ThreadMcpToggles.ts";
import Migration0002 from "./HcodeMigrations/002_ManagerProjectionMetadata.ts";
import Migration0003 from "./HcodeMigrations/003_ManagerSeededWorkItems.ts";

export const hcodeMigrationEntries = [
  [1, "ThreadMcpToggles", Migration0001],
  [2, "ManagerProjectionMetadata", Migration0002],
  [3, "ManagerSeededWorkItems", Migration0003],
] as const;

export const makeHcodeMigrationLoader = () =>
  Migrator.fromRecord(
    Object.fromEntries(
      hcodeMigrationEntries.map(([id, name, migration]) => [`${id}_${name}`, migration]),
    ),
  );

const run = Migrator.make({});

export const runHcodeMigrations = Effect.fn("runHcodeMigrations")(function* () {
  const executedMigrations = yield* run({
    loader: makeHcodeMigrationLoader(),
    table: "hcode_sql_migrations",
  });
  yield* Effect.log("h-code migrations ran successfully").pipe(
    Effect.annotateLogs({ migrations: executedMigrations.map(([id, name]) => `${id}_${name}`) }),
  );
  return executedMigrations;
});
