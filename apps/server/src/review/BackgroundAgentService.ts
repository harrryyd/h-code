import * as child_process from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";

import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import type {
  BackgroundAgentResponseEvent,
  ChangeRequestRunBackgroundAgentError,
  VcsCreateWorktreeResult,
} from "@t3tools/contracts";

import { GitWorkflowService } from "../git/GitWorkflowService.ts";
import { GitVcsDriver } from "../vcs/GitVcsDriver.ts";
import { ReviewService } from "./ReviewService.ts";

const AGENT_PROMPT_TEMPLATE = `
You are a code review assistant. A developer has left a review comment on a pull request.

## PR Diff Context
{diff}

## Comment to respond to
The following comment was left on \`{commentFile}\`{commentLine}:

> {commentBody}

## Instructions
1. Read and understand the comment and the PR diff context.
2. Explain your understanding of the issue raised in the comment.
3. Implement a fix for the issue described in the comment.
4. Keep changes minimal and focused — only fix what the comment asks for.
5. After making changes, explain what you did.

Respond with a clear explanation first, then implement the fix. DO NOT ask questions — just explain and implement.
`.trim();

function buildPrompt(input: {
  diff: string;
  commentFile: string;
  commentLine: number | undefined;
  commentBody: string;
}): string {
  return AGENT_PROMPT_TEMPLATE
    .replace("{diff}", input.diff)
    .replace("{commentFile}", input.commentFile)
    .replace(
      "{commentLine}",
      typeof input.commentLine === "number" ? ` (line ${input.commentLine})` : "",
    )
    .replace("{commentBody}", input.commentBody);
}

export interface BackgroundAgentServiceShape {
  readonly runBackgroundAgent: (input: {
    readonly threadId: string;
    readonly prNumber: number;
    readonly commentId: string;
    readonly cwd: string;
    readonly prHeadRef: string;
    readonly commentFile: string;
    readonly commentLine: number | undefined;
    readonly commentBody: string;
  }) => Stream.Stream<BackgroundAgentResponseEvent, ChangeRequestRunBackgroundAgentError>;
}

export class BackgroundAgentService extends Context.Service<
  BackgroundAgentService,
  BackgroundAgentServiceShape
>()("t3/review/BackgroundAgentService") {}

function fail(
  kind: ChangeRequestRunBackgroundAgentError["kind"],
  detail: string,
  cause?: unknown,
): ChangeRequestRunBackgroundAgentError {
  return new ChangeRequestRunBackgroundAgentError({
    kind,
    detail,
    cause,
  });
}

export const make = Effect.fn("makeBackgroundAgentService")(function* () {
  const git = yield* GitVcsDriver.GitVcsDriver;
  const gitWorkflow = yield* GitWorkflowService.GitWorkflowService;
  const review = yield* ReviewService.ReviewService;

  const runBackgroundAgent = Effect.fn("BackgroundAgentService.runBackgroundAgent")(
    (input: {
      readonly threadId: string;
      readonly prNumber: number;
      readonly commentId: string;
      readonly cwd: string;
      readonly prHeadRef: string;
      readonly commentFile: string;
      readonly commentLine: number | undefined;
      readonly commentBody: string;
    }): Stream.Stream<BackgroundAgentResponseEvent, ChangeRequestRunBackgroundAgentError> =>
      Stream.callback<BackgroundAgentResponseEvent, ChangeRequestRunBackgroundAgentError>(
        (queue) =>
          Effect.gen(function* () {
            const offer = (event: BackgroundAgentResponseEvent) =>
              Queue.offer(queue, event).pipe(Effect.asVoid);

            // Update comment agentStatus to "running"
            yield* review
              .updateCommentAgentStatus({
                threadId: input.threadId,
                prNumber: input.prNumber,
                commentId: input.commentId,
                agentStatus: "running",
              })
              .pipe(Effect.ignore);

            yield* offer({
              type: "status",
              commentId: input.commentId,
              agentStatus: "running",
            });

            let worktree: VcsCreateWorktreeResult | null = null;

            const cleanup = () =>
              worktree
                ? gitWorkflow
                    .removeWorktree({
                      cwd: input.cwd,
                      path: worktree.worktree.path,
                      force: true,
                    })
                    .pipe(Effect.ignore)
                : Effect.void;

            const finalizeWithStatus = (
              agentStatus: "completed" | "failed",
              errorMessage?: string,
            ) =>
              Effect.gen(function* () {
                yield* cleanup();
                yield* review
                  .updateCommentAgentStatus({
                    threadId: input.threadId,
                    prNumber: input.prNumber,
                    commentId: input.commentId,
                    agentStatus,
                  })
                  .pipe(Effect.ignore);
                yield* offer({
                  type: "status",
                  commentId: input.commentId,
                  agentStatus,
                });
                if (errorMessage) {
                  yield* offer({
                    type: "error",
                    commentId: input.commentId,
                    message: errorMessage,
                  });
                }
                yield* offer({
                  type: "done",
                  commentId: input.commentId,
                });
                yield* Queue.end(queue);
              });

            // Get PR diff
            const diffResult = yield* git
              .getPrDiff(input.cwd, "origin/HEAD", input.prHeadRef)
              .pipe(
                Effect.mapError((cause) =>
                  fail("agent-failed", `Failed to get PR diff: ${cause.message}`, cause),
                ),
              );

            yield* offer({
              type: "detail",
              commentId: input.commentId,
              title: "PR Diff Context",
              content: diffResult,
            });

            // Build prompt
            const prompt = buildPrompt({
              diff: diffResult,
              commentFile: input.commentFile,
              commentLine: input.commentLine,
              commentBody: input.commentBody,
            });

            yield* offer({
              type: "detail",
              commentId: input.commentId,
              title: "Agent Prompt",
              content: prompt,
            });

            // Create temp worktree off PR head
            const tempBranch = `t3/agent-response-${input.commentId.slice(0, 8)}-${Date.now()}`;
            worktree = yield* gitWorkflow
              .createWorktree({
                cwd: input.cwd,
                refName: input.prHeadRef,
                newRefName: tempBranch,
                path: null,
              })
              .pipe(
                Effect.mapError((cause) =>
                  fail("agent-failed", `Failed to create worktree: ${cause.message}`, cause),
                ),
              );

            const worktreePath = worktree.worktree.path;
            yield* offer({
              type: "detail",
              commentId: input.commentId,
              title: "Worktree Created",
              content: `Created worktree at ${worktreePath} on branch ${tempBranch}`,
            });

            // TODO: Replace raw child_process.spawn with ProviderService/agent session
            // infrastructure (see OpenCodeAdapter for reference). The current approach
            // spawns opencode directly instead of routing through the established provider
            // session lifecycle (startSession → sendTurn → streamEvents). This means
            // there is no turn timeout, no structured turn/event model, and no shared
            // concurrency control with other agent actions.

            // Write prompt to a temp file outside the worktree so it is not committed
            const promptFile = yield* Effect.tryPromise({
              try: () => {
                const filePath = `${os.tmpdir()}/t3-agent-prompt-${input.commentId.slice(0, 8)}.txt`;
                return fs.writeFile(filePath, prompt, "utf-8").then(() => filePath);
              },
              catch: (cause) =>
                fail("agent-failed", `Failed to write prompt file: ${String(cause)}`, cause),
            });

            yield* offer({
              type: "detail",
              commentId: input.commentId,
              title: "Running Agent",
              content: `Executing agent in ${worktreePath}...`,
            });

            // Run opencode using child_process with a timeout
            const combinedOutputRef = yield* Ref.make("");
            const AGENT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

            const safeOffer = (event: BackgroundAgentResponseEvent) =>
              Effect.runFork(Queue.offer(queue, event).pipe(Effect.catchAll(() => Effect.void)));

            const runAgentProcess = Effect.async<number, ChangeRequestRunBackgroundAgentError>(
              (resume) => {
                let resolved = false;
                const child = child_process.spawn("opencode", [
                  "--cwd",
                  worktreePath,
                  "exec",
                  "--yes",
                  "--approval-mode",
                  "auto",
                  promptFile,
                ], {
                  cwd: worktreePath,
                  env: { ...process.env },
                });

                child.stdout?.on("data", (chunk: Buffer) => {
                  const text = chunk.toString("utf-8");
                  Effect.runFork(
                    Ref.update(combinedOutputRef, (prev) => prev + text).pipe(
                      Effect.catchAll(() => Effect.void),
                    ),
                  );
                  safeOffer({
                    type: "text",
                    commentId: input.commentId,
                    content: text,
                  });
                });

                child.stderr?.on("data", (chunk: Buffer) => {
                  const text = chunk.toString("utf-8");
                  Effect.runFork(
                    Ref.update(combinedOutputRef, (prev) => prev + text).pipe(
                      Effect.catchAll(() => Effect.void),
                    ),
                  );
                  safeOffer({
                    type: "detail",
                    commentId: input.commentId,
                    title: "Agent stderr",
                    content: text,
                  });
                });

                child.on("close", (code: number | null) => {
                  if (!resolved) {
                    resolved = true;
                    resume(Effect.succeed(code ?? 0));
                  }
                });

                child.on("error", () => {
                  if (!resolved) {
                    resolved = true;
                    resume(Effect.succeed(127));
                  }
                });
              },
            );

            const exitCode = yield* runAgentProcess.pipe(
              Effect.timeout(Duration.millis(AGENT_TIMEOUT_MS)),
              Effect.mapError(
                (cause) =>
                  fail(
                    "agent-failed",
                    `Agent process failed or timed out: ${cause instanceof Error ? cause.message : String(cause)}`,
                    cause,
                  ),
              ),
            );

            if (exitCode !== 0) {
              const combinedOutput = yield* Ref.get(combinedOutputRef);
              yield* offer({
                type: "detail",
                commentId: input.commentId,
                title: "Agent Exit",
                content: `Agent exited with code ${exitCode}. Output: ${combinedOutput.slice(0, 1000)}`,
              });
            }

            // Check for changes
            const statusResult = yield* git
              .execute({
                operation: "backgroundAgent.checkStatus",
                cwd: worktreePath,
                args: ["status", "--porcelain"],
              })
              .pipe(Effect.orElseSucceed(() => ({ stdout: "", stderr: "", exitCode: 0 })));

            if (statusResult.stdout.trim()) {
              yield* offer({
                type: "detail",
                commentId: input.commentId,
                title: "Changes Detected",
                content: statusResult.stdout,
              });

              // Commit changes
              yield* git
                .execute({
                  operation: "backgroundAgent.commit",
                  cwd: worktreePath,
                  args: ["add", "-A"],
                })
                .pipe(Effect.ignore);

              yield* git
                .execute({
                  operation: "backgroundAgent.commit",
                  cwd: worktreePath,
                  args: [
                    "commit",
                    "-m",
                    `Agent response to comment ${input.commentId.slice(0, 8)}`,
                  ],
                })
                .pipe(Effect.ignore);

              // Push to a new branch on origin (agent response branch)
              const remoteBranch = `refs/heads/${tempBranch}`;
              yield* git
                .execute({
                  operation: "backgroundAgent.push",
                  cwd: worktreePath,
                  args: ["push", "origin", `${tempBranch}:${remoteBranch}`],
                })
                .pipe(Effect.ignore);

              yield* offer({
                type: "detail",
                commentId: input.commentId,
                title: "Pushed",
                content: `Pushed changes to branch ${tempBranch}`,
              });
            } else {
              yield* offer({
                type: "detail",
                commentId: input.commentId,
                title: "No Changes",
                content: "Agent did not produce any file changes.",
              });
            }

            yield* finalizeWithStatus("completed");
          }).pipe(
            Effect.catchAll((error) =>
              Effect.gen(function* () {
                const detail =
                  error && typeof error === "object" && "detail" in error
                    ? String(error.detail)
                    : error instanceof Error
                      ? error.message
                      : "Agent execution failed";
                yield* finalizeWithStatus("failed", detail);
              }),
            ),
          ),
      ),
  );

  return BackgroundAgentService.of({
    runBackgroundAgent,
  });
});

export const layer = Layer.effect(BackgroundAgentService, make());
