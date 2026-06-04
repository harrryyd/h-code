import * as FileSystem from "effect/FileSystem";
import * as Effect from "effect/Effect";
import * as Os from "node:os";
import type { TodoCategory, TodoItem } from "@t3tools/contracts";
import { writeFileStringAtomically } from "./atomicWrite.ts";

export const T3CODE_DIR = Os.homedir() + "/.t3code";
export const TODOS_PATH = T3CODE_DIR + "/todos.json";
export const TODOS_ARCHIVE_PATH = T3CODE_DIR + "/todos-archive.json";

export interface TodosData {
  categories: TodoCategory[];
  items: TodoItem[];
}

export const readTodos = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  yield* fs.makeDirectory(T3CODE_DIR, { recursive: true });

  const exists = yield* fs.exists(TODOS_PATH);
  if (!exists) {
    return { categories: [], items: [] } as TodosData;
  }

  const raw = yield* fs.readFileString(TODOS_PATH);
  // @effect-diagnostics-next-line preferSchemaOverJson:off
  return JSON.parse(raw) as TodosData;
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
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      existing = JSON.parse(raw) as TodoItem[];
    }

    const updated = [...existing, ...items];
    // @effect-diagnostics-next-line preferSchemaOverJson:off
    const contents = JSON.stringify(updated, null, 2);
    yield* writeFileStringAtomically({
      filePath: TODOS_ARCHIVE_PATH,
      contents,
    });
  });
