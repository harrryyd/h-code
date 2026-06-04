import { SidebarContent, SidebarHeader } from "./ui/sidebar";

export function TodoPanel() {
  return (
    <>
      <SidebarHeader className="flex-row items-center gap-2 px-3 py-2 border-b border-border">
        <span className="text-sm font-medium">Todos</span>
      </SidebarHeader>
      <SidebarContent />
    </>
  );
}
