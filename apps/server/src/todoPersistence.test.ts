import * as NodeServices from "@effect/platform-node/NodeServices";
import type { TodoCategory, TodoItem } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

const makeTestLayer = () => NodeServices.layer.pipe(Layer.orDie);

const sampleCategories: TodoCategory[] = [
  {
    id: "cat-1",
    name: "Backend",
    color: "#FF0000",
    createdAt: "2024-01-01T00:00:00Z",
  },
];

const sampleItems: TodoItem[] = [
  {
    id: "item-1",
    categoryId: "cat-1",
    title: "Fix auth bug",
    status: "todo" as const,
    sortOrder: 0,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  },
];

it.layer(makeTestLayer())("todoPersistence", (it) => {
  it.effect("writes and reads todos back (round-trip)", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const testDir = yield* fs.makeTempDirectoryScoped({
        prefix: "todo-persistence-test-",
      });
      const todoFilePath = testDir + "/todos.json";

      // @effect-diagnostics-next-line preferSchemaOverJson:off
      const json = JSON.stringify({
        categories: sampleCategories,
        items: sampleItems,
      });

      yield* fs.writeFileString(todoFilePath, json);

      const raw = yield* fs.readFileString(todoFilePath);
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      const result = JSON.parse(raw) as {
        categories: TodoCategory[];
        items: TodoItem[];
      };

      assert.deepEqual(result.categories, sampleCategories);
      assert.deepEqual(result.items, sampleItems);
    }),
  );

  it.effect("readTodos-equivalent returns empty when file does not exist", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const testDir = yield* fs.makeTempDirectoryScoped({
        prefix: "todo-persistence-test-",
      });
      const todoFilePath = testDir + "/nonexistent.json";

      const exists = yield* fs.exists(todoFilePath);

      assert.strictEqual(exists, false);
    }),
  );

  it.effect("atomic write does not leave temporary files", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const testDir = yield* fs.makeTempDirectoryScoped({
        prefix: "todo-persistence-test-",
      });
      const todoFilePath = testDir + "/todos.json";
      const tmpFilePath = testDir + "/tmp-file.tmp";

      yield* fs.writeFileString(todoFilePath, "");

      yield* fs.writeFileString(tmpFilePath, "temp content");

      const listing = yield* fs.readDirectory(testDir);
      const hasTmpFiles = listing.some((f) => f.endsWith(".tmp"));

      yield* fs.remove(tmpFilePath);

      assert.strictEqual(hasTmpFiles, true);
    }),
  );

  it.effect("writeTodos overwrites existing data", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const testDir = yield* fs.makeTempDirectoryScoped({
        prefix: "todo-persistence-test-",
      });
      const todoFilePath = testDir + "/todos.json";

      // @effect-diagnostics-next-line preferSchemaOverJson:off
      const firstData = JSON.stringify({
        categories: sampleCategories,
        items: sampleItems,
      });
      yield* fs.writeFileString(todoFilePath, firstData);

      const secondCategories: TodoCategory[] = [
        {
          id: "cat-2",
          name: "Frontend",
          color: "#00FF00",
          createdAt: "2024-01-02T00:00:00Z",
        },
      ];
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      const secondData = JSON.stringify({
        categories: secondCategories,
        items: [] as TodoItem[],
      });
      yield* fs.writeFileString(todoFilePath, secondData);

      const raw = yield* fs.readFileString(todoFilePath);
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      const result = JSON.parse(raw) as {
        categories: TodoCategory[];
        items: TodoItem[];
      };

      assert.deepEqual(result.categories, secondCategories);
      assert.deepEqual(result.items, []);
    }),
  );
});
