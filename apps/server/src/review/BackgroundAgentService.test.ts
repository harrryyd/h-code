import { describe, it, expect, vi, beforeEach, afterEach } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import type { BackgroundAgentResponseEvent } from "@t3tools/contracts";

import { BackgroundAgentService } from "./BackgroundAgentService.ts";
import { GitWorkflowService } from "../git/GitWorkflowService.ts";
import { GitVcsDriver } from "../vcs/GitVcsDriver.ts";
import { ReviewService } from "./ReviewService.ts";

vi.mock("node:fs/promises", () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

import * as fs from "node:fs/promises";
import * as child_process from "node:child_process";

function makeFakeChildProcess() {
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
  return {
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event]!.push(cb);
    }),
    _emitClose: (code: number) => {
      for (const cb of listeners.close ?? []) cb(code);
    },
    _emitError: () => {
      for (const cb of listeners.error ?? []) cb(new Error("spawn error"));
    },
  };
}

function makeBaseGitWorkflow(options: {
  readonly createWorktreePath: string;
  readonly createWorktreeRefName: string;
  readonly createWorktreeError?: Error;
}) {
  return GitWorkflowService.of({
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
      if (options.createWorktreeError) {
        return Effect.fail(options.createWorktreeError as never);
      }
      return Effect.succeed({
        worktree: {
          path: options.createWorktreePath,
          refName: options.createWorktreeRefName,
        },
      });
    },
    removeWorktree: () => Effect.void,
    createRef: () => Effect.die("unexpected"),
    switchRef: () => Effect.die("unexpected"),
    renameBranch: () => Effect.die("unexpected"),
  });
}

function makeBaseGit(gitDiff: string, gitStatus: string) {
  return GitVcsDriver.of({
    execute: (args: { operation: string; cwd: string; args: string[] }) => {
      const argStr = args.args.join(" ");
      if (argStr.includes("status --porcelain")) {
        return Effect.succeed({ stdout: gitStatus, stderr: "", exitCode: 0 });
      }
      return Effect.succeed({ stdout: "", stderr: "", exitCode: 0 });
    },
    getPrDiff: () => Effect.succeed(gitDiff),
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
}

function makeBaseReview(updateMutation: ReturnType<typeof vi.fn> = vi.fn()) {
  updateMutation.mockReturnValue(Effect.succeed(null));
  return ReviewService.of({
    getDiffPreview: () => Effect.die("unexpected"),
    getReviewDraft: () => Effect.die("unexpected"),
    upsertReviewComment: () => Effect.die("unexpected"),
    deleteReviewComment: () => Effect.die("unexpected"),
    submitReview: () => Effect.die("unexpected"),
    updateCommentAgentStatus: updateMutation as never,
  });
}

function makeLayer(options: {
  readonly gitDiff: string;
  readonly gitStatus: string;
  readonly createWorktreePath: string;
  readonly createWorktreeRefName: string;
  readonly createWorktreeError?: Error;
  readonly updateMutation?: ReturnType<typeof vi.fn>;
}) {
  const updateMutation = options.updateMutation ?? vi.fn();
  return {
    layer: Layer.mergeAll(
      Layer.succeed(GitWorkflowService, makeBaseGitWorkflow({
        createWorktreePath: options.createWorktreePath,
        createWorktreeRefName: options.createWorktreeRefName,
        createWorktreeError: options.createWorktreeError,
      })),
      Layer.succeed(GitVcsDriver, makeBaseGit(options.gitDiff, options.gitStatus)),
      Layer.succeed(ReviewService, makeBaseReview(updateMutation)),
    ),
    updateMutation,
  };
}

/** Collect stream events and close the fake child process, all within Effect */
function runAndCollect(options: {
  readonly service: BackgroundAgentService;
  readonly input: Parameters<BackgroundAgentService["runBackgroundAgent"]>[0];
  readonly fakeChild: ReturnType<typeof makeFakeChildProcess>;
  readonly exitCode: number;
}) {
  return Effect.gen(function* () {
    const collectEffect = Effect.runPromise(
      options.service.runBackgroundAgent(options.input).pipe(Stream.runCollect),
    );

    // Let microtasks drain so the spawn callback fires
    yield* Effect.promise(() => new Promise((r) => setTimeout(r, 10)));
    options.fakeChild._emitClose(options.exitCode);

    const events = yield* Effect.promise(() => collectEffect);
    return Array.from(events);
  });
}

describe("BackgroundAgentService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("runs agent on success path, commits changes, and completes", () =>
    Effect.gen(function* () {
      const fakeChild = makeFakeChildProcess();
      vi.mocked(child_process.spawn).mockReturnValue(fakeChild as ReturnType<typeof child_process.spawn>);

      const { layer } = makeLayer({
        gitDiff: "diff --git a/test.ts b/test.ts\n+test change",
        gitStatus: "M test.ts\n",
        createWorktreePath: "/tmp/t3-test-worktree",
        createWorktreeRefName: "t3/agent-response-abc12345",
      });

      const service = yield* BackgroundAgentService.make.pipe(Effect.provide(layer));

      const eventsArray = yield* runAndCollect({
        service,
        input: {
          threadId: "thread-1",
          prNumber: 1,
          commentId: "comment-1",
          cwd: "/test/repo",
          prHeadRef: "refs/t3/pr/1/head",
          commentFile: "test.ts",
          commentLine: 42,
          commentBody: "Fix this",
        },
        fakeChild,
        exitCode: 0,
      });

      expect(eventsArray.length).toBeGreaterThan(0);

      const statusEvents = eventsArray.filter((e) => e.type === "status");
      expect(statusEvents.length).toBeGreaterThanOrEqual(2);

      const firstStatus = statusEvents[0];
      expect(firstStatus?.agentStatus).toBe("running");

      const lastStatus = statusEvents[statusEvents.length - 1];
      expect(lastStatus?.agentStatus).toBe("completed");

      const doneEvents = eventsArray.filter((e) => e.type === "done");
      expect(doneEvents.length).toBe(1);

      const titles = eventsArray
        .filter((e) => e.type === "detail")
        .map((e) => e.title);

      expect(titles).toContain("PR Diff Context");
      expect(titles).toContain("Agent Prompt");
      expect(titles).toContain("Worktree Created");
      expect(titles).toContain("Changes Detected");
      expect(titles).toContain("Pushed");

      expect(fs.writeFile).toHaveBeenCalled();
    }).pipe(Effect.provide(
      makeLayer({
        gitDiff: "diff --git a/test.ts b/test.ts\n+test change",
        gitStatus: "M test.ts\n",
        createWorktreePath: "/tmp/t3-test-worktree",
        createWorktreeRefName: "t3/agent-response-abc12345",
      }).layer,
    )),
  );

  it("updates agentStatus to completed on success", () =>
    Effect.gen(function* () {
      const fakeChild = makeFakeChildProcess();
      vi.mocked(child_process.spawn).mockReturnValue(fakeChild as ReturnType<typeof child_process.spawn>);

      const updateMutation = vi.fn();
      const { layer } = makeLayer({
        gitDiff: "test diff",
        gitStatus: "M test.ts\n",
        createWorktreePath: "/tmp/test",
        createWorktreeRefName: "test-branch",
        updateMutation,
      });

      const service = yield* BackgroundAgentService.make.pipe(Effect.provide(layer));

      yield* runAndCollect({
        service,
        input: {
          threadId: "thread-1",
          prNumber: 1,
          commentId: "comment-1",
          cwd: "/test/repo",
          prHeadRef: "refs/heads/main",
          commentFile: "test.ts",
          commentLine: 42,
          commentBody: "Fix this",
        },
        fakeChild,
        exitCode: 0,
      });

      expect(updateMutation).toHaveBeenCalledWith(
        expect.objectContaining({ agentStatus: "running" }),
      );
      expect(updateMutation).toHaveBeenCalledWith(
        expect.objectContaining({ agentStatus: "completed" }),
      );
      expect(updateMutation).toHaveBeenCalledTimes(2);
    }).pipe(Effect.provide(
      makeLayer({
        gitDiff: "test diff",
        gitStatus: "M test.ts\n",
        createWorktreePath: "/tmp/test",
        createWorktreeRefName: "test-branch",
      }).layer,
    )),
  );

  it("handles no changes from agent (no commits)", () =>
    Effect.gen(function* () {
      const fakeChild = makeFakeChildProcess();
      vi.mocked(child_process.spawn).mockReturnValue(fakeChild as ReturnType<typeof child_process.spawn>);

      const updateMutation = vi.fn();
      const { layer } = makeLayer({
        gitDiff: "test diff",
        gitStatus: "",
        createWorktreePath: "/tmp/test",
        createWorktreeRefName: "test-branch",
        updateMutation,
      });

      const service = yield* BackgroundAgentService.make.pipe(Effect.provide(layer));

      const eventsArray = yield* runAndCollect({
        service,
        input: {
          threadId: "thread-1",
          prNumber: 1,
          commentId: "comment-1",
          cwd: "/test/repo",
          prHeadRef: "refs/heads/main",
          commentFile: "test.ts",
          commentLine: 42,
          commentBody: "Fix this",
        },
        fakeChild,
        exitCode: 0,
      });

      const titles = eventsArray
        .filter((e) => e.type === "detail")
        .map((e) => e.title);

      expect(titles).toContain("No Changes");
      expect(titles).not.toContain("Changes Detected");
      expect(titles).not.toContain("Pushed");

      expect(updateMutation).toHaveBeenCalledWith(
        expect.objectContaining({ agentStatus: "completed" }),
      );
    }).pipe(Effect.provide(
      makeLayer({
        gitDiff: "test diff",
        gitStatus: "",
        createWorktreePath: "/tmp/test",
        createWorktreeRefName: "test-branch",
      }).layer,
    )),
  );

  it("updates agentStatus to failed on createWorktree error", () =>
    Effect.gen(function* () {
      const fakeChild = makeFakeChildProcess();
      vi.mocked(child_process.spawn).mockReturnValue(fakeChild as ReturnType<typeof child_process.spawn>);

      const updateMutation = vi.fn();
      const { layer } = makeLayer({
        gitDiff: "test diff",
        gitStatus: "M test.ts\n",
        createWorktreePath: "/tmp/test",
        createWorktreeRefName: "test-branch",
        createWorktreeError: new Error("Failed to create worktree"),
        updateMutation,
      });

      const service = yield* BackgroundAgentService.make.pipe(Effect.provide(layer));

      const eventsArray = yield* runAndCollect({
        service,
        input: {
          threadId: "thread-1",
          prNumber: 1,
          commentId: "comment-1",
          cwd: "/test/repo",
          prHeadRef: "refs/heads/main",
          commentFile: "test.ts",
          commentLine: 42,
          commentBody: "Fix this",
        },
        fakeChild,
        exitCode: 0,
      });

      const failedStatus = eventsArray.find(
        (e) => e.type === "status" && e.agentStatus === "failed",
      );
      expect(failedStatus).toBeDefined();

      // Should not reach spawn since createWorktree failed
      expect(child_process.spawn).not.toHaveBeenCalled();

      expect(updateMutation).toHaveBeenCalledWith(
        expect.objectContaining({ agentStatus: "running" }),
      );
      expect(updateMutation).toHaveBeenCalledWith(
        expect.objectContaining({ agentStatus: "failed" }),
      );
    }).pipe(Effect.provide(
      makeLayer({
        gitDiff: "test diff",
        gitStatus: "M test.ts\n",
        createWorktreePath: "/tmp/test",
        createWorktreeRefName: "test-branch",
        createWorktreeError: new Error("Failed to create worktree"),
      }).layer,
    )),
  );

  it("updates agentStatus to failed when agent exits with non-zero code", () =>
    Effect.gen(function* () {
      const fakeChild = makeFakeChildProcess();
      vi.mocked(child_process.spawn).mockReturnValue(fakeChild as ReturnType<typeof child_process.spawn>);

      const updateMutation = vi.fn();
      const { layer } = makeLayer({
        gitDiff: "test diff",
        gitStatus: "",
        createWorktreePath: "/tmp/test",
        createWorktreeRefName: "test-branch",
        updateMutation,
      });

      const service = yield* BackgroundAgentService.make.pipe(Effect.provide(layer));

      yield* runAndCollect({
        service,
        input: {
          threadId: "thread-1",
          prNumber: 1,
          commentId: "comment-1",
          cwd: "/test/repo",
          prHeadRef: "refs/heads/main",
          commentFile: "test.ts",
          commentLine: 42,
          commentBody: "Fix this",
        },
        fakeChild,
        exitCode: 1,
      });

      expect(child_process.spawn).toHaveBeenCalled();
      expect(updateMutation).toHaveBeenCalledWith(
        expect.objectContaining({ agentStatus: "running" }),
      );
    }).pipe(Effect.provide(
      makeLayer({
        gitDiff: "test diff",
        gitStatus: "",
        createWorktreePath: "/tmp/test",
        createWorktreeRefName: "test-branch",
      }).layer,
    )),
  );

  it("uses origin/HEAD as base ref for PR diff", () =>
    Effect.gen(function* () {
      const fakeChild = makeFakeChildProcess();
      vi.mocked(child_process.spawn).mockReturnValue(fakeChild as ReturnType<typeof child_process.spawn>);

      let capturedBaseRef = "";
      let capturedHeadRef = "";

      const gitWithSpy = GitVcsDriver.of({
        execute: () => Effect.succeed({ stdout: "", stderr: "", exitCode: 0 }),
        getPrDiff: (cwd: string, baseRef: string, headRef: string) => {
          capturedBaseRef = baseRef;
          capturedHeadRef = headRef;
          return Effect.succeed("test diff");
        },
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

      const layer = Layer.mergeAll(
        Layer.succeed(GitWorkflowService, makeBaseGitWorkflow({
          createWorktreePath: "/tmp/test",
          createWorktreeRefName: "test-branch",
        })),
        Layer.succeed(GitVcsDriver, gitWithSpy),
        Layer.succeed(ReviewService, makeBaseReview()),
      );

      const service = yield* BackgroundAgentService.make.pipe(Effect.provide(layer));

      yield* runAndCollect({
        service,
        input: {
          threadId: "thread-1",
          prNumber: 1,
          commentId: "comment-1",
          cwd: "/test/repo",
          prHeadRef: "refs/t3/pr/1/head",
          commentFile: "test.ts",
          commentLine: 42,
          commentBody: "Fix this",
        },
        fakeChild,
        exitCode: 0,
      });

      expect(capturedBaseRef).toBe("origin/HEAD");
      expect(capturedHeadRef).toBe("refs/t3/pr/1/head");
    }).pipe(Effect.provide(
      Layer.mergeAll(
        Layer.succeed(GitWorkflowService, makeBaseGitWorkflow({
          createWorktreePath: "/tmp/test",
          createWorktreeRefName: "test-branch",
        })),
        Layer.succeed(
          GitVcsDriver,
          GitVcsDriver.of({
            execute: () => Effect.succeed({ stdout: "", stderr: "", exitCode: 0 }),
            getPrDiff: (cwd: string, baseRef: string, headRef: string) => {
              expect(baseRef).toBe("origin/HEAD");
              expect(headRef).toBe("refs/t3/pr/1/head");
              return Effect.succeed("test diff");
            },
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
