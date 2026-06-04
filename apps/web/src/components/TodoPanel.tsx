import { useState } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { useTodos } from "~/hooks/useTodos";
import type { TodoCategory } from "@t3tools/contracts";
import { SidebarContent, SidebarHeader } from "./ui/sidebar";

export function TodoPanel() {
  const { categories, loading, error } = useTodos();

  return (
    <>
      <SidebarHeader className="flex-row items-center gap-2 px-3 py-2 border-b border-border">
        <span className="text-sm font-medium">Todos</span>
      </SidebarHeader>
      <SidebarContent>
        {loading && <div className="px-3 py-2 text-xs text-muted-foreground">Loading...</div>}
        {error && <div className="px-3 py-2 text-xs text-red-500">Failed to load todos</div>}
        {!loading && !error && categories.length === 0 && (
          <div className="px-3 py-2 text-xs text-muted-foreground">No todos yet</div>
        )}
        {categories.map((category) => (
          <TodoCategoryRow key={category.id} category={category} />
        ))}
      </SidebarContent>
    </>
  );
}

function TodoCategoryRow({ category }: { category: TodoCategory }) {
  const [collapsed, setCollapsed] = useState(category.collapsed === true);

  return (
    <div>
      <button
        className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-accent/50"
        onClick={() => setCollapsed((prev) => !prev)}
        style={{ backgroundColor: category.color + "20" }}
      >
        {collapsed ? <ChevronRightIcon size={14} /> : <ChevronDownIcon size={14} />}
        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: category.color }} />
        <span className="truncate">{category.name}</span>
      </button>
      {!collapsed && <div className="pl-7 pr-3 py-0.5 text-xs text-muted-foreground">No items</div>}
    </div>
  );
}
