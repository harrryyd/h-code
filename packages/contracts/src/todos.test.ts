import { assert, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";

import { TodoCategory, TodoItem } from "./todos.ts";

const decode = <S extends Schema.Top>(
  schema: S,
  input: unknown,
): Effect.Effect<Schema.Schema.Type<S>, Schema.SchemaError, never> =>
  Schema.decodeUnknownEffect(schema as never)(input) as Effect.Effect<
    Schema.Schema.Type<S>,
    Schema.SchemaError,
    never
  >;

it.effect("parses a valid TodoCategory", () =>
  Effect.gen(function* () {
    const parsed = yield* decode(TodoCategory, {
      id: "cat-1",
      name: "Backlog",
      color: "#3b82f6",
      createdAt: "2024-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.id, "cat-1");
    assert.strictEqual(parsed.name, "Backlog");
    assert.strictEqual(parsed.color, "#3b82f6");
    assert.strictEqual(parsed.collapsed, undefined);
    assert.strictEqual(parsed.showWhenEmpty, undefined);
  }),
);

it.effect("parses a TodoCategory with optional fields", () =>
  Effect.gen(function* () {
    const parsed = yield* decode(TodoCategory, {
      id: "cat-2",
      name: "In Progress",
      color: "#10b981",
      jiraLink: "https://jira.example.com/browse/PROJ-1",
      collapsed: true,
      showWhenEmpty: false,
      createdAt: "2024-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.collapsed, true);
    assert.strictEqual(parsed.showWhenEmpty, false);
    assert.strictEqual(parsed.jiraLink, "https://jira.example.com/browse/PROJ-1");
  }),
);

it.effect("rejects a TodoCategory with empty name", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decode(TodoCategory, {
        id: "cat-3",
        name: "",
        color: "#ef4444",
        createdAt: "2024-01-01T00:00:00.000Z",
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("parses a valid TodoItem", () =>
  Effect.gen(function* () {
    const parsed = yield* decode(TodoItem, {
      id: "todo-1",
      categoryId: "cat-1",
      title: "Fix login bug",
      status: "todo",
      sortOrder: 0,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-02T00:00:00.000Z",
    });
    assert.strictEqual(parsed.id, "todo-1");
    assert.strictEqual(parsed.title, "Fix login bug");
    assert.strictEqual(parsed.status, "todo");
    assert.strictEqual(parsed.sortOrder, 0);
  }),
);

it.effect("parses a TodoItem with optional fields", () =>
  Effect.gen(function* () {
    const parsed = yield* decode(TodoItem, {
      id: "todo-2",
      categoryId: "cat-1",
      title: "Add analytics",
      description: "Track page views and user events",
      status: "in_progress",
      jiraLink: "https://jira.example.com/browse/PROJ-2",
      sortOrder: 1,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-03T00:00:00.000Z",
    });
    assert.strictEqual(parsed.status, "in_progress");
    assert.strictEqual(parsed.description, "Track page views and user events");
    assert.strictEqual(parsed.jiraLink, "https://jira.example.com/browse/PROJ-2");
  }),
);

it.effect("rejects a TodoItem with invalid status", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decode(TodoItem, {
        id: "todo-3",
        categoryId: "cat-1",
        title: "Bad item",
        status: "invalid",
        sortOrder: 0,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("rejects a TodoItem with empty title", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decode(TodoItem, {
        id: "todo-4",
        categoryId: "cat-1",
        title: "",
        status: "todo",
        sortOrder: 0,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);
