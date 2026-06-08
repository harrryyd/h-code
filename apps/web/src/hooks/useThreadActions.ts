import { parseScopedThreadKey, scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime";
import { type ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useCallback, useRef } from "react";

import { getFallbackThreadIdAfterDelete } from "../components/Sidebar.logic";
import { useComposerDraftStore } from "../composerDraftStore";
import { useNewThreadHandler } from "./useHandleNewThread";
import { ensureEnvironmentApi, readEnvironmentApi } from "../environmentApi";
import { invalidateGitQueries } from "../lib/gitReactQuery";
import { refreshArchivedThreadsForEnvironment } from "../lib/archivedThreadsState";
import { newCommandId } from "../lib/utils";
import { readLocalApi } from "../localApi";
import {
  selectProjectByRef,
  selectThreadByRef,
  selectThreadsForEnvironment,
  useStore,
} from "../store";
import { useTerminalStateStore } from "../terminalStateStore";
import { buildThreadRouteParams, resolveThreadRouteRef } from "../threadRoutes";
import {
  formatWorktreePathForDisplay,
  getOrphanedWorktreePathForThread,
  getOrphanedWorktreePathsForThreads,
} from "../worktreeCleanup";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { useSettings } from "./useSettings";

export function useThreadActions() {
  const sidebarThreadSortOrder = useSettings((settings) => settings.sidebarThreadSortOrder);
  const confirmThreadDelete = useSettings((settings) => settings.confirmThreadDelete);
  const clearComposerDraftForThread = useComposerDraftStore((store) => store.clearDraftThread);
  const clearProjectDraftThreadById = useComposerDraftStore(
    (store) => store.clearProjectDraftThreadById,
  );
  const clearTerminalState = useTerminalStateStore((state) => state.clearTerminalState);
  const router = useRouter();
  const { handleNewThread } = useNewThreadHandler();
  // Keep a ref so archiveThread can call handleNewThread without appearing in
  // its dependency array — handleNewThread is inherently unstable (depends on
  // the projects list) and would otherwise cascade new references into every
  // sidebar row via archiveThread → attemptArchiveThread.
  const handleNewThreadRef = useRef(handleNewThread);
  handleNewThreadRef.current = handleNewThread;
  const queryClient = useQueryClient();

  const resolveThreadTarget = useCallback((target: ScopedThreadRef) => {
    const state = useStore.getState();
    const thread = selectThreadByRef(state, target);
    if (!thread) {
      return null;
    }
    return {
      thread,
      threadRef: target,
    };
  }, []);
  const getCurrentRouteThreadRef = useCallback(() => {
    const currentRouteParams = router.state.matches[router.state.matches.length - 1]?.params ?? {};
    return resolveThreadRouteRef(currentRouteParams);
  }, [router]);

  const archiveThread = useCallback(
    async (target: ScopedThreadRef) => {
      const api = readEnvironmentApi(target.environmentId);
      if (!api) return;
      const resolved = resolveThreadTarget(target);
      if (!resolved) return;
      const { thread, threadRef } = resolved;
      if (thread.session?.status === "running" && thread.session.activeTurnId != null) {
        throw new Error("Cannot archive a running thread.");
      }

      const currentRouteThreadRef = getCurrentRouteThreadRef();
      const shouldNavigateToDraft =
        currentRouteThreadRef?.threadId === threadRef.threadId &&
        currentRouteThreadRef.environmentId === threadRef.environmentId;
      const archiveCommand = api.orchestration.dispatchCommand({
        type: "thread.archive",
        commandId: newCommandId(),
        threadId: threadRef.threadId,
      });

      if (shouldNavigateToDraft) {
        await handleNewThreadRef.current(scopeProjectRef(thread.environmentId, thread.projectId));
      }

      await archiveCommand;
      refreshArchivedThreadsForEnvironment(threadRef.environmentId);
    },
    [getCurrentRouteThreadRef, resolveThreadTarget],
  );

  const unarchiveThread = useCallback(async (target: ScopedThreadRef) => {
    const api = readEnvironmentApi(target.environmentId);
    if (!api) return;
    await api.orchestration.dispatchCommand({
      type: "thread.unarchive",
      commandId: newCommandId(),
      threadId: target.threadId,
    });
    refreshArchivedThreadsForEnvironment(target.environmentId);
  }, []);

  const bulkUnarchiveThreads = useCallback(async (targets: ScopedThreadRef[]) => {
    if (targets.length === 0) return;

    const first = targets[0]!;
    const api = readEnvironmentApi(first.environmentId);
    if (!api) return;

    for (const target of targets) {
      try {
        await api.orchestration.dispatchCommand({
          type: "thread.unarchive",
          commandId: newCommandId(),
          threadId: target.threadId,
        });
      } catch (error) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Unarchive stopped",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
        return;
      }
    }

    refreshArchivedThreadsForEnvironment(first.environmentId);
  }, []);

  const deleteThread = useCallback(
    async (target: ScopedThreadRef, opts: { deletedThreadKeys?: ReadonlySet<string> } = {}) => {
      const api = readEnvironmentApi(target.environmentId);
      if (!api) return;
      const resolved = resolveThreadTarget(target);
      if (!resolved) {
        // Thread not in main store (e.g. archived thread) — dispatch delete directly.
        await api.orchestration.dispatchCommand({
          type: "thread.delete",
          commandId: newCommandId(),
          threadId: target.threadId,
        });
        refreshArchivedThreadsForEnvironment(target.environmentId);
        return;
      }
      const { thread, threadRef } = resolved;
      const state = useStore.getState();
      const threads = selectThreadsForEnvironment(state, threadRef.environmentId);
      const threadProject = selectProjectByRef(state, {
        environmentId: threadRef.environmentId,
        projectId: thread.projectId,
      });
      const deletedIds =
        opts.deletedThreadKeys && opts.deletedThreadKeys.size > 0
          ? new Set<ThreadId>(
              [...opts.deletedThreadKeys].flatMap((threadKey) => {
                const ref = parseScopedThreadKey(threadKey);
                return ref && ref.environmentId === threadRef.environmentId ? [ref.threadId] : [];
              }),
            )
          : undefined;
      const survivingThreads =
        deletedIds && deletedIds.size > 0
          ? threads.filter((entry) => entry.id === threadRef.threadId || !deletedIds.has(entry.id))
          : threads;
      const orphanedWorktreePath = getOrphanedWorktreePathForThread(
        survivingThreads,
        threadRef.threadId,
      );
      const displayWorktreePath = orphanedWorktreePath
        ? formatWorktreePathForDisplay(orphanedWorktreePath)
        : null;
      const canDeleteWorktree = orphanedWorktreePath !== null && threadProject !== undefined;
      const localApi = readLocalApi();
      const shouldDeleteWorktree =
        canDeleteWorktree &&
        localApi &&
        (await localApi.dialogs.confirm(
          [
            "This thread is the only one linked to this worktree:",
            displayWorktreePath ?? orphanedWorktreePath,
            "",
            "Delete the worktree too?",
          ].join("\n"),
        ));

      if (thread.session && thread.session.status !== "closed") {
        await api.orchestration
          .dispatchCommand({
            type: "thread.session.stop",
            commandId: newCommandId(),
            threadId: threadRef.threadId,
            createdAt: new Date().toISOString(),
          })
          .catch(() => undefined);
      }

      try {
        await api.terminal.close({ threadId: threadRef.threadId, deleteHistory: true });
      } catch {
        // Terminal may already be closed.
      }

      const deletedThreadIds = deletedIds ?? new Set<ThreadId>();
      const currentRouteThreadRef = getCurrentRouteThreadRef();
      const shouldNavigateToFallback =
        currentRouteThreadRef?.threadId === threadRef.threadId &&
        currentRouteThreadRef.environmentId === threadRef.environmentId;
      const fallbackThreadId = getFallbackThreadIdAfterDelete({
        threads,
        deletedThreadId: threadRef.threadId,
        deletedThreadIds,
        sortOrder: sidebarThreadSortOrder,
      });
      await api.orchestration.dispatchCommand({
        type: "thread.delete",
        commandId: newCommandId(),
        threadId: threadRef.threadId,
      });
      refreshArchivedThreadsForEnvironment(threadRef.environmentId);
      clearComposerDraftForThread(threadRef);
      clearProjectDraftThreadById(
        scopeProjectRef(threadRef.environmentId, thread.projectId),
        threadRef,
      );
      clearTerminalState(threadRef);

      if (shouldNavigateToFallback) {
        if (fallbackThreadId) {
          const fallbackThread = selectThreadByRef(
            useStore.getState(),
            scopeThreadRef(threadRef.environmentId, fallbackThreadId),
          );
          if (fallbackThread) {
            await router.navigate({
              to: "/$environmentId/$threadId",
              params: buildThreadRouteParams(
                scopeThreadRef(fallbackThread.environmentId, fallbackThread.id),
              ),
              replace: true,
            });
          } else {
            await router.navigate({ to: "/", replace: true });
          }
        } else {
          await router.navigate({ to: "/", replace: true });
        }
      }

      if (!shouldDeleteWorktree || !orphanedWorktreePath || !threadProject) {
        return;
      }

      try {
        await ensureEnvironmentApi(threadRef.environmentId).vcs.removeWorktree({
          cwd: threadProject.cwd,
          path: orphanedWorktreePath,
          force: true,
        });
        await invalidateGitQueries(queryClient, {
          environmentId: threadRef.environmentId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error removing worktree.";
        console.error("Failed to remove orphaned worktree after thread deletion", {
          threadId: threadRef.threadId,
          projectCwd: threadProject.cwd,
          worktreePath: orphanedWorktreePath,
          error,
        });
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Thread deleted, but worktree removal failed",
            description: `Could not remove ${displayWorktreePath ?? orphanedWorktreePath}. ${message}`,
          }),
        );
      }
    },
    [
      clearComposerDraftForThread,
      clearProjectDraftThreadById,
      clearTerminalState,
      getCurrentRouteThreadRef,
      router,
      queryClient,
      resolveThreadTarget,
      sidebarThreadSortOrder,
    ],
  );

  const bulkDeleteThreads = useCallback(
    async (
      targets: ScopedThreadRef[],
      threadShells: ReadonlyArray<{
        id: string;
        title: string;
        worktreePath: string | null;
        projectId: string;
      }>,
      projects: ReadonlyArray<{ id: string; cwd: string }>,
    ) => {
      if (targets.length === 0) return;

      const first = targets[0]!;
      const environmentId = first.environmentId;
      const api = readEnvironmentApi(environmentId);
      if (!api) return;
      const localApi = readLocalApi();
      if (!localApi) return;

      const titles = targets.map((t) => {
        const shell = threadShells.find((s) => s.id === t.threadId);
        return shell?.title ?? t.threadId;
      });
      const displayedTitles = titles.slice(0, 50);
      const overflow = titles.length > 50 ? `\n\n...and ${titles.length - 50} more` : "";
      const titleList = displayedTitles.map((t) => `• ${t}`).join("\n");
      const confirmed = await localApi.dialogs.confirm(
        `Delete ${targets.length} thread${targets.length > 1 ? "s" : ""}?\n\n${titleList}${overflow}\n\nThis permanently clears conversation history.`,
      );
      if (!confirmed) return;

      const targetIds = new Set(targets.map((t) => t.threadId));
      const orphanedWorktreePaths = getOrphanedWorktreePathsForThreads(threadShells, targetIds);

      let shouldDeleteWorktrees = false;
      if (orphanedWorktreePaths.length > 0) {
        shouldDeleteWorktrees = await localApi.dialogs.confirm(
          `${orphanedWorktreePaths.length} worktree${orphanedWorktreePaths.length > 1 ? "s" : ""} will become orphaned. Delete them too?`,
        );
      }

      for (const target of targets) {
        try {
          await api.orchestration.dispatchCommand({
            type: "thread.delete",
            commandId: newCommandId(),
            threadId: target.threadId,
          });
        } catch (error) {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Delete stopped",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
          return;
        }
      }

      if (shouldDeleteWorktrees) {
        const envApi = await ensureEnvironmentApi(environmentId);
        for (const worktreePath of orphanedWorktreePaths) {
          const owningThread = threadShells.find((s) => s.worktreePath === worktreePath);
          const project = owningThread
            ? projects.find((p) => p.id === owningThread.projectId)
            : undefined;

          if (!project) continue;

          try {
            await envApi.vcs.removeWorktree({
              cwd: project.cwd,
              path: worktreePath,
              force: true,
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error";
            toastManager.add(
              stackedThreadToast({
                type: "error",
                title: "Worktree removal failed",
                description: `Could not remove ${formatWorktreePathForDisplay(worktreePath)}. ${message}`,
              }),
            );
            return;
          }
        }
      }

      refreshArchivedThreadsForEnvironment(environmentId);
    },
    [],
  );

  const confirmAndDeleteThread = useCallback(
    async (target: ScopedThreadRef) => {
      const api = readEnvironmentApi(target.environmentId);
      if (!api) return;
      const localApi = readLocalApi();
      const resolved = resolveThreadTarget(target);

      if (confirmThreadDelete && localApi) {
        const title = resolved?.thread.title ?? "this thread";
        const confirmed = await localApi.dialogs.confirm(
          [
            `Delete thread "${title}"?`,
            "This permanently clears conversation history for this thread.",
          ].join("\n"),
        );
        if (!confirmed) {
          return;
        }
      }

      await deleteThread(target);
    },
    [confirmThreadDelete, deleteThread, resolveThreadTarget],
  );

  return {
    archiveThread,
    unarchiveThread,
    bulkUnarchiveThreads,
    deleteThread,
    bulkDeleteThreads,
    confirmAndDeleteThread,
  };
}
