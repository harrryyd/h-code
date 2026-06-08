import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const TodoItemStatus = Schema.Literals(["todo", "in_progress", "done"]);
export type TodoItemStatus = typeof TodoItemStatus.Type;

export const TodoItemPriority = Schema.Literals(["low", "medium", "high"]);
export type TodoItemPriority = typeof TodoItemPriority.Type;

export const TodoCategory = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  color: TrimmedNonEmptyString,
  jiraLink: Schema.optional(Schema.String),
  collapsed: Schema.optional(Schema.Boolean),
  showWhenEmpty: Schema.optional(Schema.Boolean),
  createdAt: Schema.String,
});
export type TodoCategory = typeof TodoCategory.Type;

export const TodoItem = Schema.Struct({
  id: TrimmedNonEmptyString,
  categoryId: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  description: Schema.optional(Schema.String),
  status: TodoItemStatus,
  priority: Schema.optional(TodoItemPriority),
  jiraLink: Schema.optional(Schema.String),
  sortOrder: Schema.Number,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  completedAt: Schema.optional(Schema.String),
});
export type TodoItem = typeof TodoItem.Type;
