import { describe, it, expect, vi } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import type { BackgroundAgentResponseEvent } from "@t3tools/contracts";

import { BackgroundAgentService } from "./BackgroundAgentService.ts";
import { GitWorkflowService } from "../git/GitWorkflowService.ts";
import { GitVcsDriver } from "../vcs/GitVcsDriver.ts";
import { ReviewService } from "./ReviewService.ts";

function makeTestLayer(input: {
  readonly gitDiff: string;
  readonly gitStatus: string;
  readonly createWorktreePath: string;
  readonly createWorktreeRefName: string;
  readonly createWorktreeError?: Error;
  readonly updateAgentStatusError?: Error;
}) {
  const mockGitWorkflow = GitWorkflowService.of({
    status: () => Effect.die("unexpected"),
    localStatus: () => Effect.die("unexpected"),
    remoteStatus: () => Effect.die("unexpected"),
    invalidateLocalStatus: () => Effect.void,
    invalidateRemoteStatus: () => Effect.void,
    invalidateStatus: () => Effect.void,
    pullCurrentBranch: () => Effect.die("unexpected"),
    runStackedAction: () => Effect.die("unexpected"),
    resolvePullRequest: () => Effect.die("unexpected"),
    preparePullRequestThread: () => Effect.die("unexpected"),
    listRefs: () => Effect.die("unexpected"),
    createWorktree: () => {
      if (input.createWorktreeError) {
        return Effect.fail(input.createWorktreeError as never);
      }
      return Effect.succeed({
        worktree: {
          path: input.createWorktreePath,
          refName: input.createWorktreeRefName,
        },
      });
    },
    removeWorktree: () => Effect.void,
    createRef: () => Effect.die("unexpected"),
    switchRef: () => Effect.die("unexpected"),
    renameBranch: () => Effect.die("unexpected"),
  });

  const mockGit = GitVcsDriver.of({
    execute: (args: { operation: string; cwd: string; args: string[] }) => {
      const argStr = args.args.join(" ");
      if (argStr.includes("status --porcelain")) {
        return Effect.succeed({
          stdout: input.gitStatus,
          stderr: "",
          exitCode: 0,
        });
      }
      // All other git commands succeed silently
      return Effect.succeed({ stdout: "", stderr: "", exitCode: 0 });
    },
    getPrDiff: () => Effect.succeed(input.gitDiff),
    getReviewDiffPreview: () => Effect.die("unexpected"),
    checkoutPullRequest: () => Effect.die("unexpected"),
    refNameAtPath: () => Effect.die("unexpected"),
    listRefs: () => Effect.die("unexpected"),
    createWorktree: () => Effect.die("unexpected"),
    removeWorktree: () => Effect.die("unexpected"),
    createRef: () => Effect.die("unexpected"),
    switchRef: () => Effect.die("unexpected"),
    pullCurrentBranch: () => Effect.die("unexpected"),
    renameBranch: () => Effect.die("unexpected"),
    remoteResolvedHeadSha: () => Effect.die("unexpected"),
    remoteHasCommit: () => Effect.die("unexpected"),
    getPushTarget: () => Effect.die("unexpected"),
    push: () => Effect.die("unexpected"),
    createBranchOnRemote: () => Effect.die("unexpected"),
    getDefaultBranch: () => Effect.die("unexpected"),
    getDefaultBranchName: () => Effect.die("unexpected"),
    currentBranchName: () => Effect.die("unexpected"),
    stashAndPop: () => Effect.die("unexpected"),
    hasUncommittedChanges: () => Effect.die("unexpected"),
    listRefsPage: () => Effect.die("unexpected"),
    resolveCommitPage: () => Effect.die("unexpected"),
    streamStatus: () => Effect.die("unexpected"),
  });

  const updateCommentAgentStatus = vi.fn();
  if (input.updateAgentStatusError) {
    updateCommentAgentStatus.mockReturnValue(
      Effect.fail(input.updateAgentStatusError as never),
    );
  } else {
    updateCommentAgentStatus.mockReturnValue(Effect.succeed(null));
  }

  const mockReview = ReviewService.of({
    getDiffPreview: () => Effect.die("unexpected"),
    getReviewDraft: () => Effect.die("unexpected"),
    upsertReviewComment: () => Effect.die("unexpected"),
    deleteReviewComment: () => Effect.die("unexpected"),
    submitReview: () => Effect.die("unexpected"),
    updateCommentAgentStatus: updateCommentAgentStatus as never,
  });

  return Layer.mergeAll(
    Layer.succeed(GitWorkflowService, mockGitWorkflow),
    Layer.succeed(GitVcsDriver, mockGit),
    Layer.succeed(ReviewService, mockReview),
  );
}

describe("BackgroundAgentService", () => {
  it("creates worktree on unique branch, checks for changes, and cleans up", () =>
    Effect.gen(function* () {
      const layer = makeTestLayer({
        gitDiff: "diff --git a/test.ts b/test.ts\n+test change",
        gitStatus: "M test.ts\n",
        createWorktreePath: "/tmp/t3-test-worktree",
        createWorktreeRefName: "t3/agent-response-abc12345",
      });

      const service = yield* BackgroundAgentService.make.pipe(
        Effect.provide(layer),
      );

      const events = yield* service
        .runBackgroundAgent({
          threadId: "thread-1",
          prNumber: 1,
          commentId: "comment-1",
          cwd: "/test/repo",
          prHeadRef: "refs/t3/pr/1/head",
          commentFile: "test.ts",
          commentLine: 42,
          commentBody: "Fix this",
        })
        .pipe(Stream.runCollect);

      const eventsArray = Array.from(events);

      // Should have events (at minimum: PR diff detail, prompt detail, worktree detail,
      // agent detail, changes detail)
      expect(eventsArray.length).toBeGreaterThan(0);

      // Check that status events are present
      const statusEvents = eventsArray.filter((e) => e.type === "status");
      expect(statusEvents.length).toBeGreaterThanOrEqual(1);

      // Should start with "running"
      const firstStatus = statusEvents[0];
      expect(firstStatus?.agentStatus).toBe("running");

      // Check that text/done events are present
      const doneEvents = eventsArray.filter((e) => e.type === "done");
      expect(doneEvents.length).toBe(1);

      // Check detail events contain expected titles
      const titles = eventsArray
        .filter((e) => e.type === "detail")
        .map((e) => e.title);

      expect(titles).toContain("PR Diff Context");
      expect(titles).toContain("Agent Prompt");
      expect(titles).toContain("Worktree Created");
      expect(titles).toContain("Changes Detected");
    }).pipe(Effect.provide(makeTestLayer({
      gitDiff: "diff --git a/test.ts b/test.ts\n+test change",
      gitStatus: "M test.ts\n",
      createWorktreePath: "/tmp/t3-test-worktree",
      createWorktreeRefName: "t3/agent-response-abc12345",
    }))),
  );

  it("updates agentStatus to completed on success", () =>
    Effect.gen(function* () {
      const updateMutation = vi.fn();
      const mockReview = ReviewService.of({
        getDiffPreview: () => Effect.die("unexpected"),
        getReviewDraft: () => Effect.die("unexpected"),
        upsertReviewComment: () => Effect.die("unexpected"),
        deleteReviewComment: () => Effect.die("unexpected"),
        submitReview: () => Effect.die("unexpected"),
        updateCommentAgentStatus: (input: {
          threadId: string;
          prNumber: number;
          commentId: string;
          agentStatus: string;
        }) => {
          updateMutation(input.agentStatus);
          return Effect.succeed(null);
        },
      });

      const layer = Layer.mergeAll(
        Layer.succeed(
          GitWorkflowService,
          GitWorkflowService.of({
            status: () => Effect.die("unexpected"),
            localStatus: () => Effect.die("unexpected"),
            remoteStatus: () => Effect.die("unexpected"),
            invalidateLocalStatus: () => Effect.void,
            invalidateRemoteStatus: () => Effect.void,
            invalidateStatus: () => Effect.void,
            pullCurrentBranch: () => Effect.die("unexpected"),
            runStackedAction: () => Effect.die("unexpected"),
            resolvePullRequest: () => Effect.die("unexpected"),
            preparePullRequestThread: () => Effect.die("unexpected"),
            listRefs: () => Effect.die("unexpected"),
            createWorktree: () =>
              Effect.succeed({
                worktree: { path: "/tmp/test", refName: "test-branch" },
              }),
            removeWorktree: () => Effect.void,
            createRef: () => Effect.die("unexpected"),
            switchRef: () => Effect.die("unexpected"),
            renameBranch: () => Effect.die("unexpected"),
          }),
        ),
        Layer.succeed(
          GitVcsDriver,
          GitVcsDriver.of({
            execute: () => Effect.succeed({ stdout: "", stderr: "", exitCode: 0 }),
            getPrDiff: () => Effect.succeed("test diff"),
            getReviewDiffPreview: () => Effect.die("unexpected"),
            checkoutPullRequest: () => Effect.die("unexpected"),
            refNameAtPath: () => Effect.die("unexpected"),
            listRefs: () => Effect.die("unexpected"),
            createWorktree: () => Effect.die("unexpected"),
            removeWorktree: () => Effect.die("unexpected"),
            createRef: () => Effect.die("unexpected"),
            switchRef: () => Effect.die("unexpected"),
            pullCurrentBranch: () => Effect.die("unexpected"),
            renameBranch: () => Effect.die("unexpected"),
            remoteResolvedHeadSha: () => Effect.die("unexpected"),
            remoteHasCommit: () => Effect.die("unexpected"),
            getPushTarget: () => Effect.die("unexpected"),
            push: () => Effect.die("unexpected"),
            createBranchOnRemote: () => Effect.die("unexpected"),
            getDefaultBranch: () => Effect.die("unexpected"),
            getDefaultBranchName: () => Effect.die("unexpected"),
            currentBranchName: () => Effect.die("unexpected"),
            stashAndPop: () => Effect.die("unexpected"),
            hasUncommittedChanges: () => Effect.die("unexpected"),
            listRefsPage: () => Effect.die("unexpected"),
            resolveCommitPage: () => Effect.die("unexpected"),
            streamStatus: () => Effect.die("unexpected"),
          }),
        ),
        Layer.succeed(ReviewService, mockReview),
      );

      const service = yield* BackgroundAgentService.make.pipe(
        Effect.provide(layer),
      );

      yield* service
        .runBackgroundAgent({
          threadId: "thread-1",
          prNumber: 1,
          commentId: "comment-1",
          cwd: "/test/repo",
          prHeadRef: "refs/heads/main",
          commentFile: "test.ts",
          commentLine: 42,
          commentBody: "Fix this",
        })
        .pipe(Stream.runDrain);

      // Should have been called with "running" first, then "completed"
      expect(updateMutation).toHaveBeenCalledWith("running");
      expect(updateMutation).toHaveBeenCalledWith("completed");
      expect(updateMutation).toHaveBeenCalledTimes(2);
    }).pipe(Effect.provide(
      Layer.mergeAll(
        Layer.succeed(
          GitWorkflowService,
          GitWorkflowService.of({
            status: () => Effect.die("unexpected"),
            localStatus: () => Effect.die("unexpected"),
            remoteStatus: () => Effect.die("unexpected"),
            invalidateLocalStatus: () => Effect.void,
            invalidateRemoteStatus: () => Effect.void,
            invalidateStatus: () => Effect.void,
            pullCurrentBranch: () => Effect.die("unexpected"),
            runStackedAction: () => Effect.die("unexpected"),
            resolvePullRequest: () => Effect.die("unexpected"),
            preparePullRequestThread: () => Effect.die("unexpected"),
            listRefs: () => Effect.die("unexpected"),
            createWorktree: () =>
              Effect.succeed({
                worktree: { path: "/tmp/test", refName: "test-branch" },
              }),
            removeWorktree: () => Effect.void,
            createRef: () => Effect.die("unexpected"),
            switchRef: () => Effect.die("unexpected"),
            renameBranch: () => Effect.die("unexpected"),
          }),
        ),
        Layer.succeed(
          GitVcsDriver,
          GitVcsDriver.of({
            execute: () => Effect.succeed({ stdout: "", stderr: "", exitCode: 0 }),
            getPrDiff: () => Effect.succeed("test diff"),
            getReviewDiffPreview: () => Effect.die("unexpected"),
            checkoutPullRequest: () => Effect.die("unexpected"),
            refNameAtPath: () => Effect.die("unexpected"),
            listRefs: () => Effect.die("unexpected"),
            createWorktree: () => Effect.die("unexpected"),
            removeWorktree: () => Effect.die("unexpected"),
            createRef: () => Effect.die("unexpected"),
            switchRef: () => Effect.die("unexpected"),
            pullCurrentBranch: () => Effect.die("unexpected"),
            renameBranch: () => Effect.die("unexpected"),
            remoteResolvedHeadSha: () => Effect.die("unexpected"),
            remoteHasCommit: () => Effect.die("unexpected"),
            getPushTarget: () => Effect.die("unexpected"),
            push: () => Effect.die("unexpected"),
            createBranchOnRemote: () => Effect.die("unexpected"),
            getDefaultBranch: () => Effect.die("unexpected"),
            getDefaultBranchName: () => Effect.die("unexpected"),
            currentBranchName: () => Effect.die("unexpected"),
            stashAndPop: () => Effect.die("unexpected"),
            hasUncommittedChanges: () => Effect.die("unexpected"),
            listRefsPage: () => Effect.die("unexpected"),
            resolveCommitPage: () => Effect.die("unexpected"),
            streamStatus: () => Effect.die("unexpected"),
          }),
        ),
      ),
    )),
  );

  it("updates agentStatus to failed on createWorktree error", () =>
    Effect.gen(function* () {
      const updateMutation = vi.fn();
      const mockReview = ReviewService.of({
        getDiffPreview: () => Effect.die("unexpected"),
        getReviewDraft: () => Effect.die("unexpected"),
        upsertReviewComment: () => Effect.die("unexpected"),
        deleteReviewComment: () => Effect.die("unexpected"),
        submitReview: () => Effect.die("unexpected"),
        updateCommentAgentStatus: (input: {
          threadId: string;
          prNumber: number;
          commentId: string;
          agentStatus: string;
        }) => {
          updateMutation(input.agentStatus);
          return Effect.succeed(null);
        },
      });

      const layer = Layer.mergeAll(
        Layer.succeed(
          GitWorkflowService,
          GitWorkflowService.of({
            status: () => Effect.die("unexpected"),
            localStatus: () => Effect.die("unexpected"),
            remoteStatus: () => Effect.die("unexpected"),
            invalidateLocalStatus: () => Effect.void,
            invalidateRemoteStatus: () => Effect.void,
            invalidateStatus: () => Effect.void,
            pullCurrentBranch: () => Effect.die("unexpected"),
            runStackedAction: () => Effect.die("unexpected"),
            resolvePullRequest: () => Effect.die("unexpected"),
            preparePullRequestThread: () => Effect.die("unexpected"),
            listRefs: () => Effect.die("unexpected"),
            createWorktree: () =>
              Effect.fail(new Error("Failed to create worktree") as never),
            removeWorktree: () => Effect.void,
            createRef: () => Effect.die("unexpected"),
            switchRef: () => Effect.die("unexpected"),
            renameBranch: () => Effect.die("unexpected"),
          }),
        ),
        Layer.succeed(
          GitVcsDriver,
          GitVcsDriver.of({
            execute: () => Effect.succeed({ stdout: "", stderr: "", exitCode: 0 }),
            getPrDiff: () => Effect.succeed("test diff"),
            getReviewDiffPreview: () => Effect.die("unexpected"),
            checkoutPullRequest: () => Effect.die("unexpected"),
            refNameAtPath: () => Effect.die("unexpected"),
            listRefs: () => Effect.die("unexpected"),
            createWorktree: () => Effect.die("unexpected"),
            removeWorktree: () => Effect.die("unexpected"),
            createRef: () => Effect.die("unexpected"),
            switchRef: () => Effect.die("unexpected"),
            pullCurrentBranch: () => Effect.die("unexpected"),
            renameBranch: () => Effect.die("unexpected"),
            remoteResolvedHeadSha: () => Effect.die("unexpected"),
            remoteHasCommit: () => Effect.die("unexpected"),
            getPushTarget: () => Effect.die("unexpected"),
            push: () => Effect.die("unexpected"),
            createBranchOnRemote: () => Effect.die("unexpected"),
            getDefaultBranch: () => Effect.die("unexpected"),
            getDefaultBranchName: () => Effect.die("unexpected"),
            currentBranchName: () => Effect.die("unexpected"),
            stashAndPop: () => Effect.die("unexpected"),
            hasUncommittedChanges: () => Effect.die("unexpected"),
            listRefsPage: () => Effect.die("unexpected"),
            resolveCommitPage: () => Effect.die("unexpected"),
            streamStatus: () => Effect.die("unexpected"),
          }),
        ),
        Layer.succeed(ReviewService, mockReview),
      );

      const service = yield* BackgroundAgentService.make.pipe(
        Effect.provide(layer),
      );

      const events = yield* service
        .runBackgroundAgent({
          threadId: "thread-1",
          prNumber: 1,
          commentId: "comment-1",
          cwd: "/test/repo",
          prHeadRef: "refs/heads/main",
          commentFile: "test.ts",
          commentLine: 42,
          commentBody: "Fix this",
        })
        .pipe(Stream.runCollect);

      const eventsArray = Array.from(events);

      // Should have failed status
      const failedStatus = eventsArray.find(
        (e) => e.type === "status" && e.agentStatus === "failed",
      );
      expect(failedStatus).toBeDefined();

      // Should call updateCommentAgentStatus with "running" and "failed"
      expect(updateMutation).toHaveBeenCalledWith("running");
      expect(updateMutation).toHaveBeenCalledWith("failed");
    }).pipe(Effect.provide(
      Layer.mergeAll(
        Layer.succeed(
          GitWorkflowService,
          GitWorkflowService.of({
            status: () => Effect.die("unexpected"),
            localStatus: () => Effect.die("unexpected"),
            remoteStatus: () => Effect.die("unexpected"),
            invalidateLocalStatus: () => Effect.void,
            invalidateRemoteStatus: () => Effect.void,
            invalidateStatus: () => Effect.void,
            pullCurrentBranch: () => Effect.die("unexpected"),
            runStackedAction: () => Effect.die("unexpected"),
            resolvePullRequest: () => Effect.die("unexpected"),
            preparePullRequestThread: () => Effect.die("unexpected"),
            listRefs: () => Effect.die("unexpected"),
            createWorktree: () =>
              Effect.fail(new Error("Failed to create worktree") as never),
            removeWorktree: () => Effect.void,
            createRef: () => Effect.die("unexpected"),
            switchRef: () => Effect.die("unexpected"),
            renameBranch: () => Effect.die("unexpected"),
          }),
        ),
        Layer.succeed(
          GitVcsDriver,
          GitVcsDriver.of({
            execute: () => Effect.succeed({ stdout: "", stderr: "", exitCode: 0 }),
            getPrDiff: () => Effect.succeed("test diff"),
            getReviewDiffPreview: () => Effect.die("unexpected"),
            checkoutPullRequest: () => Effect.die("unexpected"),
            refNameAtPath: () => Effect.die("unexpected"),
            listRefs: () => Effect.die("unexpected"),
            createWorktree: () => Effect.die("unexpected"),
            removeWorktree: () => Effect.die("unexpected"),
            createRef: () => Effect.die("unexpected"),
            switchRef: () => Effect.die("unexpected"),
            pullCurrentBranch: () => Effect.die("unexpected"),
            renameBranch: () => Effect.die("unexpected"),
            remoteResolvedHeadSha: () => Effect.die("unexpected"),
            remoteHasCommit: () => Effect.die("unexpected"),
            getPushTarget: () => Effect.die("unexpected"),
            push: () => Effect.die("unexpected"),
            createBranchOnRemote: () => Effect.die("unexpected"),
            getDefaultBranch: () => Effect.die("unexpected"),
            getDefaultBranchName: () => Effect.die("unexpected"),
            currentBranchName: () => Effect.die("unexpected"),
            stashAndPop: () => Effect.die("unexpected"),
            hasUncommittedChanges: () => Effect.die("unexpected"),
            listRefsPage: () => Effect.die("unexpected"),
            resolveCommitPage: () => Effect.die("unexpected"),
            streamStatus: () => Effect.die("unexpected"),
          }),
        ),
      ),
    )),
  );
});
