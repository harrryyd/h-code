import { useCallback, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleIcon,
  CircleDotIcon,
  ExternalLinkIcon,
  EyeIcon,
  EyeOffIcon,
  GripVerticalIcon,
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
  const [draggedItem, setDraggedItem] = useState<TodoItem | null>(null);
  const [draggedCategory, setDraggedCategory] = useState<TodoCategory | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    }),
  );

  const filteredCategories = hideEmpty
    ? categories.filter((cat) => countActiveItems(items, cat.id) > 0)
    : categories;

  const categoryMap = useMemo(() => new Map(categories.map((cat) => [cat.id, cat])), [categories]);

  const doneItems = useMemo(
    () =>
      items
        .filter((item) => item.status === "done")
        .toSorted((a, b) =>
          (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt),
        )
        .slice(0, 10),
    [items],
  );

  const handleCreateCategory = () => {
    mutate([{ type: "createCategory", name: "New Category", color: "" }] as TodoMutation[]);
  };

  const handleCycleItem = (itemId: string) => {
    mutate([{ type: "cycleItemStatus", itemId }]);
  };

  const handleUpdateDescription = (itemId: string, description: string) => {
    mutate([{ type: "updateItemDescription", itemId, description }]);
  };

  const selectedItem = selectedItemId ? (items.find((i) => i.id === selectedItemId) ?? null) : null;
  const selectedCategory = selectedItem
    ? categories.find((c) => c.id === selectedItem.categoryId)
    : undefined;

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const { active } = event;
      if (active.data.current?.kind === "item") {
        const item = items.find((i) => i.id === active.id);
        if (item) setDraggedItem(item);
      } else if (active.data.current?.kind === "category") {
        const catId = (active.id as string).replace("category:", "");
        const cat = categories.find((c) => c.id === catId);
        if (cat) setDraggedCategory(cat);
      }
    },
    [items, categories],
  );

  const handleDragCancel = useCallback(() => {
    setDraggedItem(null);
    setDraggedCategory(null);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDraggedItem(null);
      setDraggedCategory(null);

      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const activeData = active.data.current;
      const overData = over.data.current;

      if (activeData?.kind === "category") {
        const activeCatId = (active.id as string).replace("category:", "");
        const overCatId = (over.id as string).replace("category:", "");

        const oldIdx = categories.findIndex((c) => c.id === activeCatId);
        const newIdx = categories.findIndex((c) => c.id === overCatId);
        if (oldIdx !== -1 && newIdx !== -1 && oldIdx !== newIdx) {
          const orderedIds = categories.map((c) => c.id);
          const [moved] = orderedIds.splice(oldIdx, 1);
          orderedIds.splice(newIdx, 0, moved!);
          mutate([{ type: "reorderCategories", orderedIds }]);
        }
        return;
      }

      if (activeData?.kind === "item") {
        const activeItem = items.find((i) => i.id === active.id);
        if (!activeItem) return;

        const fromCatId = activeItem.categoryId;
        const activeItemsAll = items.filter(
          (i) => i.status === "todo" || i.status === "in_progress",
        );

        const toCatId =
          overData?.kind === "item"
            ? overData.categoryId
            : overData?.kind === "category"
              ? overData.categoryId
              : fromCatId;

        const targetItems = activeItemsAll
          .filter((i) => i.categoryId === toCatId && i.id !== activeItem.id)
          .toSorted((a, b) => a.sortOrder - b.sortOrder);

        let insertIndex = targetItems.length;
        if (overData?.kind === "item" && overData.categoryId === toCatId) {
          insertIndex = targetItems.findIndex((i) => i.id === over.id);
          if (insertIndex === -1) insertIndex = targetItems.length;
        }

        targetItems.splice(insertIndex, 0, activeItem);

        const affected: Array<{ id: string; categoryId: string; sortOrder: number }> = [];

        if (fromCatId !== toCatId) {
          const fromItems = activeItemsAll
            .filter((i) => i.categoryId === fromCatId && i.id !== activeItem.id)
            .toSorted((a, b) => a.sortOrder - b.sortOrder);

          fromItems.forEach((item, idx) => {
            affected.push({ id: item.id, categoryId: fromCatId, sortOrder: idx });
          });
        }

        targetItems.forEach((item, idx) => {
          affected.push({ id: item.id, categoryId: toCatId, sortOrder: idx });
        });

        mutate([{ type: "reorderItems", updates: affected }]);
      }
    },
    [items, categories, mutate],
  );

  const categorySortableIds = useMemo(
    () => filteredCategories.map((c) => `category:${c.id}`),
    [filteredCategories],
  );

  return (
    <div className="relative h-full">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
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
          {!loading && !error && filteredCategories.length === 0 && doneItems.length === 0 && (
            <div className="flex items-center justify-center h-full px-4 py-8">
              <p className="text-xs text-muted-foreground text-center">
                No categories yet.
                <br />
                Click <span className="font-medium">+</span> to create one.
              </p>
            </div>
          )}
          <SortableContext items={categorySortableIds} strategy={verticalListSortingStrategy}>
            {filteredCategories.map((category) => (
              <TodoCategoryRow
                key={category.id}
                category={category}
                items={items}
                mutate={mutate}
                onCycleItem={handleCycleItem}
                onSelectItem={setSelectedItemId}
              />
            ))}
          </SortableContext>
          {doneItems.length > 0 && (
            <DoneSection
              doneItems={doneItems}
              categoryMap={categoryMap}
              onCycleItem={handleCycleItem}
              onSelectItem={setSelectedItemId}
            />
          )}
        </SidebarContent>
        {selectedItem && selectedItemId && (
          <ItemDetailPanel
            item={selectedItem}
            category={selectedCategory}
            onClose={() => setSelectedItemId(null)}
            onUpdateDescription={handleUpdateDescription}
          />
        )}
        <DragOverlay>
          {draggedItem && (
            <div className="flex items-center gap-2 px-3 py-0.5 text-xs bg-background border rounded shadow-lg opacity-90">
              <StatusIcon status={draggedItem.status} />
              <span className="truncate">{draggedItem.title}</span>
            </div>
          )}
          {draggedCategory && (
            <div className="flex items-center gap-2 px-3 py-1.5 text-sm bg-background border rounded shadow-lg opacity-90">
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: draggedCategory.color }}
              />
              <span className="truncate">{draggedCategory.name}</span>
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

function SortableCategoryHeader({
  category,
  collapsed,
  onToggle,
  renaming,
  renameValue,
  onRenameChange,
  onRenameKeyDown,
  onRenameCommit,
  onDoubleClick,
  onContextMenu,
  jiraKey,
  onAddItem,
}: {
  category: TodoCategory;
  collapsed: boolean;
  onToggle: () => void;
  renaming: boolean;
  renameValue: string;
  onRenameChange: (v: string) => void;
  onRenameKeyDown: (e: React.KeyboardEvent) => void;
  onRenameCommit: () => void;
  onDoubleClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  jiraKey: string | null;
  onAddItem: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `category:${category.id}`,
    data: { kind: "category", categoryId: category.id },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <button
        className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-accent/50"
        onClick={onToggle}
        onContextMenu={onContextMenu}
        onDoubleClick={onDoubleClick}
        style={{ backgroundColor: category.color + "20" }}
      >
        <div className="shrink-0 cursor-grab active:cursor-grabbing" {...attributes} {...listeners}>
          <GripVerticalIcon size={10} className="text-muted-foreground/50" />
        </div>
        {collapsed ? <ChevronRightIcon size={14} /> : <ChevronDownIcon size={14} />}
        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: category.color }} />
        {renaming ? (
          <input
            className="flex-1 bg-transparent border-b border-primary outline-none text-sm"
            value={renameValue}
            onChange={(e) => onRenameChange(e.target.value)}
            onKeyDown={onRenameKeyDown}
            onBlur={onRenameCommit}
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
            onAddItem();
          }}
          title="Add item"
        >
          <PlusIcon size={12} />
        </button>
      </button>
    </div>
  );
}

function SortableTodoItem({
  item,
  categoryColor,
  categoryJiraLink,
  onCycleItem,
  onSelectItem,
  mutate,
}: {
  item: TodoItem;
  categoryColor: string;
  categoryJiraLink: string | undefined;
  onCycleItem: (itemId: string) => void;
  onSelectItem: (itemId: string) => void;
  mutate: (mutations: TodoMutation[]) => Promise<void>;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    data: { kind: "item", categoryId: item.categoryId },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const handleContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();

    const api = ensureLocalApi();

    void api.contextMenu
      .show(
        [
          {
            id: `jira:${item.id}`,
            label: item.jiraLink ? "Change JIRA Link" : "Edit JIRA Link",
          },
          ...(item.jiraLink
            ? [{ id: `clear-jira:${item.id}` as string, label: "Clear JIRA Link" }]
            : []),
          {
            id: `delete:${item.id}`,
            label: "Delete",
            destructive: true,
          },
        ],
        { x: event.clientX, y: event.clientY },
      )
      .then((clicked) => {
        if (!clicked) return;

        if (clicked === `jira:${item.id}`) {
          const url = window.prompt("Enter JIRA issue URL:", item.jiraLink ?? "");
          if (url !== null) {
            const trimmed = url.trim();
            if (trimmed) {
              mutate([{ type: "setItemJiraLink", itemId: item.id, jiraLink: trimmed }]);
            } else {
              mutate([{ type: "setItemJiraLink", itemId: item.id, jiraLink: "" }]);
            }
          }
        } else if (clicked === `clear-jira:${item.id}`) {
          mutate([{ type: "setItemJiraLink", itemId: item.id, jiraLink: "" }]);
        } else if (clicked === `delete:${item.id}`) {
          if (window.confirm(`Delete "${item.title}"? This cannot be undone.`)) {
            mutate([{ type: "deleteItem", itemId: item.id }]);
          }
        }
      });
  };

  const effectiveJiraLink = item.jiraLink ?? categoryJiraLink;
  const jiraKey = effectiveJiraLink ? extractJiraKey(effectiveJiraLink) : null;
  const isInherited = !item.jiraLink && !!categoryJiraLink;

  return (
    <div
      ref={setNodeRef}
      style={{ ...style, backgroundColor: categoryColor + "08" }}
      className="flex items-center gap-2 pl-7 pr-3 py-0.5 text-xs hover:bg-accent/50"
      onContextMenu={handleContextMenu}
    >
      <div className="shrink-0 cursor-grab active:cursor-grabbing" {...attributes} {...listeners}>
        <GripVerticalIcon size={10} className="text-muted-foreground/50" />
      </div>
      <button
        className="shrink-0 p-0 rounded hover:bg-accent/50"
        onClick={() => onCycleItem(item.id)}
        title={`Status: ${item.status}`}
      >
        <StatusIcon status={item.status} />
      </button>
      <span className="truncate cursor-pointer" onClick={() => onSelectItem(item.id)}>
        {item.title}
      </span>
      {jiraKey && (
        <a
          href={effectiveJiraLink}
          target="_blank"
          rel="noopener noreferrer"
          className={`shrink-0 text-[10px] hover:underline flex items-center gap-0.5 ml-auto ${
            isInherited ? "text-muted-foreground/50 italic" : "text-muted-foreground"
          }`}
          onClick={(e) => e.stopPropagation()}
          title={isInherited ? `Inherited from category: ${jiraKey}` : jiraKey}
        >
          <ExternalLinkIcon size={10} />
          {jiraKey}
        </a>
      )}
    </div>
  );
}

function TodoCategoryRow({
  category,
  items,
  mutate,
  onCycleItem,
  onSelectItem,
}: {
  category: TodoCategory;
  items: TodoItem[];
  mutate: (mutations: TodoMutation[]) => Promise<void>;
  onCycleItem: (itemId: string) => void;
  onSelectItem: (itemId: string) => void;
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
    if (!trimmed) return;
    mutate([{ type: "createItem", categoryId: category.id, title: trimmed }]);
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
    .filter(
      (item) =>
        item.categoryId === category.id &&
        (item.status === "todo" || item.status === "in_progress"),
    )
    .toSorted((a, b) => a.sortOrder - b.sortOrder);

  const itemSortableIds = useMemo(() => categoryItems.map((i) => i.id), [categoryItems]);

  return (
    <div>
      <SortableCategoryHeader
        category={category}
        collapsed={collapsed}
        onToggle={() => setCollapsed((prev) => !prev)}
        renaming={renaming}
        renameValue={renameValue}
        onRenameChange={setRenameValue}
        onRenameKeyDown={handleRenameKeyDown}
        onRenameCommit={commitRename}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        jiraKey={jiraKey}
        onAddItem={startAdd}
      />
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
            <SortableContext items={itemSortableIds} strategy={verticalListSortingStrategy}>
              {categoryItems.map((item) => (
                <SortableTodoItem
                  key={item.id}
                  item={item}
                  categoryColor={category.color}
                  categoryJiraLink={category.jiraLink}
                  onCycleItem={onCycleItem}
                  onSelectItem={onSelectItem}
                  mutate={mutate}
                />
              ))}
            </SortableContext>
          )}
        </div>
      )}
    </div>
  );
}

function ItemDetailPanel({
  item,
  category,
  onClose,
  onUpdateDescription,
}: {
  item: TodoItem;
  category: TodoCategory | undefined;
  onClose: () => void;
  onUpdateDescription: (itemId: string, description: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(item.description ?? "");

  const handleStartEdit = () => {
    setEditValue(item.description ?? "");
    setEditing(true);
  };

  const handleSaveEdit = () => {
    if (editValue !== (item.description ?? "")) {
      onUpdateDescription(item.id, editValue);
    }
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      handleSaveEdit();
    }
  };

  return (
    <div className="absolute left-full top-0 w-72 h-full border-l border-border bg-card z-10 overflow-y-auto">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground text-lg leading-none"
        >
          &times;
        </button>
        <span className="text-sm font-medium">Item Detail</span>
      </div>
      <div className="p-3">
        <div className="text-sm font-medium mb-1">{item.title}</div>
        <div className="flex items-center gap-2 mb-2">
          <StatusIcon status={item.status} />
          {category && (
            <span
              className="text-[10px] px-1 py-0.5 rounded"
              style={{ backgroundColor: category.color + "30", color: category.color }}
            >
              {category.name}
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground mb-1">Description</div>
        {editing ? (
          <div>
            <textarea
              className="w-full h-32 bg-background border border-border rounded p-2 text-xs resize-none"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleSaveEdit}
              autoFocus
            />
            <div className="text-[10px] text-muted-foreground mt-1">Editing&hellip;</div>
          </div>
        ) : item.description ? (
          <div
            className="text-xs prose prose-sm max-w-none cursor-pointer"
            onClick={handleStartEdit}
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.description}</ReactMarkdown>
          </div>
        ) : (
          <div
            className="text-xs text-muted-foreground cursor-pointer italic"
            onClick={handleStartEdit}
          >
            Click to add description&hellip;
          </div>
        )}
      </div>
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

function DoneSection({
  doneItems,
  categoryMap,
  onCycleItem,
  onSelectItem,
}: {
  doneItems: TodoItem[];
  categoryMap: Map<string, TodoCategory>;
  onCycleItem: (itemId: string) => void;
  onSelectItem: (itemId: string) => void;
}) {
  if (doneItems.length === 0) return null;

  return (
    <div className="mt-2 border-t border-border">
      <div className="px-3 py-1.5 text-sm font-medium text-muted-foreground">Done</div>
      {doneItems.map((item) => {
        const cat = categoryMap.get(item.categoryId);
        return (
          <div
            key={item.id}
            className="flex items-center gap-2 pl-3 pr-3 py-0.5 text-xs hover:bg-accent/50"
          >
            <button
              className="shrink-0 p-0 rounded hover:bg-accent/50"
              onClick={() => onCycleItem(item.id)}
              title="Click to return to todo"
            >
              <CheckCircle2Icon size={12} className="text-green-500 shrink-0" />
            </button>
            <span className="truncate cursor-pointer" onClick={() => onSelectItem(item.id)}>
              {item.title}
            </span>
            {cat && (
              <span
                className="shrink-0 text-[10px] px-1 py-0.5 rounded ml-auto opacity-70"
                style={{ backgroundColor: cat.color + "30", color: cat.color }}
              >
                {cat.name}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
