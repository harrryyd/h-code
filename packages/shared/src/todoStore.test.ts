import { describe, expect, it } from "vitest";
import type { TodoCategory, TodoItem } from "@t3tools/contracts";

import { loadTodos, reorderCategories, toggleCategory } from "./todoStore.ts";

const sampleCategories: TodoCategory[] = [
  {
    id: "cat-1",
    name: "Backend",
    color: "#FF0000",
    createdAt: "2024-01-01T00:00:00Z",
  },
  {
    id: "cat-2",
    name: "Frontend",
    color: "#00FF00",
    createdAt: "2024-01-02T00:00:00Z",
  },
  {
    id: "cat-3",
    name: "DevOps",
    color: "#0000FF",
    createdAt: "2024-01-03T00:00:00Z",
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
  {
    id: "item-2",
    categoryId: "cat-2",
    title: "Redesign header",
    status: "in_progress" as const,
    sortOrder: 1,
    createdAt: "2024-01-02T00:00:00Z",
    updatedAt: "2024-01-02T00:00:00Z",
  },
];

describe("todoStore", () => {
  describe("loadTodos", () => {
    it("returns state with provided categories and items", () => {
      const state = loadTodos(sampleCategories, sampleItems);

      expect(state.categories).toEqual(sampleCategories);
      expect(state.items).toEqual(sampleItems);
    });

    it("returns empty arrays when given empty input", () => {
      const state = loadTodos([], []);

      expect(state.categories).toEqual([]);
      expect(state.items).toEqual([]);
    });
  });

  describe("toggleCategory", () => {
    it("sets collapsed to true when it was undefined", () => {
      const state = loadTodos(sampleCategories, sampleItems);
      const next = toggleCategory(state, "cat-1");

      expect(next.categories[0]!.collapsed).toBe(true);
      expect(next.categories[1]!.collapsed).toBeUndefined();
    });

    it("toggles collapsed from true to false", () => {
      const state = loadTodos(
        [{ ...sampleCategories[0]!, collapsed: true }, sampleCategories[1]!, sampleCategories[2]!],
        sampleItems,
      );
      const next = toggleCategory(state, "cat-1");

      expect(next.categories[0]!.collapsed).toBe(false);
    });

    it("toggles collapsed from false to true", () => {
      const state = loadTodos(
        [{ ...sampleCategories[0]!, collapsed: false }, sampleCategories[1]!, sampleCategories[2]!],
        sampleItems,
      );
      const next = toggleCategory(state, "cat-1");

      expect(next.categories[0]!.collapsed).toBe(true);
    });

    it("does not mutate the original state", () => {
      const state = loadTodos(sampleCategories, sampleItems);
      const next = toggleCategory(state, "cat-1");

      expect(next).not.toBe(state);
      expect(next.categories).not.toBe(state.categories);
      expect(state.categories[0]!.collapsed).toBeUndefined();
    });

    it("leaves other categories unchanged when toggling one", () => {
      const state = loadTodos(sampleCategories, sampleItems);
      const next = toggleCategory(state, "cat-1");

      expect(next.categories[1]).toBe(state.categories[1]);
      expect(next.categories[2]).toBe(state.categories[2]);
    });
  });

  describe("reorderCategories", () => {
    it("reorders categories according to ordered ID list", () => {
      const state = loadTodos(sampleCategories, sampleItems);
      const next = reorderCategories(state, ["cat-3", "cat-1", "cat-2"]);

      expect(next.categories[0]!.id).toBe("cat-3");
      expect(next.categories[1]!.id).toBe("cat-1");
      expect(next.categories[2]!.id).toBe("cat-2");
    });

    it("places unknown IDs at the end", () => {
      const state = loadTodos(sampleCategories, sampleItems);
      const next = reorderCategories(state, ["cat-2"]);

      expect(next.categories[0]!.id).toBe("cat-2");
      expect(next.categories[1]!.id).toBe("cat-1");
      expect(next.categories[2]!.id).toBe("cat-3");
    });

    it("does not mutate the original state", () => {
      const state = loadTodos(sampleCategories, sampleItems);
      const next = reorderCategories(state, ["cat-3", "cat-2", "cat-1"]);

      expect(next).not.toBe(state);
      expect(next.categories).not.toBe(state.categories);
      expect(state.categories[0]!.id).toBe("cat-1");
    });
  });
});
