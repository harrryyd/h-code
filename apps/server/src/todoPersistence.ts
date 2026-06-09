import * as FileSystem from "effect/FileSystem";
import * as Effect from "effect/Effect";
import * as Os from "node:os";
import { type TodoCategory, type TodoItem, TodosLoadError } from "@t3tools/contracts";
import { writeFileStringAtomically } from "./atomicWrite.ts";

export const T3CODE_DIR = Os.homedir() + "/.t3code";
export const TODOS_PATH = T3CODE_DIR + "/todos.json";
export const TODOS_ARCHIVE_PATH = T3CODE_DIR + "/todos-archive.json";

export interface TodosData {
  categories: TodoCategory[];
  items: TodoItem[];
  jiraBaseUrl?: string;
}

const parseTodosJson = (raw: string): Effect.Effect<TodosData, TodosLoadError> =>
  Effect.try({
    // @effect-diagnostics-next-line preferSchemaOverJson:off
    try: () => JSON.parse(raw) as TodosData,
    catch: (cause) =>
      new TodosLoadError({
        kind: "parse-failure",
        detail: `Invalid JSON in todos file: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });

export const readTodos = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  yield* fs.makeDirectory(T3CODE_DIR, { recursive: true });

  const exists = yield* fs.exists(TODOS_PATH);
  if (!exists) {
    return { categories: [], items: [] } as TodosData;
  }

  const raw = yield* fs.readFileString(TODOS_PATH);
  return yield* parseTodosJson(raw);
});

export const writeTodos = (data: TodosData) => {
  const contents = JSON.stringify(data, null, 2);
  return writeFileStringAtomically({
    filePath: TODOS_PATH,
    contents,
  });
};

export const appendToArchive = (items: TodoItem[]) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    yield* fs.makeDirectory(T3CODE_DIR, { recursive: true });

    const archiveExists = yield* fs.exists(TODOS_ARCHIVE_PATH);
    let existing: TodoItem[] = [];
    if (archiveExists) {
      const raw = yield* fs.readFileString(TODOS_ARCHIVE_PATH);
      try {
        // @effect-diagnostics-next-line preferSchemaOverJson:off
        existing = JSON.parse(raw) as TodoItem[];
      } catch {
        existing = [];
      }
    }

    const updated = [...existing, ...items];
    // @effect-diagnostics-next-line preferSchemaOverJson:off
    const contents = JSON.stringify(updated, null, 2);
    yield* writeFileStringAtomically({
      filePath: TODOS_ARCHIVE_PATH,
      contents,
    });
  });
