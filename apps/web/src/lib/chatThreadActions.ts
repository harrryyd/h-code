import { scopeProjectRef } from "@t3tools/client-runtime";
import type { EnvironmentId, ProjectId, ScopedProjectRef } from "@t3tools/contracts";
import type { DraftThreadEnvMode } from "../composerDraftStore";

interface ThreadContextLike {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  branch: string | null;
  worktreePath: string | null;
}

interface DraftThreadContextLike extends ThreadContextLike {
  envMode: DraftThreadEnvMode;
}

interface NewThreadHandler {
  (
    projectRef: ScopedProjectRef,
    options?: {
      branch?: string | null;
      worktreePath?: string | null;
      envMode?: DraftThreadEnvMode;
    },
  ): Promise<void>;
}

type NewThreadOptions = NonNullable<Parameters<NewThreadHandler>[1]>;

export interface ChatThreadActionContext {
  readonly activeDraftThread: DraftThreadContextLike | null;
  readonly activeThread: ThreadContextLike | undefined;
  readonly defaultProjectRef: ScopedProjectRef | null;
  readonly handleNewThread: NewThreadHandler;
}

export function resolveThreadActionProjectRef(
  context: ChatThreadActionContext,
): ScopedProjectRef | null {
  if (context.activeThread) {
    return scopeProjectRef(context.activeThread.environmentId, context.activeThread.projectId);
  }
  if (context.activeDraftThread) {
    return scopeProjectRef(
      context.activeDraftThread.environmentId,
      context.activeDraftThread.projectId,
    );
  }
  return context.defaultProjectRef;
}

function matchesProjectRef(
  projectRef: ScopedProjectRef,
  context: Pick<ThreadContextLike, "environmentId" | "projectId">,
): boolean {
  return (
    projectRef.environmentId === context.environmentId && projectRef.projectId === context.projectId
  );
}

function buildContextualThreadOptions(
  context: ChatThreadActionContext,
  projectRef: ScopedProjectRef,
): NewThreadOptions | undefined {
  if (context.activeDraftThread && matchesProjectRef(projectRef, context.activeDraftThread)) {
    return {
      branch: context.activeDraftThread.branch,
      worktreePath: context.activeDraftThread.worktreePath,
      envMode: context.activeDraftThread.envMode,
    };
  }

  if (context.activeThread && matchesProjectRef(projectRef, context.activeThread)) {
    return {
      branch: context.activeThread.branch,
      worktreePath: context.activeThread.worktreePath,
      envMode: context.activeThread.worktreePath ? "worktree" : "local",
    };
  }

  return undefined;
}

export async function startNewThreadInProjectFromContext(
  context: ChatThreadActionContext,
  projectRef: ScopedProjectRef,
): Promise<void> {
  await context.handleNewThread(projectRef, buildContextualThreadOptions(context, projectRef));
}

export async function startNewThreadFromContext(
  context: ChatThreadActionContext,
): Promise<boolean> {
  const projectRef = resolveThreadActionProjectRef(context);
  if (!projectRef) {
    return false;
  }

  await startNewThreadInProjectFromContext(context, projectRef);
  return true;
}

export async function startNewLocalThreadFromContext(
  context: ChatThreadActionContext,
): Promise<boolean> {
  const projectRef = resolveThreadActionProjectRef(context);
  if (!projectRef) {
    return false;
  }

  await context.handleNewThread(projectRef);
  return true;
}
