import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";

import ThreadSidebar from "./Sidebar";
import { TodoPanel } from "./TodoPanel";
import { Sidebar, SidebarProvider, SidebarRail } from "./ui/sidebar";
import {
  clearShortcutModifierState,
  syncShortcutModifierStateFromKeyboardEvent,
} from "../shortcutModifierState";
import {
  isEditableShortcutTarget,
  isModalShortcutCaptureActive,
} from "../lib/globalShortcutGuards";
import { isTerminalFocused } from "../lib/terminalFocus";
import { resolveShortcutCommand } from "../keybindings";
import { useServerKeybindings } from "../rpc/serverState";

const THREAD_SIDEBAR_WIDTH_STORAGE_KEY = "chat_thread_sidebar_width";
const THREAD_SIDEBAR_MIN_WIDTH = 13 * 16;
const THREAD_MAIN_CONTENT_MIN_WIDTH = 40 * 16;
const TODO_SIDEBAR_WIDTH_STORAGE_KEY = "todo_sidebar_width";
const TODO_SIDEBAR_DEFAULT_WIDTH = "320px";

export function AppSidebarLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [todoOpen, setTodoOpen] = useState(false);
  const keybindings = useServerKeybindings();

  const toggleTodo = useCallback(() => setTodoOpen((prev) => !prev), []);

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      syncShortcutModifierStateFromKeyboardEvent(event);
    };
    const onWindowKeyUp = (event: KeyboardEvent) => {
      syncShortcutModifierStateFromKeyboardEvent(event);
    };
    const onWindowBlur = () => {
      clearShortcutModifierState();
    };

    window.addEventListener("keydown", onWindowKeyDown, true);
    window.addEventListener("keyup", onWindowKeyUp, true);
    window.addEventListener("blur", onWindowBlur);

    return () => {
      window.removeEventListener("keydown", onWindowKeyDown, true);
      window.removeEventListener("keyup", onWindowKeyUp, true);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, []);

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (isEditableShortcutTarget(event.target)) return;
      if (isModalShortcutCaptureActive(event.target)) return;

      const command = resolveShortcutCommand(event, keybindings, {
        context: { terminalFocus: isTerminalFocused() },
      });

      if (command === "todo.toggle") {
        event.preventDefault();
        event.stopPropagation();
        toggleTodo();
      }
    };

    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, [keybindings, toggleTodo]);

  useEffect(() => {
    const onMenuAction = window.desktopBridge?.onMenuAction;
    if (typeof onMenuAction !== "function") {
      return;
    }

    const unsubscribe = onMenuAction((action) => {
      if (action === "open-settings") {
        void navigate({ to: "/settings" });
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, [navigate]);

  return (
    <SidebarProvider className="h-dvh! min-h-0!" defaultOpen>
      <Sidebar
        side="left"
        collapsible="offcanvas"
        className="border-r border-border bg-card text-foreground"
        resizable={{
          minWidth: THREAD_SIDEBAR_MIN_WIDTH,
          shouldAcceptWidth: ({ nextWidth, wrapper }) =>
            wrapper.clientWidth - nextWidth >= THREAD_MAIN_CONTENT_MIN_WIDTH,
          storageKey: THREAD_SIDEBAR_WIDTH_STORAGE_KEY,
        }}
      >
        <ThreadSidebar />
        <SidebarRail />
      </Sidebar>
      {children}
      <SidebarProvider
        defaultOpen={false}
        open={todoOpen}
        onOpenChange={setTodoOpen}
        className="w-auto min-h-0 flex-none bg-transparent"
        style={{ "--sidebar-width": TODO_SIDEBAR_DEFAULT_WIDTH } as React.CSSProperties}
      >
        <Sidebar
          side="right"
          collapsible="offcanvas"
          className="border-l border-border bg-card text-foreground"
          resizable={{
            storageKey: TODO_SIDEBAR_WIDTH_STORAGE_KEY,
          }}
        >
          <TodoPanel />
          <SidebarRail />
        </Sidebar>
      </SidebarProvider>
    </SidebarProvider>
  );
}
