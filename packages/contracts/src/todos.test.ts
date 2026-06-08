import { assert, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";

import { TodoCategory, TodoItem } from "./todos.ts";
import {
  CreateCategoryMutation,
  CreateItemMutation,
  DeleteCategoryMutation,
  RenameCategoryMutation,
  SetCategoryColorMutation,
  SetCategoryJiraLinkMutation,
  SetJiraBaseUrlMutation,
  TodoMutation,
  TodosMutateInput,
} from "./rpc.ts";

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

it.effect("parses a valid CreateCategoryMutation", () =>
  Effect.gen(function* () {
    const parsed = yield* decode(CreateCategoryMutation, {
      type: "createCategory",
      name: "Backend",
      color: "#3b82f6",
    });
    assert.strictEqual(parsed.type, "createCategory");
    assert.strictEqual(parsed.name, "Backend");
    assert.strictEqual(parsed.color, "#3b82f6");
  }),
);

it.effect("parses a valid RenameCategoryMutation", () =>
  Effect.gen(function* () {
    const parsed = yield* decode(RenameCategoryMutation, {
      type: "renameCategory",
      categoryId: "cat-1",
      name: "API",
    });
    assert.strictEqual(parsed.type, "renameCategory");
    assert.strictEqual(parsed.categoryId, "cat-1");
    assert.strictEqual(parsed.name, "API");
  }),
);

it.effect("parses a valid SetCategoryColorMutation", () =>
  Effect.gen(function* () {
    const parsed = yield* decode(SetCategoryColorMutation, {
      type: "setCategoryColor",
      categoryId: "cat-1",
      color: "#ff0000",
    });
    assert.strictEqual(parsed.type, "setCategoryColor");
    assert.strictEqual(parsed.categoryId, "cat-1");
    assert.strictEqual(parsed.color, "#ff0000");
  }),
);

it.effect("parses a valid SetCategoryJiraLinkMutation", () =>
  Effect.gen(function* () {
    const parsed = yield* decode(SetCategoryJiraLinkMutation, {
      type: "setCategoryJiraLink",
      categoryId: "cat-1",
      jiraLink: "https://jira.example.com/browse/PROJ-1",
    });
    assert.strictEqual(parsed.type, "setCategoryJiraLink");
    assert.strictEqual(parsed.categoryId, "cat-1");
    assert.strictEqual(parsed.jiraLink, "https://jira.example.com/browse/PROJ-1");
  }),
);

it.effect("parses a valid DeleteCategoryMutation", () =>
  Effect.gen(function* () {
    const parsed = yield* decode(DeleteCategoryMutation, {
      type: "deleteCategory",
      categoryId: "cat-1",
    });
    assert.strictEqual(parsed.type, "deleteCategory");
    assert.strictEqual(parsed.categoryId, "cat-1");
  }),
);

it.effect("parses a valid CreateItemMutation", () =>
  Effect.gen(function* () {
    const parsed = yield* decode(CreateItemMutation, {
      type: "createItem",
      categoryId: "cat-1",
      title: "Fix login bug",
    });
    assert.strictEqual(parsed.type, "createItem");
    assert.strictEqual(parsed.categoryId, "cat-1");
    assert.strictEqual(parsed.title, "Fix login bug");
  }),
);

it.effect("parses TodosMutateInput with multiple mutations", () =>
  Effect.gen(function* () {
    const parsed = yield* decode(TodosMutateInput, {
      mutations: [
        { type: "createCategory", name: "Backend", color: "#3b82f6" },
        { type: "renameCategory", categoryId: "cat-1", name: "API" },
      ],
    });
    assert.strictEqual(parsed.mutations.length, 2);
    assert.strictEqual(parsed.mutations[0]!.type, "createCategory");
    assert.strictEqual(parsed.mutations[1]!.type, "renameCategory");
  }),
);

it.effect("discriminates mutation types in TodoMutation union", () =>
  Effect.gen(function* () {
    const parsed = yield* decode(TodoMutation, {
      type: "deleteCategory",
      categoryId: "cat-1",
    });
    assert.strictEqual(parsed.type, "deleteCategory");
  }),
);

it.effect("parses a valid SetJiraBaseUrlMutation", () =>
  Effect.gen(function* () {
    const parsed = yield* decode(SetJiraBaseUrlMutation, {
      type: "setJiraBaseUrl",
      jiraBaseUrl: "https://company.atlassian.net/browse",
    });
    assert.strictEqual(parsed.type, "setJiraBaseUrl");
    assert.strictEqual(parsed.jiraBaseUrl, "https://company.atlassian.net/browse");
  }),
);

it.effect("rejects invalid mutation type", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decode(TodoMutation, {
        type: "invalidType",
        categoryId: "cat-1",
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);
