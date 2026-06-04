import { useCallback, useState } from "react";
import {
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleIcon,
  CircleDotIcon,
  ExternalLinkIcon,
  EyeIcon,
  EyeOffIcon,
  PlusIcon,
} from "lucide-react";
import type { TodoCategory, TodoItem, ContextMenuItem, TodoMutation } from "@t3tools/contracts";
import { ensureLocalApi } from "~/localApi";
import { useTodos } from "~/hooks/useTodos";
import { SidebarContent, SidebarHeader } from "./ui/sidebar";

const COLOR_PALETTE = [
  "#3b82f6",
  "#ef4444",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#84cc16",
  "#f97316",
  "#6366f1",
];

function extractJiraKey(url: string): string | null {
  const match = url.match(/([A-Z]+-\d+)$/);
  return match ? (match[1] ?? null) : null;
}

function countActiveItems(items: TodoItem[], categoryId: string): number {
  return items.filter(
    (item) =>
      item.categoryId === categoryId && (item.status === "todo" || item.status === "in_progress"),
  ).length;
}

export function TodoPanel() {
  const { categories, items, loading, error, mutate } = useTodos();
  const [hideEmpty, setHideEmpty] = useState(false);

  const handleCreateCategory = () => {
    mutate([{ type: "createCategory", name: "New Category", color: "" }] as TodoMutation[]);
  };

  const filteredCategories = hideEmpty
    ? categories.filter((cat) => countActiveItems(items, cat.id) > 0)
    : categories;

  return (
    <>
      <SidebarHeader className="flex-row items-center gap-2 px-3 py-2 border-b border-border">
        <span className="text-sm font-medium">Todos</span>
        <div className="flex-1" />
        <button
          className="p-0.5 rounded hover:bg-accent/50 text-muted-foreground"
          onClick={() => setHideEmpty((prev) => !prev)}
          title={hideEmpty ? "Show empty categories" : "Hide empty categories"}
        >
          {hideEmpty ? <EyeOffIcon size={14} /> : <EyeIcon size={14} />}
        </button>
        <button
          className="p-0.5 rounded hover:bg-accent/50 text-muted-foreground"
          onClick={handleCreateCategory}
          title="New category"
        >
          <PlusIcon size={14} />
        </button>
      </SidebarHeader>
      <SidebarContent>
        {loading && <div className="px-3 py-2 text-xs text-muted-foreground">Loading...</div>}
        {error && <div className="px-3 py-2 text-xs text-red-500">Failed to load todos</div>}
        {!loading && !error && filteredCategories.length === 0 && (
          <div className="px-3 py-2 text-xs text-muted-foreground">No todos yet</div>
        )}
        {filteredCategories.map((category) => (
          <TodoCategoryRow key={category.id} category={category} items={items} mutate={mutate} />
        ))}
      </SidebarContent>
    </>
  );
}

function TodoCategoryRow({
  category,
  items,
  mutate,
}: {
  category: TodoCategory;
  items: TodoItem[];
  mutate: (mutations: TodoMutation[]) => Promise<void>;
}) {
  const [collapsed, setCollapsed] = useState(category.collapsed === true);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(category.name);
  const [adding, setAdding] = useState(false);
  const [addValue, setAddValue] = useState("");

  const handleDoubleClick = () => {
    setRenameValue(category.name);
    setRenaming(true);
  };

  const commitRename = () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== category.name) {
      mutate([{ type: "renameCategory", categoryId: category.id, name: trimmed }]);
    }
    setRenaming(false);
  };

  const cancelRename = () => {
    setRenaming(false);
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      commitRename();
    } else if (e.key === "Escape") {
      cancelRename();
    }
  };

  const startAdd = () => {
    setAdding(true);
    setAddValue("");
  };

  const commitAdd = () => {
    const trimmed = addValue.trim();
    if (trimmed) {
      mutate([{ type: "createItem", categoryId: category.id, title: trimmed }]);
    }
    setAdding(false);
    setAddValue("");
  };

  const cancelAdd = () => {
    setAdding(false);
    setAddValue("");
  };

  const handleAddKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      commitAdd();
    } else if (e.key === "Escape") {
      cancelAdd();
    }
  };

  const activeCount = countActiveItems(items, category.id);

  const handleContextMenu = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();

      const colorChildren = COLOR_PALETTE.map(
        (color): ContextMenuItem<string> => ({
          id: `color:${color}`,
          label: color,
        }),
      );

      const api = ensureLocalApi();

      void api.contextMenu
        .show(
          [
            { id: "rename", label: "Rename" },
            {
              id: "color",
              label: "Color",
              children: colorChildren,
            },
            {
              id: "jira",
              label: category.jiraLink ? "Change JIRA Link" : "Set JIRA Link",
            },
            ...(category.jiraLink
              ? [{ id: "clear-jira" as string, label: "Clear JIRA Link" }]
              : []),
            {
              id: "delete",
              label: "Delete Category",
              destructive: true,
              disabled: activeCount > 0,
            },
          ],
          { x: event.clientX, y: event.clientY },
        )
        .then((clicked) => {
          if (!clicked) return;

          if (clicked === "rename") {
            setRenameValue(category.name);
            setRenaming(true);
          } else if (clicked.startsWith("color:")) {
            const color = clicked.slice("color:".length);
            mutate([{ type: "setCategoryColor", categoryId: category.id, color }]);
          } else if (clicked === "jira") {
            const url = window.prompt("Enter JIRA issue URL:", category.jiraLink ?? "");
            if (url !== null) {
              const trimmed = url.trim();
              if (trimmed) {
                mutate([
                  { type: "setCategoryJiraLink", categoryId: category.id, jiraLink: trimmed },
                ]);
              }
            }
          } else if (clicked === "clear-jira") {
            mutate([{ type: "setCategoryJiraLink", categoryId: category.id, jiraLink: "" }]);
          } else if (clicked === "delete") {
            if (window.confirm(`Delete category "${category.name}"? This cannot be undone.`)) {
              mutate([{ type: "deleteCategory", categoryId: category.id }]);
            }
          }
        });
    },
    [category, mutate, activeCount],
  );

  const jiraKey = category.jiraLink ? extractJiraKey(category.jiraLink) : null;

  const categoryItems = items
    .filter((item) => item.categoryId === category.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return (
    <div>
      <button
        className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-accent/50"
        onClick={() => setCollapsed((prev) => !prev)}
        onContextMenu={handleContextMenu}
        onDoubleClick={handleDoubleClick}
        style={{ backgroundColor: category.color + "20" }}
      >
        {collapsed ? <ChevronRightIcon size={14} /> : <ChevronDownIcon size={14} />}
        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: category.color }} />
        {renaming ? (
          <input
            className="flex-1 bg-transparent border-b border-primary outline-none text-sm"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={handleRenameKeyDown}
            onBlur={commitRename}
            autoFocus
          />
        ) : (
          <span className="truncate">{category.name}</span>
        )}
        {jiraKey && (
          <a
            href={category.jiraLink}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-[10px] text-muted-foreground hover:underline flex items-center gap-0.5 ml-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLinkIcon size={10} />
            {jiraKey}
          </a>
        )}
        <button
          className="shrink-0 p-0.5 rounded hover:bg-accent/50 text-muted-foreground ml-auto"
          onClick={(e) => {
            e.stopPropagation();
            startAdd();
          }}
          title="Add item"
        >
          <PlusIcon size={12} />
        </button>
      </button>
      {!collapsed && (
        <div>
          {adding && (
            <div className="pl-10 pr-3 py-1">
              <input
                className="w-full bg-transparent border-b border-primary outline-none text-xs py-0.5"
                placeholder="Item title..."
                value={addValue}
                onChange={(e) => setAddValue(e.target.value)}
                onKeyDown={handleAddKeyDown}
                onBlur={cancelAdd}
                autoFocus
              />
            </div>
          )}
          {categoryItems.length === 0 ? (
            <div className="pl-7 pr-3 py-0.5 text-xs text-muted-foreground">No items</div>
          ) : (
            categoryItems.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-2 pl-7 pr-3 py-0.5 text-xs hover:bg-accent/50"
              >
                <StatusIcon status={item.status} />
                <span className="truncate">{item.title}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "done":
      return <CheckCircle2Icon size={12} className="text-green-500 shrink-0" />;
    case "in_progress":
      return <CircleDotIcon size={12} className="text-yellow-500 shrink-0" />;
    default:
      return <CircleIcon size={12} className="text-muted-foreground shrink-0" />;
  }
}
