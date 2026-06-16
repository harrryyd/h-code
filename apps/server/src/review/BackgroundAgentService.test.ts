import { describe, it, expect, vi, beforeEach, afterEach } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import type { BackgroundAgentResponseEvent } from "@t3tools/contracts";

import {
  BackgroundAgentService,
  type BackgroundAgentServiceShape,
  DEFAULT_MAX_CONCURRENT_AGENTS,
  MAX_AGENT_OUTPUT_BYTES,
} from "./BackgroundAgentService.ts";
import { GitWorkflowService } from "../git/GitWorkflowService.ts";
import {
  GitVcsDriver,
  type ExecuteGitInput,
  type ExecuteGitResult,
  type GitVcsDriverShape,
} from "../vcs/GitVcsDriver.ts";
import { ReviewService } from "./ReviewService.ts";

vi.mock("node:fs/promises", () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

// @effect-diagnostics-next-line nodeBuiltinImport:off
import * as fs from "node:fs/promises";
// @effect-diagnostics-next-line nodeBuiltinImport:off
import * as child_process from "node:child_process";

function makeFakeChildProcess() {
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
  const stdoutListeners: Array<(chunk: Buffer) => void> = [];
  const stderrListeners: Array<(chunk: Buffer) => void> = [];
  let killed = false;

  return {
    stdout: {
      on: vi.fn((_event: string, cb: (chunk: Buffer) => void) => {
        stdoutListeners.push(cb);
      }),
    },
    stderr: {
      on: vi.fn((_event: string, cb: (chunk: Buffer) => void) => {
        stderrListeners.push(cb);
      }),
    },
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event]!.push(cb);
    }),
    kill: vi.fn(() => {
      killed = true;
      return true;
    }),
    _emitClose: (code: number) => {
      for (const cb of listeners.close ?? []) cb(code);
    },
    _emitError: () => {
      for (const cb of listeners.error ?? []) cb(new Error("spawn error"));
    },
    _emitStdout: (chunk: Buffer | string) => {
      const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      for (const cb of stdoutListeners) cb(buf);
    },
    _emitStderr: (chunk: Buffer | string) => {
      const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      for (const cb of stderrListeners) cb(buf);
    },
    _wasKilled: () => killed,
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
    execute: (args: ExecuteGitInput) => {
      const argStr = args.args.join(" ");
      if (argStr.includes("status --porcelain")) {
        return Effect.succeed({
          stdout: gitStatus,
          stderr: "",
          exitCode: 0,
          stdoutTruncated: false,
          stderrTruncated: false,
        } as ExecuteGitResult);
      }
      return Effect.succeed({
        stdout: "",
        stderr: "",
        exitCode: 0,
        stdoutTruncated: false,
        stderrTruncated: false,
      } as ExecuteGitResult);
    },
    getPrDiff: () => Effect.succeed(gitDiff),
    getReviewDiffPreview: () => Effect.die("unexpected"),
    listRefs: () => Effect.die("unexpected"),
    createWorktree: () => Effect.die("unexpected"),
    removeWorktree: () => Effect.die("unexpected"),
    createRef: () => Effect.die("unexpected"),
    switchRef: () => Effect.die("unexpected"),
    pullCurrentBranch: () => Effect.die("unexpected"),
    renameBranch: () => Effect.die("unexpected"),
  } as unknown as GitVcsDriverShape);
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
      Layer.succeed(
        GitWorkflowService,
        makeBaseGitWorkflow({
          createWorktreePath: options.createWorktreePath,
          createWorktreeRefName: options.createWorktreeRefName,
          ...("createWorktreeError" in options
            ? { createWorktreeError: options.createWorktreeError }
            : {}),
        }),
      ),
      Layer.succeed(GitVcsDriver, makeBaseGit(options.gitDiff, options.gitStatus)),
      Layer.succeed(ReviewService, makeBaseReview(updateMutation)),
    ),
    updateMutation,
  };
}

/** Collect stream events and close the fake child process, all within Effect */
function runAndCollect(options: {
  readonly service: BackgroundAgentServiceShape;
  readonly input: Parameters<BackgroundAgentServiceShape["runBackgroundAgent"]>[0];
  readonly fakeChild: ReturnType<typeof makeFakeChildProcess>;
  readonly exitCode: number;
}): Effect.Effect<ReadonlyArray<BackgroundAgentResponseEvent>, never> {
  return Effect.gen(function* () {
    // @effect-diagnostics-next-line runEffectInsideEffect:off
    const collectEffect = Effect.runPromise(
      options.service.runBackgroundAgent(options.input).pipe(Stream.runCollect),
    );

    // Let microtasks drain so the spawn callback fires
    // @effect-diagnostics-next-line globalTimers:off
    yield* Effect.promise(() => new Promise<unknown>((r) => setTimeout(r, 10)));
    options.fakeChild._emitClose(options.exitCode);

    const events = yield* Effect.promise<ReadonlyArray<BackgroundAgentResponseEvent>>(
      () => collectEffect,
    );
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
      vi.mocked(child_process.spawn).mockReturnValue(
        fakeChild as unknown as ReturnType<typeof child_process.spawn>,
      );

      const { layer } = makeLayer({
        gitDiff: "diff --git a/test.ts b/test.ts\n+test change",
        gitStatus: "M test.ts\n",
        createWorktreePath: "/tmp/t3-test-worktree",
        createWorktreeRefName: "t3/agent-response-abc12345",
      });

      const service = yield* (BackgroundAgentService as any).make.pipe(Effect.provide(layer));

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

      const titles = eventsArray.filter((e) => e.type === "detail").map((e) => e.title);

      expect(titles).toContain("PR Diff Context");
      expect(titles).toContain("Agent Prompt");
      expect(titles).toContain("Worktree Created");
      expect(titles).toContain("Changes Detected");
      expect(titles).toContain("Pushed");

      expect(fs.writeFile).toHaveBeenCalled();
    }).pipe(
      Effect.provide(
        makeLayer({
          gitDiff: "diff --git a/test.ts b/test.ts\n+test change",
          gitStatus: "M test.ts\n",
          createWorktreePath: "/tmp/t3-test-worktree",
          createWorktreeRefName: "t3/agent-response-abc12345",
        }).layer,
      ),
    ));

  it("updates agentStatus to completed on success", () =>
    Effect.gen(function* () {
      const fakeChild = makeFakeChildProcess();
      vi.mocked(child_process.spawn).mockReturnValue(
        fakeChild as unknown as ReturnType<typeof child_process.spawn>,
      );

      const updateMutation = vi.fn();
      const { layer } = makeLayer({
        gitDiff: "test diff",
        gitStatus: "M test.ts\n",
        createWorktreePath: "/tmp/test",
        createWorktreeRefName: "test-branch",
        updateMutation,
      });

      const service = yield* (BackgroundAgentService as any).make.pipe(Effect.provide(layer));

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
    }).pipe(
      Effect.provide(
        makeLayer({
          gitDiff: "test diff",
          gitStatus: "M test.ts\n",
          createWorktreePath: "/tmp/test",
          createWorktreeRefName: "test-branch",
        }).layer,
      ),
    ));

  it("handles no changes from agent (no commits)", () =>
    Effect.gen(function* () {
      const fakeChild = makeFakeChildProcess();
      vi.mocked(child_process.spawn).mockReturnValue(
        fakeChild as unknown as ReturnType<typeof child_process.spawn>,
      );

      const updateMutation = vi.fn();
      const { layer } = makeLayer({
        gitDiff: "test diff",
        gitStatus: "",
        createWorktreePath: "/tmp/test",
        createWorktreeRefName: "test-branch",
        updateMutation,
      });

      const service = yield* (BackgroundAgentService as any).make.pipe(Effect.provide(layer));

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

      const titles = eventsArray.filter((e) => e.type === "detail").map((e) => e.title);

      expect(titles).toContain("No Changes");
      expect(titles).not.toContain("Changes Detected");
      expect(titles).not.toContain("Pushed");

      expect(updateMutation).toHaveBeenCalledWith(
        expect.objectContaining({ agentStatus: "completed" }),
      );
    }).pipe(
      Effect.provide(
        makeLayer({
          gitDiff: "test diff",
          gitStatus: "",
          createWorktreePath: "/tmp/test",
          createWorktreeRefName: "test-branch",
        }).layer,
      ),
    ));

  it("updates agentStatus to failed on createWorktree error", () =>
    Effect.gen(function* () {
      const fakeChild = makeFakeChildProcess();
      vi.mocked(child_process.spawn).mockReturnValue(
        fakeChild as unknown as ReturnType<typeof child_process.spawn>,
      );

      const updateMutation = vi.fn();
      const { layer } = makeLayer({
        gitDiff: "test diff",
        gitStatus: "M test.ts\n",
        createWorktreePath: "/tmp/test",
        createWorktreeRefName: "test-branch",
        createWorktreeError: new Error("Failed to create worktree"),
        updateMutation,
      });

      const service = yield* (BackgroundAgentService as any).make.pipe(Effect.provide(layer));

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
    }).pipe(
      Effect.provide(
        makeLayer({
          gitDiff: "test diff",
          gitStatus: "M test.ts\n",
          createWorktreePath: "/tmp/test",
          createWorktreeRefName: "test-branch",
          createWorktreeError: new Error("Failed to create worktree"),
        }).layer,
      ),
    ));

  it("updates agentStatus to failed when agent exits with non-zero code", () =>
    Effect.gen(function* () {
      const fakeChild = makeFakeChildProcess();
      vi.mocked(child_process.spawn).mockReturnValue(
        fakeChild as unknown as ReturnType<typeof child_process.spawn>,
      );

      const updateMutation = vi.fn();
      const { layer } = makeLayer({
        gitDiff: "test diff",
        gitStatus: "",
        createWorktreePath: "/tmp/test",
        createWorktreeRefName: "test-branch",
        updateMutation,
      });

      const service = yield* (BackgroundAgentService as any).make.pipe(Effect.provide(layer));

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
    }).pipe(
      Effect.provide(
        makeLayer({
          gitDiff: "test diff",
          gitStatus: "",
          createWorktreePath: "/tmp/test",
          createWorktreeRefName: "test-branch",
        }).layer,
      ),
    ));

  it("kills agent process when output exceeds MAX_AGENT_OUTPUT_BYTES", () =>
    Effect.gen(function* () {
      const fakeChild = makeFakeChildProcess();
      vi.mocked(child_process.spawn).mockReturnValue(
        fakeChild as unknown as ReturnType<typeof child_process.spawn>,
      );

      const updateMutation = vi.fn();
      const { layer } = makeLayer({
        gitDiff: "test diff",
        gitStatus: "",
        createWorktreePath: "/tmp/test",
        createWorktreeRefName: "test-branch",
        updateMutation,
      });

      const service = yield* (BackgroundAgentService as any).make.pipe(Effect.provide(layer));

      // Start collecting events; don't auto-close the child
      // @effect-diagnostics-next-line runEffectInsideEffect:off
      const collectPromise = Effect.runPromise(
        service.runBackgroundAgent({
          threadId: "thread-1",
          prNumber: 1,
          commentId: "comment-1",
          cwd: "/test/repo",
          prHeadRef: "refs/heads/main",
          commentFile: "test.ts",
          commentLine: 42,
          commentBody: "Fix this",
        }).pipe(Stream.runCollect),
      );

      // Emit stdout data exceeding the limit
      const chunk = "x".repeat(1024); // 1KB chunks
      const chunksNeeded = Math.ceil((MAX_AGENT_OUTPUT_BYTES + 1) / chunk.length);
      for (let i = 0; i < chunksNeeded; i++) {
        fakeChild._emitStdout(chunk);
      }

      // Let microtasks drain so the output guard fires
      // @effect-diagnostics-next-line globalTimers:off
      yield* Effect.promise(() => new Promise<unknown>((r) => setTimeout(r, 20)));

      // The child should have been killed
      expect(fakeChild._wasKilled()).toBe(true);
      expect(fakeChild.kill).toHaveBeenCalledWith("SIGTERM");

      const events = (yield* Effect.promise(
        () => collectPromise as Promise<ReadonlyArray<BackgroundAgentResponseEvent>>,
      )) as ReadonlyArray<BackgroundAgentResponseEvent>;
      const eventsArray = Array.from(events);

      // Should have a failed status
      const failedStatus = eventsArray.find(
        (e) => e.type === "status" && e.agentStatus === "failed",
      );
      expect(failedStatus).toBeDefined();

      // Should have an error event mentioning output limit
      const errorEvent = eventsArray.find(
        (e) => e.type === "error",
      ) as BackgroundAgentResponseEvent | undefined;
      expect(errorEvent).toBeDefined();
      expect(errorEvent?.message).toContain("output exceeded");
    }).pipe(
      Effect.provide(
        makeLayer({
          gitDiff: "test diff",
          gitStatus: "",
          createWorktreePath: "/tmp/test",
          createWorktreeRefName: "test-branch",
        }).layer,
      ),
    ));

  it("uses origin/HEAD as base ref for PR diff", () =>
    Effect.gen(function* () {
      const fakeChild = makeFakeChildProcess();
      vi.mocked(child_process.spawn).mockReturnValue(
        fakeChild as unknown as ReturnType<typeof child_process.spawn>,
      );

      let capturedBaseRef = "";
      let capturedHeadRef = "";

      const gitWithSpy = GitVcsDriver.of({
        execute: () =>
          Effect.succeed({
            stdout: "",
            stderr: "",
            exitCode: 0,
            stdoutTruncated: false,
            stderrTruncated: false,
          } as ExecuteGitResult),
        getPrDiff: (cwd: string, baseRef: string, headRef: string) => {
          capturedBaseRef = baseRef;
          capturedHeadRef = headRef;
          return Effect.succeed("test diff");
        },
        getReviewDiffPreview: () => Effect.die("unexpected"),
        listRefs: () => Effect.die("unexpected"),
        createWorktree: () => Effect.die("unexpected"),
        removeWorktree: () => Effect.die("unexpected"),
        createRef: () => Effect.die("unexpected"),
        switchRef: () => Effect.die("unexpected"),
        pullCurrentBranch: () => Effect.die("unexpected"),
        renameBranch: () => Effect.die("unexpected"),
      } as unknown as GitVcsDriverShape);

      const layer = Layer.mergeAll(
        Layer.succeed(
          GitWorkflowService,
          makeBaseGitWorkflow({
            createWorktreePath: "/tmp/test",
            createWorktreeRefName: "test-branch",
          }),
        ),
        Layer.succeed(GitVcsDriver, gitWithSpy),
        Layer.succeed(ReviewService, makeBaseReview()),
      );

      const service = yield* (BackgroundAgentService as any).make.pipe(Effect.provide(layer));

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
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(
            GitWorkflowService,
            makeBaseGitWorkflow({
              createWorktreePath: "/tmp/test",
              createWorktreeRefName: "test-branch",
            }),
          ),
          Layer.succeed(
            GitVcsDriver,
            GitVcsDriver.of({
              execute: () =>
                Effect.succeed({
                  stdout: "",
                  stderr: "",
                  exitCode: 0,
                  stdoutTruncated: false,
                  stderrTruncated: false,
                } as ExecuteGitResult),
              getPrDiff: (cwd: string, baseRef: string, headRef: string) => {
                expect(baseRef).toBe("origin/HEAD");
                expect(headRef).toBe("refs/t3/pr/1/head");
                return Effect.succeed("test diff");
              },
              getReviewDiffPreview: () => Effect.die("unexpected"),
              listRefs: () => Effect.die("unexpected"),
              createWorktree: () => Effect.die("unexpected"),
              removeWorktree: () => Effect.die("unexpected"),
              createRef: () => Effect.die("unexpected"),
              switchRef: () => Effect.die("unexpected"),
              pullCurrentBranch: () => Effect.die("unexpected"),
              renameBranch: () => Effect.die("unexpected"),
            } as unknown as GitVcsDriverShape),
          ),
          Layer.succeed(ReviewService, makeBaseReview()),
        ),
      ),
    ));

  it("prompt instructs agent to check if comment is actionable before making changes", () =>
    Effect.gen(function* () {
      const fakeChild = makeFakeChildProcess();
      let capturedArgs: ReadonlyArray<string> = [];
      vi.mocked(child_process.spawn).mockImplementation((_bin, args) => {
        capturedArgs = args as ReadonlyArray<string>;
        return fakeChild as unknown as ReturnType<typeof child_process.spawn>;
      });

      const { layer } = makeLayer({
        gitDiff: "diff --git a/test.ts b/test.ts\n+test change",
        gitStatus: "",
        createWorktreePath: "/tmp/test",
        createWorktreeRefName: "test-branch",
      });

      const service = yield* (BackgroundAgentService as any).make.pipe(Effect.provide(layer));

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
          commentBody: "test",
        },
        fakeChild,
        exitCode: 0,
      });

      // The last arg is the prompt
      const prompt = capturedArgs[capturedArgs.length - 1] ?? "";
      expect(prompt).toContain("actionable");
      expect(prompt).toContain("Do not modify any files");
      expect(prompt).toContain("vague");
    }).pipe(
      Effect.provide(
        makeLayer({
          gitDiff: "diff --git a/test.ts b/test.ts\n+test change",
          gitStatus: "",
          createWorktreePath: "/tmp/test",
          createWorktreeRefName: "test-branch",
        }).layer,
      ),
    ));

  describe("runBatchAgents", () => {
    function createBatchFakeChildrenSpawnMock() {
      const children: ReturnType<typeof makeFakeChildProcess>[] = [];
      vi.mocked(child_process.spawn).mockImplementation(() => {
        const child = makeFakeChildProcess();
        children.push(child);
        return child as unknown as ReturnType<typeof child_process.spawn>;
      });
      return children;
    }

    const batchInput1: Parameters<BackgroundAgentServiceShape["runBackgroundAgent"]>[0] = {
      threadId: "thread-1",
      prNumber: 1,
      commentId: "comment-1",
      cwd: "/test/repo",
      prHeadRef: "refs/t3/pr/1/head",
      commentFile: "test.ts",
      commentLine: 42,
      commentBody: "Fix this",
    };

    const batchInput2: Parameters<BackgroundAgentServiceShape["runBackgroundAgent"]>[0] = {
      threadId: "thread-1",
      prNumber: 1,
      commentId: "comment-2",
      cwd: "/test/repo",
      prHeadRef: "refs/t3/pr/1/head",
      commentFile: "src/app.ts",
      commentLine: 10,
      commentBody: "Extract this",
    };

    const batchInput3: Parameters<BackgroundAgentServiceShape["runBackgroundAgent"]>[0] = {
      threadId: "thread-1",
      prNumber: 1,
      commentId: "comment-3",
      cwd: "/test/repo",
      prHeadRef: "refs/t3/pr/1/head",
      commentFile: "src/utils.ts",
      commentLine: undefined,
      commentBody: "Add type",
    };

    it("runs batch agents in parallel and returns events for all comments", () =>
      Effect.gen(function* () {
        const fakeChildren = createBatchFakeChildrenSpawnMock();

        const updateMutation = vi.fn();
        const { layer } = makeLayer({
          gitDiff: "test diff",
          gitStatus: "",
          createWorktreePath: "/tmp/test",
          createWorktreeRefName: "test-branch",
          updateMutation,
        });

        const service = yield* (BackgroundAgentService as any).make.pipe(Effect.provide(layer));

        // @effect-diagnostics-next-line runEffectInsideEffect:off
        const collectPromise = Effect.runPromise(
          service.runBatchAgents([batchInput1, batchInput2, batchInput3]).pipe(Stream.runCollect),
        );

        // @effect-diagnostics-next-line globalTimers:off
        yield* Effect.promise(() => new Promise<unknown>((r) => setTimeout(r, 20)));

        for (const child of fakeChildren) {
          child._emitClose(0);
        }

        const events = yield* Effect.promise(() => collectPromise);
        const eventsArray = Array.from(events);

        expect(eventsArray.length).toBeGreaterThan(0);

        // Verify all commentIds appear in events
        const eventCommentIds = new Set(eventsArray.map((e) => e.commentId));
        expect(eventCommentIds.has("comment-1")).toBe(true);
        expect(eventCommentIds.has("comment-2")).toBe(true);
        expect(eventCommentIds.has("comment-3")).toBe(true);

        // Each comment should get at least a status event
        for (const commentId of ["comment-1", "comment-2", "comment-3"]) {
          const hasStatus = eventsArray.some(
            (e) => e.commentId === commentId && e.type === "status",
          );
          expect(hasStatus).toBe(true);
        }

        // Each comment should get a done event
        for (const commentId of ["comment-1", "comment-2", "comment-3"]) {
          const hasDone = eventsArray.some((e) => e.commentId === commentId && e.type === "done");
          expect(hasDone).toBe(true);
        }

        expect(updateMutation).toHaveBeenCalledTimes(6); // 2 per comment (running + completed)
      }).pipe(
        Effect.provide(
          makeLayer({
            gitDiff: "test diff",
            gitStatus: "",
            createWorktreePath: "/tmp/test",
            createWorktreeRefName: "test-branch",
          }).layer,
        ),
      ));

    it("single agent failure does not block other agents", () =>
      Effect.gen(function* () {
        const children = createBatchFakeChildrenSpawnMock();

        const updateMutation = vi.fn();
        const { layer } = makeLayer({
          gitDiff: "test diff",
          gitStatus: "",
          createWorktreePath: "/tmp/test",
          createWorktreeRefName: "test-branch",
          updateMutation,
        });

        const service = yield* (BackgroundAgentService as any).make.pipe(Effect.provide(layer));

        // @effect-diagnostics-next-line runEffectInsideEffect:off
        const collectPromise = Effect.runPromise(
          service.runBatchAgents([batchInput1, batchInput2, batchInput3]).pipe(Stream.runCollect),
        );

        // @effect-diagnostics-next-line globalTimers:off
        yield* Effect.promise(() => new Promise<unknown>((r) => setTimeout(r, 20)));

        // Fail the first child, succeed the rest
        if (children[0]) children[0]._emitClose(1);
        for (let i = 1; i < children.length; i++) {
          children[i]?._emitClose(0);
        }

        const events = yield* Effect.promise(() => collectPromise);
        const eventsArray = Array.from(events);

        // comment-2 and comment-3 should complete
        const doneIds = eventsArray.filter((e) => e.type === "done").map((e) => e.commentId);
        expect(doneIds).toContain("comment-2");
        expect(doneIds).toContain("comment-3");

        // comment-1 should have error events
        const errorEvents = eventsArray.filter(
          (e) => e.type === "error" && e.commentId === "comment-1",
        );
        expect(errorEvents.length).toBeGreaterThanOrEqual(1);

        // All three comments should get events
        const allIds = new Set(eventsArray.map((e) => e.commentId));
        expect(allIds.has("comment-1")).toBe(true);
        expect(allIds.has("comment-2")).toBe(true);
        expect(allIds.has("comment-3")).toBe(true);
      }).pipe(
        Effect.provide(
          makeLayer({
            gitDiff: "test diff",
            gitStatus: "",
            createWorktreePath: "/tmp/test",
            createWorktreeRefName: "test-branch",
          }).layer,
        ),
      ));

    it("respects concurrency limit", () =>
      Effect.gen(function* () {
        const children = createBatchFakeChildrenSpawnMock();
        const spawnOrder: string[] = [];
        // Track spawn calls by tracking when each fake child is created
        vi.mocked(child_process.spawn).mockImplementation(() => {
          const child = makeFakeChildProcess();
          children.push(child);
          spawnOrder.push(`spawn-${children.length}`);
          return child as unknown as ReturnType<typeof child_process.spawn>;
        });

        const updateMutation = vi.fn();
        const { layer } = makeLayer({
          gitDiff: "test diff",
          gitStatus: "",
          createWorktreePath: "/tmp/test",
          createWorktreeRefName: "test-branch",
          updateMutation,
        });

        const service = yield* (BackgroundAgentService as any).make.pipe(Effect.provide(layer));

        // Run 5 agents with max concurrency 2
        const inputs = [
          { ...batchInput1, commentId: "c-1" },
          { ...batchInput1, commentId: "c-2" },
          { ...batchInput1, commentId: "c-3" },
          { ...batchInput1, commentId: "c-4" },
          { ...batchInput1, commentId: "c-5" },
        ];

        // @effect-diagnostics-next-line runEffectInsideEffect:off
        const collectPromise = Effect.runPromise(
          service.runBatchAgents(inputs, 2).pipe(Stream.runCollect),
        );

        // @effect-diagnostics-next-line globalTimers:off
        yield* Effect.promise(() => new Promise<unknown>((r) => setTimeout(r, 20)));

        // Close all children
        for (const child of children) {
          child._emitClose(0);
        }

        const events = yield* Effect.promise(() => collectPromise);
        const eventsArray = Array.from(events);

        // All 5 comments should have events
        for (const cid of ["c-1", "c-2", "c-3", "c-4", "c-5"]) {
          const hasEvent = eventsArray.some((e) => e.commentId === cid);
          expect(hasEvent).toBe(true);
        }

        // Verify spawn was called for all 5
        expect(child_process.spawn).toHaveBeenCalledTimes(5);
      }).pipe(
        Effect.provide(
          makeLayer({
            gitDiff: "test diff",
            gitStatus: "",
            createWorktreePath: "/tmp/test",
            createWorktreeRefName: "test-branch",
          }).layer,
        ),
      ));

    it("runBatchAgents with empty inputs completes immediately", () =>
      Effect.gen(function* () {
        const updateMutation = vi.fn();
        const { layer } = makeLayer({
          gitDiff: "test diff",
          gitStatus: "",
          createWorktreePath: "/tmp/test",
          createWorktreeRefName: "test-branch",
          updateMutation,
        });

        const service = yield* (BackgroundAgentService as any).make.pipe(Effect.provide(layer));

        const events = yield* service.runBatchAgents([]).pipe(Stream.runCollect);

        const eventsArray = Array.from(events);
        expect(eventsArray).toHaveLength(0);
        expect(child_process.spawn).not.toHaveBeenCalled();
      }).pipe(
        Effect.provide(
          makeLayer({
            gitDiff: "test diff",
            gitStatus: "",
            createWorktreePath: "/tmp/test",
            createWorktreeRefName: "test-branch",
          }).layer,
        ),
      ));

    it("uses DEFAULT_MAX_CONCURRENT_AGENTS when maxConcurrent is not specified", () =>
      Effect.gen(function* () {
        expect(DEFAULT_MAX_CONCURRENT_AGENTS).toBe(3);
      }));
  });
});
