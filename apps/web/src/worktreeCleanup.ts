import type { Thread } from "./types";

function normalizeWorktreePath(path: string | null): string | null {
  const trimmed = path?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed;
}

export function getOrphanedWorktreePathForThread(
  threads: readonly Thread[],
  threadId: Thread["id"],
): string | null {
  const targetThread = threads.find((thread) => thread.id === threadId);
  if (!targetThread) {
    return null;
  }

  const targetWorktreePath = normalizeWorktreePath(targetThread.worktreePath);
  if (!targetWorktreePath) {
    return null;
  }

  const isShared = threads.some((thread) => {
    if (thread.id === threadId) {
      return false;
    }
    return normalizeWorktreePath(thread.worktreePath) === targetWorktreePath;
  });

  return isShared ? null : targetWorktreePath;
}

export function getOrphanedWorktreePathsForThreads(
  threads: ReadonlyArray<{ id: string; worktreePath: string | null }>,
  threadIds: ReadonlySet<string>,
): string[] {
  const orphaned = new Set<string>();

  for (const thread of threads) {
    if (!threadIds.has(thread.id)) continue;

    const path = normalizeWorktreePath(thread.worktreePath);
    if (!path) continue;

    const hasSurvivor = threads.some(
      (other) => !threadIds.has(other.id) && normalizeWorktreePath(other.worktreePath) === path,
    );

    if (!hasSurvivor) {
      orphaned.add(path);
    }
  }

  return [...orphaned];
}

export function formatWorktreePathForDisplay(worktreePath: string): string {
  const trimmed = worktreePath.trim();
  if (!trimmed) {
    return worktreePath;
  }

  const normalized = trimmed.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = normalized.split("/");
  const lastPart = parts[parts.length - 1]?.trim() ?? "";
  return lastPart.length > 0 ? lastPart : trimmed;
}
