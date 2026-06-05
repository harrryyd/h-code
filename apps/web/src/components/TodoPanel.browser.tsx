import "../index.css";

import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { RenderResult } from "vitest-browser-react";

import { Sidebar, SidebarProvider } from "./ui/sidebar";
import { TodoPanel } from "./TodoPanel";
import type { TodoCategory, TodoItem, TodoMutation } from "@t3tools/contracts";

const mockCategories: TodoCategory[] = [
  {
    id: "cat-1",
    name: "Backend",
    color: "#3b82f6",
    createdAt: "2025-01-01T00:00:00.000Z",
  },
  {
    id: "cat-2",
    name: "Frontend",
    color: "#ef4444",
    createdAt: "2025-01-02T00:00:00.000Z",
  },
  {
    id: "cat-3",
    name: "Empty Cat",
    color: "#10b981",
    createdAt: "2025-01-03T00:00:00.000Z",
  },
];

const mockItems: TodoItem[] = [
  {
    id: "item-1",
    categoryId: "cat-1",
    title: "Set up database schema",
    description: "Design and implement the PostgreSQL schema for user and project tables.",
    status: "todo",
    sortOrder: 0,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
  },
  {
    id: "item-2",
    categoryId: "cat-1",
    title: "Add authentication middleware",
    description: "Implement JWT-based auth middleware with refresh token support.",
    status: "in_progress",
    sortOrder: 1,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-02T00:00:00.000Z",
  },
  {
    id: "item-3",
    categoryId: "cat-2",
    title: "Build login page",
    status: "done",
    sortOrder: 0,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-03T00:00:00.000Z",
    completedAt: "2025-01-03T00:00:00.000Z",
  },
  {
    id: "item-4",
    categoryId: "cat-1",
    title: "Add rate limiting",
    description: "",
    status: "done",
    sortOrder: 2,
    createdAt: "2025-01-02T00:00:00.000Z",
    updatedAt: "2025-01-04T00:00:00.000Z",
    completedAt: "2025-01-04T00:00:00.000Z",
  },
];

let currentCategories: TodoCategory[];
let currentItems: TodoItem[];

vi.mock("~/hooks/useTodos", () => ({
  useTodos: () => ({
    get categories() {
      return currentCategories;
    },
    get items() {
      return currentItems;
    },
    loading: false,
    error: null,
    reload: vi.fn(),
    mutate: vi.fn(async (_mutations: TodoMutation[]) => {
      return Promise.resolve();
    }),
  }),
}));

let screen: RenderResult;

beforeEach(async () => {
  currentCategories = [...mockCategories];
  currentItems = [...mockItems];
  document.body.innerHTML = "";
  screen = await render(
    <SidebarProvider defaultOpen={true}>
      <div className="flex-1" />
      <Sidebar side="right" collapsible="none">
        <TodoPanel />
      </Sidebar>
    </SidebarProvider>,
  );
});

afterEach(async () => {
  await screen.unmount();
});

describe("TodoPanel rendering", () => {
  it("renders categories, items, and done section", async () => {
    await expect.element(page.getByText("Backend").first()).toBeInTheDocument();
    await expect.element(page.getByText("Frontend").first()).toBeInTheDocument();
    await expect.element(page.getByText("Empty Cat")).toBeInTheDocument();
    await expect.element(page.getByText("Set up database schema")).toBeInTheDocument();
    await expect.element(page.getByText("Add authentication middleware")).toBeInTheDocument();
    await expect.element(page.getByText("Done")).toBeInTheDocument();
    await expect.element(page.getByText("Build login page")).toBeInTheDocument();
    await expect.element(page.getByText("Add rate limiting")).toBeInTheDocument();
    await expect.element(page.getByText("No items").first()).toBeInTheDocument();
  });

  it("shows empty state when no categories or items", async () => {
    currentCategories = [];
    currentItems = [];
    await screen.rerender(
      <SidebarProvider defaultOpen={true}>
        <div className="flex-1" />
        <Sidebar side="right" collapsible="none">
          <TodoPanel />
        </Sidebar>
      </SidebarProvider>,
    );

    await expect.element(page.getByText(/No categories yet/)).toBeInTheDocument();
  });
});

describe("TodoPanel interactions", () => {
  it("hide-empty toggle hides and shows empty categories", async () => {
    await expect.element(page.getByText("Empty Cat")).toBeInTheDocument();
    await page.getByTitle("Hide empty categories").click();
    await expect.element(page.getByText("Empty Cat")).not.toBeInTheDocument();
    await page.getByTitle("Show empty categories").click();
    await expect.element(page.getByText("Empty Cat")).toBeInTheDocument();
  });

  it("collapses and expands categories", async () => {
    const backendButton = page.getByRole("button", { name: "Backend" });
    await expect.element(page.getByText("Set up database schema")).toBeInTheDocument();
    await backendButton.click();
    await expect.element(page.getByText("Set up database schema")).not.toBeInTheDocument();
    await backendButton.click();
    await expect.element(page.getByText("Set up database schema")).toBeInTheDocument();
  });

  it("shows add-item input on category add button", async () => {
    await page.getByTitle("Add item").first().click();
    await expect.element(page.getByPlaceholder("Item title...")).toBeInTheDocument();
  });

  it("cycles item status via status button", async () => {
    const statusButton = page.getByTitle("Status: todo");
    await expect.element(statusButton).toBeVisible();
    await statusButton.click();
  });

  it("cycles done item back to todo via click", async () => {
    await page.getByTitle("Click to return to todo").first().click();
  });
});

describe("TodoPanel detail panel", () => {
  async function openDetail() {
    await page.getByText("Set up database schema").click();
    await expect.element(page.getByText("Item Detail")).toBeInTheDocument();
  }

  it("opens and closes detail panel", async () => {
    await openDetail();
    // Verify the detail panel is actually within the viewport
    await expect.element(page.getByText("Item Detail")).toBeVisible();
    // Close it
    await page.getByText("×").click();
    await expect.element(page.getByText("Item Detail")).not.toBeInTheDocument();
  });

  it("shows item title, description, and category badge in detail panel", async () => {
    await openDetail();
    await expect
      .element(
        page.getByText("Design and implement the PostgreSQL schema for user and project tables."),
      )
      .toBeInTheDocument();
    await expect.element(page.getByText("Backend").first()).toBeInTheDocument();
  });

  it("enters edit mode with textarea and editing indicator", async () => {
    await openDetail();
    await page
      .getByText("Design and implement the PostgreSQL schema for user and project tables.")
      .click();
    await expect.element(page.getByRole("textbox")).toBeInTheDocument();
    await expect.element(page.getByText(/Editing/)).toBeInTheDocument();
  });

  it("shows placeholder for items without description", async () => {
    await page.getByText("Build login page").click();
    await expect.element(page.getByText(/Click to add description/)).toBeInTheDocument();
  });
});
