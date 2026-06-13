import * as FileSystem from "effect/FileSystem";
import * as Effect from "effect/Effect";
import { type TodoCategory, type TodoItem } from "@t3tools/contracts";
import { writeFileStringAtomically } from "./atomicWrite.ts";

export interface TodosData {
  categories: TodoCategory[];
  items: TodoItem[];
  jiraBaseUrl?: string;
}

const todosPath = (todoDir: string) => todoDir + "/todos.json";
const todosArchivePath = (todoDir: string) => todoDir + "/todos-archive.json";

export const readTodos = (todoDir: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    yield* fs.makeDirectory(todoDir, { recursive: true });

    const path = todosPath(todoDir);
    const exists = yield* fs.exists(path);
    if (!exists) {
      return { categories: [], items: [] } as TodosData;
    }

    const raw = yield* fs.readFileString(path);
    // @effect-diagnostics-next-line preferSchemaOverJson:off
    return JSON.parse(raw) as TodosData;
  });

export const writeTodos = (todoDir: string, data: TodosData) => {
  const contents = JSON.stringify(data, null, 2);
  return writeFileStringAtomically({
    filePath: todosPath(todoDir),
    contents,
  });
};

export const appendToArchive = (todoDir: string, items: TodoItem[]) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    yield* fs.makeDirectory(todoDir, { recursive: true });

    const archivePath = todosArchivePath(todoDir);
    const archiveExists = yield* fs.exists(archivePath);
    let existing: TodoItem[] = [];
    if (archiveExists) {
      const raw = yield* fs.readFileString(archivePath);
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      existing = JSON.parse(raw) as TodoItem[];
    }

    const updated = [...existing, ...items];
    // @effect-diagnostics-next-line preferSchemaOverJson:off
    const contents = JSON.stringify(updated, null, 2);
    yield* writeFileStringAtomically({
      filePath: archivePath,
      contents,
    });
  });
