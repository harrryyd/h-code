import type { TodoCategory, TodoItem } from "@t3tools/contracts";

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
