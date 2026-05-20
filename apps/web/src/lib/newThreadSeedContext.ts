import type { DraftThreadEnvMode } from "../composerDraftStore";

interface ThreadContextLike {
  projectId: string;
  branch: string | null;
  worktreePath: string | null;
}

interface DraftThreadContextLike extends ThreadContextLike {
  envMode: DraftThreadEnvMode;
}

export function resolveProjectDefaultedNewThreadSeedContext(input: {
  projectId: string;
  defaultEnvMode: DraftThreadEnvMode;
  activeThread?: ThreadContextLike | null;
  activeDraftThread?: DraftThreadContextLike | null;
}): {
  branch?: string | null;
  worktreePath?: string | null;
  envMode: DraftThreadEnvMode;
} {
  if (input.defaultEnvMode === "worktree") {
    return {
      envMode: "worktree",
    };
  }

  if (input.activeDraftThread?.projectId === input.projectId) {
    return {
      branch: input.activeDraftThread.branch,
      worktreePath: null,
      envMode: "local",
    };
  }

  if (input.activeThread?.projectId === input.projectId) {
    return {
      branch: input.activeThread.branch,
      worktreePath: null,
      envMode: "local",
    };
  }

  return {
    envMode: "local",
  };
}
