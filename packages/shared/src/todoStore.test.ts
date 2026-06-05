import { describe, expect, it } from "vitest";
import type { TodoCategory, TodoItem } from "@t3tools/contracts";

import {
  applyMutation,
  applyMutations,
  archiveDoneItems,
  createCategory,
  createItem,
  cycleItemStatus,
  deleteCategory,
  loadTodos,
  renameCategory,
  reorderCategories,
  reorderItems,
  setCategoryColor,
  setCategoryJiraLink,
  toggleCategory,
  updateDescription,
} from "./todoStore.ts";

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

function makeDoneItem(id: string, completedAt: string): TodoItem {
  return {
    id,
    categoryId: "cat-1",
    title: `Done ${id}`,
    status: "done",
    sortOrder: 0,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: completedAt,
    completedAt,
  };
}

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

  describe("reorderItems", () => {
    it("updates sortOrder for items within the same category", () => {
      const state = loadTodos(sampleCategories, sampleItems);
      const next = reorderItems(state, [{ id: "item-1", categoryId: "cat-1", sortOrder: 5 }]);

      expect(next.items[0]!.sortOrder).toBe(5);
      expect(next.items[0]!.categoryId).toBe("cat-1");
      expect(next.items[0]!.updatedAt).not.toBe(sampleItems[0]!.updatedAt);
    });

    it("recategorizes an item by changing its categoryId", () => {
      const state = loadTodos(sampleCategories, sampleItems);
      const next = reorderItems(state, [{ id: "item-1", categoryId: "cat-2", sortOrder: 10 }]);

      expect(next.items[0]!.categoryId).toBe("cat-2");
      expect(next.items[0]!.sortOrder).toBe(10);
    });

    it("reorders and recategorizes multiple items at once", () => {
      const state = loadTodos(sampleCategories, sampleItems);
      const next = reorderItems(state, [
        { id: "item-1", categoryId: "cat-2", sortOrder: 0 },
        { id: "item-2", categoryId: "cat-1", sortOrder: 0 },
      ]);

      expect(next.items[0]!.categoryId).toBe("cat-2");
      expect(next.items[0]!.sortOrder).toBe(0);
      expect(next.items[1]!.categoryId).toBe("cat-1");
      expect(next.items[1]!.sortOrder).toBe(0);
    });

    it("does not mutate the original state", () => {
      const state = loadTodos(sampleCategories, sampleItems);
      const next = reorderItems(state, [{ id: "item-1", categoryId: "cat-2", sortOrder: 0 }]);

      expect(next).not.toBe(state);
      expect(next.items).not.toBe(state.items);
      expect(state.items[0]!.categoryId).toBe("cat-1");
      expect(state.items[0]!.sortOrder).toBe(0);
    });

    it("leaves unmatched items unchanged", () => {
      const state = loadTodos(sampleCategories, sampleItems);
      const next = reorderItems(state, [{ id: "nonexistent", categoryId: "cat-2", sortOrder: 99 }]);

      expect(next.items[0]!.sortOrder).toBe(0);
      expect(next.items[0]!.categoryId).toBe("cat-1");
      expect(next.items[1]!.sortOrder).toBe(1);
      expect(next.items[1]!.categoryId).toBe("cat-2");
    });

    it("updates updatedAt on all changed items", () => {
      const state = loadTodos(sampleCategories, sampleItems);
      const next = reorderItems(state, [
        { id: "item-1", categoryId: "cat-1", sortOrder: 3 },
        { id: "item-2", categoryId: "cat-2", sortOrder: 7 },
      ]);

      expect(next.items[0]!.updatedAt).not.toBe(sampleItems[0]!.updatedAt);
      expect(next.items[1]!.updatedAt).not.toBe(sampleItems[1]!.updatedAt);
    });
  });

  describe("createCategory", () => {
    it("adds a new category with default name", () => {
      const state = loadTodos([], []);
      const next = createCategory(state);

      expect(next.categories).toHaveLength(1);
      expect(next.categories[0]!.name).toBe("New Category");
    });

    it("assigns a unique id", () => {
      const state = loadTodos([], []);
      const next = createCategory(state);

      expect(next.categories[0]!.id).toBeTypeOf("string");
      expect(next.categories[0]!.id.length).toBeGreaterThan(0);
    });

    it("assigns a color from the palette", () => {
      const palette = [
        "#3b82f6",
        "#ef4444",
        "#10b981",
        "#f59e0b",
        "#8b5cf6",
        "#ec4899",
        "#06b6d4",
        "#84cc16",
      ];
      const state = loadTodos([], []);
      const next = createCategory(state);

      expect(palette).toContain(next.categories[0]!.color);
    });

    it("does not mutate the original state", () => {
      const state = loadTodos(sampleCategories, sampleItems);
      const next = createCategory(state);

      expect(next).not.toBe(state);
      expect(next.categories).not.toBe(state.categories);
      expect(state.categories).toHaveLength(3);
    });

    it("appends category to existing list", () => {
      const state = loadTodos(sampleCategories, sampleItems);
      const next = createCategory(state);

      expect(next.categories).toHaveLength(4);
      expect(next.categories[0]!.id).toBe("cat-1");
      expect(next.categories[1]!.id).toBe("cat-2");
      expect(next.categories[2]!.id).toBe("cat-3");
    });
  });

  describe("renameCategory", () => {
    it("changes category name", () => {
      const state = loadTodos(sampleCategories, sampleItems);
      const next = renameCategory(state, "cat-1", "API");

      expect(next.categories[0]!.name).toBe("API");
    });

    it("does not affect other categories", () => {
      const state = loadTodos(sampleCategories, sampleItems);
      const next = renameCategory(state, "cat-1", "API");

      expect(next.categories[1]!.name).toBe("Frontend");
      expect(next.categories[2]!.name).toBe("DevOps");
    });

    it("does not mutate the original state", () => {
      const state = loadTodos(sampleCategories, sampleItems);
      const next = renameCategory(state, "cat-1", "API");

      expect(next).not.toBe(state);
      expect(next.categories).not.toBe(state.categories);
      expect(state.categories[0]!.name).toBe("Backend");
    });

    it("returns unchanged state for unknown category ID", () => {
      const state = loadTodos(sampleCategories, sampleItems);
      const next = renameCategory(state, "nonexistent", "Test");

      expect(next.categories).toEqual(state.categories);
    });
  });

  describe("setCategoryColor", () => {
    it("changes category color", () => {
      const state = loadTodos(sampleCategories, sampleItems);
      const next = setCategoryColor(state, "cat-1", "#123456");

      expect(next.categories[0]!.color).toBe("#123456");
    });

    it("does not affect other categories", () => {
      const state = loadTodos(sampleCategories, sampleItems);
      const next = setCategoryColor(state, "cat-1", "#123456");

      expect(next.categories[1]!.color).toBe("#00FF00");
    });

    it("does not mutate the original state", () => {
      const state = loadTodos(sampleCategories, sampleItems);
      const next = setCategoryColor(state, "cat-1", "#123456");

      expect(next).not.toBe(state);
      expect(state.categories[0]!.color).toBe("#FF0000");
    });
  });

  describe("setCategoryJiraLink", () => {
    it("sets a JIRA link on a category", () => {
      const state = loadTodos(sampleCategories, sampleItems);
      const next = setCategoryJiraLink(state, "cat-1", "https://jira.example.com/browse/PROJ-1");

      expect(next.categories[0]!.jiraLink).toBe("https://jira.example.com/browse/PROJ-1");
    });

    it("clears a JIRA link when given null", () => {
      const state = loadTodos(
        [
          { ...sampleCategories[0]!, jiraLink: "https://jira.example.com/browse/PROJ-1" },
          sampleCategories[1]!,
          sampleCategories[2]!,
        ],
        sampleItems,
      );
      const next = setCategoryJiraLink(state, "cat-1", null);

      expect(next.categories[0]!.jiraLink).toBeUndefined();
    });

    it("does not mutate the original state", () => {
      const state = loadTodos(sampleCategories, sampleItems);
      const next = setCategoryJiraLink(state, "cat-1", "https://jira.example.com/browse/PROJ-1");

      expect(next).not.toBe(state);
      expect(state.categories[0]!.jiraLink).toBeUndefined();
    });
  });

  describe("deleteCategory", () => {
    it("deletes an empty category and its items", () => {
      const items: TodoItem[] = [
        {
          id: "item-1",
          categoryId: "cat-3",
          title: "Done item",
          status: "done",
          sortOrder: 0,
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
        },
      ];
      const state = loadTodos(sampleCategories, items);
      const result = deleteCategory(state, "cat-3");

      expect(result.deleted).toBe(true);
      expect(result.state.categories).toHaveLength(2);
      expect(result.state.categories.find((c) => c.id === "cat-3")).toBeUndefined();
      expect(result.state.items).toHaveLength(0);
    });

    it("blocks deletion when category has active (todo) items", () => {
      const state = loadTodos(sampleCategories, sampleItems);
      const result = deleteCategory(state, "cat-1");

      expect(result.deleted).toBe(false);
      expect(result.state).toBe(state);
    });

    it("blocks deletion when category has active (in_progress) items", () => {
      const state = loadTodos(sampleCategories, sampleItems);
      const result = deleteCategory(state, "cat-2");

      expect(result.deleted).toBe(false);
      expect(result.state).toBe(state);
    });

    it("allows deletion when category only has done items", () => {
      const items: TodoItem[] = [
        {
          id: "item-1",
          categoryId: "cat-3",
          title: "Done item",
          status: "done",
          sortOrder: 0,
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
        },
      ];
      const state = loadTodos(sampleCategories, items);
      const result = deleteCategory(state, "cat-3");

      expect(result.deleted).toBe(true);
      expect(result.state.categories).toHaveLength(2);
    });
  });

  describe("applyMutation", () => {
    it("applies createCategory mutation", () => {
      const state = loadTodos([], []);
      const next = applyMutation(state, { type: "createCategory", name: "Test", color: "#123" });

      expect(next.categories).toHaveLength(1);
      expect(next.categories[0]!.name).toBe("New Category");
    });

    it("applies renameCategory mutation", () => {
      const state = loadTodos(sampleCategories, sampleItems);
      const next = applyMutation(state, {
        type: "renameCategory",
        categoryId: "cat-1",
        name: "API",
      });

      expect(next.categories[0]!.name).toBe("API");
    });

    it("applies setCategoryColor mutation", () => {
      const state = loadTodos(sampleCategories, sampleItems);
      const next = applyMutation(state, {
        type: "setCategoryColor",
        categoryId: "cat-1",
        color: "#abc",
      });

      expect(next.categories[0]!.color).toBe("#abc");
    });

    it("applies setCategoryJiraLink mutation", () => {
      const state = loadTodos(sampleCategories, sampleItems);
      const next = applyMutation(state, {
        type: "setCategoryJiraLink",
        categoryId: "cat-1",
        jiraLink: "https://jira.example.com/browse/PROJ-1",
      });

      expect(next.categories[0]!.jiraLink).toBe("https://jira.example.com/browse/PROJ-1");
    });

    it("applies deleteCategory mutation (success)", () => {
      const items: TodoItem[] = [
        {
          id: "item-1",
          categoryId: "cat-3",
          title: "Done item",
          status: "done",
          sortOrder: 0,
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
        },
      ];
      const state = loadTodos(sampleCategories, items);
      const next = applyMutation(state, { type: "deleteCategory", categoryId: "cat-3" });

      expect(next.categories).toHaveLength(2);
    });

    it("applies deleteCategory mutation (blocked)", () => {
      const state = loadTodos(sampleCategories, sampleItems);
      const next = applyMutation(state, { type: "deleteCategory", categoryId: "cat-1" });

      expect(next.categories).toHaveLength(3);
    });

    it("applies createItem mutation", () => {
      const state = loadTodos(sampleCategories, sampleItems);
      const next = applyMutation(state, {
        type: "createItem",
        categoryId: "cat-1",
        title: "New task",
      });

      expect(next.items).toHaveLength(3);
      expect(next.items[2]!.title).toBe("New task");
      expect(next.items[2]!.status).toBe("todo");
      expect(next.items[2]!.categoryId).toBe("cat-1");
    });
  });

  describe("applyMutations", () => {
    it("applies multiple mutations in sequence", () => {
      const state = loadTodos([], []);
      const next = applyMutations(state, [
        { type: "createCategory", name: "A", color: "#111" },
        { type: "createCategory", name: "B", color: "#222" },
      ]);

      expect(next.categories).toHaveLength(2);
      expect(next.categories[0]!.name).toBe("New Category");
      expect(next.categories[1]!.name).toBe("New Category");
    });

    it("chains mutation results", () => {
      const state = loadTodos([], []);
      const withCat = applyMutations(state, [
        { type: "createCategory", name: "Temp", color: "#111" },
      ]);
      const catId = withCat.categories[0]!.id;
      const next = applyMutations(withCat, [
        { type: "renameCategory", categoryId: catId, name: "Renamed" },
        { type: "setCategoryColor", categoryId: catId, color: "#333" },
      ]);

      expect(next.categories[0]!.name).toBe("Renamed");
      expect(next.categories[0]!.color).toBe("#333");
    });
  });

  describe("cycleItemStatus", () => {
    const item: TodoItem = {
      id: "item-1",
      categoryId: "cat-1",
      title: "Test item",
      status: "todo",
      sortOrder: 0,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };

    it("transitions todo -> in_progress", () => {
      const state = loadTodos(sampleCategories, [item]);
      const next = cycleItemStatus(state, "item-1");

      expect(next.items[0]!.status).toBe("in_progress");
      expect(next.items[0]!.updatedAt).not.toBe(item.updatedAt);
      expect(next.items[0]!.completedAt).toBeUndefined();
    });

    it("transitions in_progress -> done", () => {
      const inProgress: TodoItem = { ...item, status: "in_progress" };
      const state = loadTodos(sampleCategories, [inProgress]);
      const next = cycleItemStatus(state, "item-1");

      expect(next.items[0]!.status).toBe("done");
      expect(next.items[0]!.completedAt).toBeTypeOf("string");
      expect(next.items[0]!.completedAt!.length).toBeGreaterThan(0);
    });

    it("transitions done -> todo", () => {
      const doneItem: TodoItem = { ...item, status: "done", completedAt: "2024-06-01T00:00:00Z" };
      const state = loadTodos(sampleCategories, [doneItem]);
      const next = cycleItemStatus(state, "item-1");

      expect(next.items[0]!.status).toBe("todo");
      expect(next.items[0]!.completedAt).toBeUndefined();
    });

    it("returns state unchanged for unknown item ID", () => {
      const state = loadTodos(sampleCategories, [item]);
      const next = cycleItemStatus(state, "nonexistent");

      expect(next).toBe(state);
    });

    it("does not mutate the original state", () => {
      const state = loadTodos(sampleCategories, [item]);
      const next = cycleItemStatus(state, "item-1");

      expect(next).not.toBe(state);
      expect(next.items).not.toBe(state.items);
      expect(state.items[0]!.status).toBe("todo");
    });

    it("updates updatedAt on every transition", () => {
      const state = loadTodos(sampleCategories, [item]);
      const next = cycleItemStatus(state, "item-1");

      expect(next.items[0]!.updatedAt).not.toBe(item.updatedAt);
    });
  });

  describe("archiveDoneItems", () => {
    it("returns empty archive when fewer than max done items", () => {
      const items = [makeDoneItem("d1", "2024-01-01T00:00:00Z")];
      const state = loadTodos(sampleCategories, items);
      const result = archiveDoneItems(state, 10);

      expect(result.archived).toHaveLength(0);
      expect(result.state.items).toHaveLength(1);
    });

    it("returns empty archive when exactly max done items", () => {
      const items = Array.from({ length: 10 }, (_, i) =>
        makeDoneItem(`d${i}`, `2024-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`),
      );
      const state = loadTodos(sampleCategories, items);
      const result = archiveDoneItems(state, 10);

      expect(result.archived).toHaveLength(0);
      expect(result.state.items).toHaveLength(10);
    });

    it("archives oldest done items when over max", () => {
      const items = Array.from({ length: 12 }, (_, i) =>
        makeDoneItem(`d${i}`, `2024-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`),
      );
      const state = loadTodos(sampleCategories, items);
      const result = archiveDoneItems(state, 10);

      expect(result.archived).toHaveLength(2);
      expect(result.archived[0]!.id).toBe("d0");
      expect(result.archived[1]!.id).toBe("d1");
      expect(result.state.items).toHaveLength(10);
      expect(result.state.items.find((i) => i.id === "d0")).toBeUndefined();
      expect(result.state.items.find((i) => i.id === "d1")).toBeUndefined();
      expect(result.state.items.find((i) => i.id === "d11")).toBeDefined();
    });

    it("archives oldest when exactly at 11", () => {
      const items = Array.from({ length: 11 }, (_, i) =>
        makeDoneItem(`d${i}`, `2024-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`),
      );
      const state = loadTodos(sampleCategories, items);
      const result = archiveDoneItems(state, 10);

      expect(result.archived).toHaveLength(1);
      expect(result.archived[0]!.id).toBe("d0");
      expect(result.state.items).toHaveLength(10);
      expect(result.state.items.find((i) => i.id === "d0")).toBeUndefined();
      expect(result.state.items.find((i) => i.id === "d10")).toBeDefined();
    });

    it("only archives done items, leaves todo/in_progress", () => {
      const doneItems = Array.from({ length: 11 }, (_, i) =>
        makeDoneItem(`d${i}`, `2024-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`),
      );
      const activeItem: TodoItem = {
        id: "active-1",
        categoryId: "cat-1",
        title: "Active",
        status: "todo",
        sortOrder: 100,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      };
      const state = loadTodos(sampleCategories, [...doneItems, activeItem]);
      const result = archiveDoneItems(state, 10);

      expect(result.archived).toHaveLength(1);
      expect(result.state.items.find((i) => i.id === "active-1")).toBeDefined();
      expect(result.state.items).toHaveLength(11);
    });

    it("does not mutate the original state", () => {
      const items = Array.from({ length: 12 }, (_, i) =>
        makeDoneItem(`d${i}`, `2024-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`),
      );
      const state = loadTodos(sampleCategories, items);
      const result = archiveDoneItems(state, 10);

      expect(result.state).not.toBe(state);
      expect(result.state.items).not.toBe(state.items);
      expect(state.items).toHaveLength(12);
    });
  });

  describe("createItem", () => {
    it("creates an item with correct defaults", () => {
      const state = loadTodos(sampleCategories, sampleItems);
      const next = createItem(state, "cat-1", "New task");

      expect(next.items).toHaveLength(3);
      const created = next.items.find((i) => i.title === "New task");
      expect(created).toBeDefined();
      expect(created!.status).toBe("todo");
      expect(created!.categoryId).toBe("cat-1");
      expect(created!.id).toBeTypeOf("string");
      expect(created!.id.length).toBeGreaterThan(0);
      expect(created!.createdAt).toBeTypeOf("string");
      expect(created!.updatedAt).toBeTypeOf("string");
      expect(created!.sortOrder).toBeTypeOf("number");
    });

    it("assigns incrementing sortOrder within a category", () => {
      const state = loadTodos(sampleCategories, sampleItems);

      const next1 = createItem(state, "cat-1", "First");
      const next2 = createItem(next1, "cat-1", "Second");
      const next3 = createItem(next2, "cat-1", "Third");

      const cat1Items = next3.items
        .filter((i) => i.categoryId === "cat-1")
        .toSorted((a, b) => a.sortOrder - b.sortOrder);

      expect(cat1Items[0]!.sortOrder).toBe(0);
      expect(cat1Items[1]!.sortOrder).toBe(1);
      expect(cat1Items[2]!.sortOrder).toBe(2);
      expect(cat1Items[3]!.sortOrder).toBe(3);
    });

    it("keeps sortOrder independent across categories", () => {
      const state = loadTodos(sampleCategories, sampleItems);
      const next = createItem(state, "cat-3", "DevOps task");

      const newItem = next.items.find((i) => i.title === "DevOps task");
      expect(newItem!.sortOrder).toBe(0);
    });

    it("does not mutate the original state", () => {
      const state = loadTodos(sampleCategories, sampleItems);
      const next = createItem(state, "cat-1", "Task");

      expect(next).not.toBe(state);
      expect(next.items).not.toBe(state.items);
      expect(state.items).toHaveLength(2);
    });

    it("assigns sortOrder 0 when category has no items", () => {
      const state = loadTodos(sampleCategories, []);
      const next = createItem(state, "cat-1", "First item");

      const created = next.items.find((i) => i.categoryId === "cat-1");
      expect(created!.sortOrder).toBe(0);
    });
  });

  describe("updateDescription", () => {
    it("sets description on an item that had none", () => {
      const state = loadTodos(sampleCategories, sampleItems);
      const next = updateDescription(state, "item-1", "A new description");

      expect(next.items[0]!.description).toBe("A new description");
      expect(next.items[0]!.updatedAt).not.toBe(sampleItems[0]!.updatedAt);
    });

    it("updates description on an item that already had one", () => {
      const itemWithDesc: TodoItem = {
        ...sampleItems[0]!,
        description: "Old description",
      };
      const state = loadTodos(sampleCategories, [itemWithDesc, sampleItems[1]!]);
      const next = updateDescription(state, "item-1", "New description");

      expect(next.items[0]!.description).toBe("New description");
    });

    it("clears description when given empty string", () => {
      const itemWithDesc: TodoItem = {
        ...sampleItems[0]!,
        description: "Old description",
      };
      const state = loadTodos(sampleCategories, [itemWithDesc, sampleItems[1]!]);
      const next = updateDescription(state, "item-1", "");

      expect(next.items[0]!.description).toBe("");
    });

    it("returns unchanged state for unknown item ID", () => {
      const state = loadTodos(sampleCategories, sampleItems);
      const next = updateDescription(state, "nonexistent", "Test");

      expect(next.items).toEqual(state.items);
    });

    it("does not mutate the original state", () => {
      const state = loadTodos(sampleCategories, sampleItems);
      const next = updateDescription(state, "item-1", "Desc");

      expect(next).not.toBe(state);
      expect(next.items).not.toBe(state.items);
      expect(state.items[0]!.description).toBeUndefined();
    });
  });
});
