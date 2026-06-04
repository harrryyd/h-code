import type { TodoCategory, TodoItem, TodoMutation } from "@t3tools/contracts";

export interface TodoState {
  categories: TodoCategory[];
  items: TodoItem[];
}

export function loadTodos(categories: TodoCategory[], items: TodoItem[]): TodoState {
  return { categories, items };
}

export function toggleCategory(state: TodoState, categoryId: string): TodoState {
  return {
    ...state,
    categories: state.categories.map((c) =>
      c.id === categoryId ? { ...c, collapsed: !c.collapsed } : c,
    ),
  };
}

export function reorderCategories(state: TodoState, orderedIds: string[]): TodoState {
  const orderMap = new Map(orderedIds.map((id, i) => [id, i]));
  return {
    ...state,
    categories: state.categories.toSorted(
      (a, b) => (orderMap.get(a.id) ?? 999) - (orderMap.get(b.id) ?? 999),
    ),
  };
}

export function createCategory(state: TodoState): TodoState {
  const category: TodoCategory = {
    id: crypto.randomUUID(),
    name: "New Category",
    color: getRandomColor(),
    // @effect-diagnostics-next-line globalDate:off
    createdAt: new Date().toISOString(),
  };
  return { ...state, categories: [...state.categories, category] };
}

export function renameCategory(state: TodoState, categoryId: string, name: string): TodoState {
  return {
    ...state,
    categories: state.categories.map((c) => (c.id === categoryId ? { ...c, name } : c)),
  };
}

export function setCategoryColor(state: TodoState, categoryId: string, color: string): TodoState {
  return {
    ...state,
    categories: state.categories.map((c) => (c.id === categoryId ? { ...c, color } : c)),
  };
}

export function setCategoryJiraLink(
  state: TodoState,
  categoryId: string,
  jiraLink: string | null,
): TodoState {
  const value = jiraLink || null;
  return {
    ...state,
    categories: state.categories.map((c) =>
      c.id === categoryId ? { ...c, jiraLink: value ?? undefined } : c,
    ),
  };
}

export function deleteCategory(
  state: TodoState,
  categoryId: string,
): { state: TodoState; deleted: boolean } {
  const activeItems = state.items.filter(
    (item) =>
      item.categoryId === categoryId && (item.status === "todo" || item.status === "in_progress"),
  );
  if (activeItems.length > 0) {
    return { state, deleted: false };
  }
  return {
    state: {
      ...state,
      categories: state.categories.filter((c) => c.id !== categoryId),
      items: state.items.filter((item) => item.categoryId !== categoryId),
    },
    deleted: true,
  };
}

export function createItem(state: TodoState, categoryId: string, title: string): TodoState {
  // @effect-diagnostics-next-line globalDate:off
  const now = new Date().toISOString();
  const categoryItems = state.items.filter((item) => item.categoryId === categoryId);
  const maxOrder = categoryItems.reduce((max, item) => Math.max(max, item.sortOrder), -1);

  const item: TodoItem = {
    id: crypto.randomUUID(),
    categoryId,
    title,
    status: "todo",
    sortOrder: maxOrder + 1,
    createdAt: now,
    updatedAt: now,
  };

  return {
    ...state,
    items: [...state.items, item],
  };
}

function getRandomColor(): string {
  const colors = [
    "#3b82f6",
    "#ef4444",
    "#10b981",
    "#f59e0b",
    "#8b5cf6",
    "#ec4899",
    "#06b6d4",
    "#84cc16",
  ];
  // @effect-diagnostics-next-line globalRandom:off
  return colors[Math.floor(Math.random() * colors.length)]!;
}

export function applyMutation(state: TodoState, mutation: TodoMutation): TodoState {
  switch (mutation.type) {
    case "createCategory":
      return createCategory(state);
    case "renameCategory":
      return renameCategory(state, mutation.categoryId, mutation.name);
    case "setCategoryColor":
      return setCategoryColor(state, mutation.categoryId, mutation.color);
    case "setCategoryJiraLink":
      return setCategoryJiraLink(state, mutation.categoryId, mutation.jiraLink);
    case "deleteCategory":
      return deleteCategory(state, mutation.categoryId).state;
    case "createItem":
      return createItem(state, mutation.categoryId, mutation.title);
    case "cycleItemStatus":
      return cycleItemStatus(state, mutation.itemId);
    default:
      return state;
  }
}

export function cycleItemStatus(state: TodoState, itemId: string): TodoState {
  const item = state.items.find((i) => i.id === itemId);
  if (!item) return state;

  // @effect-diagnostics-next-line globalDate:off
  const now = new Date().toISOString();
  const nextStatus: TodoItem["status"] =
    item.status === "todo" ? "in_progress" : item.status === "in_progress" ? "done" : "todo";

  const updatedItem: TodoItem = {
    ...item,
    status: nextStatus,
    updatedAt: now,
    ...(nextStatus === "done" ? { completedAt: now } : {}),
    ...(nextStatus === "todo" && item.status === "done" ? { completedAt: undefined } : {}),
  };

  return { ...state, items: state.items.map((i) => (i.id === itemId ? updatedItem : i)) };
}

export function archiveDoneItems(
  state: TodoState,
  maxDoneItems = 10,
): { state: TodoState; archived: TodoItem[] } {
  const doneItems = state.items
    .filter((i) => i.status === "done")
    .toSorted((a, b) => (a.completedAt ?? a.createdAt).localeCompare(b.completedAt ?? b.createdAt));

  if (doneItems.length <= maxDoneItems) {
    return { state, archived: [] };
  }

  const toArchive = doneItems.slice(0, doneItems.length - maxDoneItems);
  const archiveIds = new Set(toArchive.map((i) => i.id));

  return {
    state: {
      ...state,
      items: state.items.filter((i) => !archiveIds.has(i.id)),
    },
    archived: toArchive,
  };
}

export function applyMutations(state: TodoState, mutations: readonly TodoMutation[]): TodoState {
  return mutations.reduce(applyMutation, state);
}
