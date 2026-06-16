// TODO: Replace raw child_process/fs usage with the Effect platform services once
// the agent execution is routed through ProviderService (see TODO below).
// @effect-diagnostics-next-line nodeBuiltinImport:off
import * as child_process from "node:child_process";

import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import {
  ChangeRequestRunBackgroundAgentError,
  DEFAULT_SERVER_SETTINGS,
  type BackgroundAgentResponseEvent,
  type ProviderDriverKind,
  type ServerSettings,
  type VcsCreateWorktreeResult,
} from "@t3tools/contracts";

import { GitWorkflowService } from "../git/GitWorkflowService.ts";
import { GitVcsDriver } from "../vcs/GitVcsDriver.ts";
import { ReviewService } from "./ReviewService.ts";

export const DEFAULT_MAX_CONCURRENT_AGENTS = 3;
export const MAX_AGENT_OUTPUT_BYTES = 500_000;

const AGENT_PROMPT_TEMPLATE = `
You are a code review assistant. A developer has left a review comment on a pull request.

## PR Diff Context
{diff}

## Comment to respond to
The following comment was left on \`{commentFile}\`{commentLine}:

> {commentBody}

## Instructions
1. Determine whether the comment describes a specific, actionable code issue. If the comment is vague (e.g. "test", "fix this", single words without context), ambiguous, or does not point to a clear defect in the code, then briefly explain why no code changes are needed and STOP. Do not modify any files.
2. If the comment is actionable: explain your understanding of the issue raised in the comment.
3. Implement a fix for the issue described in the comment.
4. Keep changes minimal and focused — only fix what the comment asks for.
5. After making changes, explain what you did.

Respond with a clear explanation. If changes were made, explain them after the explanation. DO NOT ask questions.
`.trim();

function buildPrompt(input: {
  diff: string;
  commentFile: string;
  commentLine: number | undefined;
  commentBody: string;
}): string {
  return AGENT_PROMPT_TEMPLATE.replace("{diff}", input.diff)
    .replace("{commentFile}", input.commentFile)
    .replace(
      "{commentLine}",
      typeof input.commentLine === "number" ? ` (line ${input.commentLine})` : "",
    )
    .replace("{commentBody}", input.commentBody);
}

export interface RunBackgroundAgentInput {
  readonly threadId: string;
  readonly prNumber: number;
  readonly commentId: string;
  readonly cwd: string;
  readonly prHeadRef: string;
  readonly commentFile: string;
  readonly commentLine: number | undefined;
  readonly commentBody: string;
}

export interface BackgroundAgentServiceShape {
  readonly runBackgroundAgent: (
    input: RunBackgroundAgentInput,
  ) => Stream.Stream<BackgroundAgentResponseEvent, ChangeRequestRunBackgroundAgentError>;
  readonly runBatchAgents: (
    inputs: readonly RunBackgroundAgentInput[],
    maxConcurrent?: number,
  ) => Stream.Stream<BackgroundAgentResponseEvent, ChangeRequestRunBackgroundAgentError>;
}

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

/**
 * CLI args for each supported provider in one-shot mode.
 * `__CWD__` is replaced with the worktree path at spawn time.
 */
function getAgentCliArgs(kind: ProviderDriverKind): ReadonlyArray<string> {
  if (kind === "opencode") {
    return [
      "--dir",
      "__CWD__",
      "run",
      "--dangerously-skip-permissions",
      "-m",
      "opencode/deepseek-v4-flash-free",
    ];
  }
  if (kind === "claudeAgent") {
    return ["-p", "--dangerously-skip-permissions"];
  }
  return [];
}

/**
 * Read the binary path from settings for a given provider kind.
 */
function resolveAgentBinary(providerKind: ProviderDriverKind, settings: ServerSettings): string {
  if (providerKind === "opencode") return settings.providers.opencode.binaryPath ?? "opencode";
  if (providerKind === "claudeAgent") return settings.providers.claudeAgent.binaryPath ?? "claude";
  return "opencode";
}

const make = Effect.fn("makeBackgroundAgentService")(function* () {
  yield* Effect.logDebug("backgroundAgentService.make start");
  const git = yield* GitVcsDriver;
  const gitWorkflow = yield* GitWorkflowService;
  const review = yield* ReviewService;
  yield* Effect.logDebug("backgroundAgentService.make dependencies ready");

  const runBackgroundAgent: BackgroundAgentServiceShape["runBackgroundAgent"] = (input) =>
    Stream.callback<BackgroundAgentResponseEvent, ChangeRequestRunBackgroundAgentError>((queue) =>
      Effect.gen(function* () {
        const offer = (event: BackgroundAgentResponseEvent) =>
          Queue.offer(queue, event).pipe(Effect.asVoid);

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

        const finalizeWithStatus = (agentStatus: "completed" | "failed", errorMessage?: string) =>
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

        const runAgent = Effect.gen(function* () {
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

          const now = yield* Clock.currentTimeMillis;
          const tempBranch = `t3/agent-response-${input.commentId.slice(0, 8)}-${now}`;
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

          // Agent binary and CLI args — defaults to opencode.
          // To use a different agent, the caller can extend RunBackgroundAgentInput
          // with a `providerInstanceId` or `modelSelection` field.
          const agentKind = "opencode" as ProviderDriverKind;
          const binaryPath = resolveAgentBinary(agentKind, DEFAULT_SERVER_SETTINGS);
          const argsTemplate = getAgentCliArgs(agentKind);
          const args = [...argsTemplate.map((a) => (a === "__CWD__" ? worktreePath : a)), prompt];

          yield* offer({
            type: "detail",
            commentId: input.commentId,
            title: "Running Agent",
            content: `Executing agent (${agentKind}) in ${worktreePath}...`,
          });

          const combinedOutputRef = yield* Ref.make("");
          const AGENT_TIMEOUT_MS = 2 * 60 * 1000;

          const safeOffer = (event: BackgroundAgentResponseEvent) =>
            Effect.runFork(Queue.offer(queue, event));

          const runAgentProcess = Effect.callback<number, ChangeRequestRunBackgroundAgentError>(
            (resume) => {
              let resolved = false;
              let child: child_process.ChildProcess | null = null;
              let killedByOutputGuard = false;
              try {
                child = child_process.spawn(binaryPath, args, {
                  cwd: worktreePath,
                  env: { ...process.env },
                  stdio: ["ignore", "pipe", "pipe"],
                });
              } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                safeOffer({
                  type: "detail",
                  commentId: input.commentId,
                  title: "Agent Spawn Error",
                  content: `Failed to spawn agent: ${message}`,
                });
                resume(
                  Effect.fail(
                    fail("agent-failed", `Failed to spawn agent process: ${message}`, err),
                  ),
                );
                return;
              }

              const killForOutputExceeded = () => {
                if (!resolved && child) {
                  killedByOutputGuard = true;
                  resolved = true;
                  child.kill("SIGTERM");
                  resume(
                    Effect.fail(
                      fail(
                        "agent-failed",
                        `Agent output exceeded ${MAX_AGENT_OUTPUT_BYTES.toLocaleString()} byte limit. The agent may be caught in a self-correction loop.`,
                      ),
                    ),
                  );
                }
              };

              child.stdout?.on("data", (chunk: Buffer) => {
                const text = chunk.toString("utf-8");
                Effect.runFork(
                  Ref.updateAndGet(combinedOutputRef, (prev) => prev + text).pipe(
                    Effect.flatMap((total) => {
                      if (total.length > MAX_AGENT_OUTPUT_BYTES) {
                        killForOutputExceeded();
                      }
                      return Effect.void;
                    }),
                  ),
                );
                if (!killedByOutputGuard) {
                  safeOffer({
                    type: "text",
                    commentId: input.commentId,
                    content: text,
                  });
                }
              });

              child.stderr?.on("data", (chunk: Buffer) => {
                const text = chunk.toString("utf-8");
                Effect.runFork(Ref.update(combinedOutputRef, (prev) => prev + text));
                if (!killedByOutputGuard) {
                  safeOffer({
                    type: "detail",
                    commentId: input.commentId,
                    title: "Agent stderr",
                    content: text,
                  });
                }
              });

              child.on("close", (code: number | null) => {
                if (!resolved) {
                  resolved = true;
                  resume(Effect.succeed(code ?? 0));
                }
              });

              child.on("error", (err) => {
                if (!resolved) {
                  resolved = true;
                  safeOffer({
                    type: "detail",
                    commentId: input.commentId,
                    title: "Agent Error",
                    content: `Agent spawn error: ${err.message}`,
                  });
                  resume(Effect.succeed(127));
                }
              });
            },
          );

          const exitCode = yield* runAgentProcess.pipe(
            Effect.timeout(Duration.millis(AGENT_TIMEOUT_MS)),
            Effect.mapError((cause) => {
              const detail =
                cause instanceof Error && cause.message
                  ? cause.message
                  : typeof cause === "object" && cause !== null && "_tag" in cause
                    ? ((cause as { _tag: string })._tag ?? "unknown")
                    : cause != null
                      ? String(cause)
                      : "Agent process timed out or failed with an unknown error";
              return fail("agent-failed", `Agent process failed or timed out: ${detail}`, cause);
            }),
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

          const statusResult = yield* git
            .execute({
              operation: "backgroundAgent.checkStatus",
              cwd: worktreePath,
              args: ["status", "--porcelain"],
            })
            .pipe(Effect.orElseSucceed(() => ({ stdout: "" })));

          if (statusResult.stdout.trim()) {
            yield* offer({
              type: "detail",
              commentId: input.commentId,
              title: "Changes Detected",
              content: statusResult.stdout,
            });

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
                args: ["commit", "-m", `Agent response to comment ${input.commentId.slice(0, 8)}`],
              })
              .pipe(Effect.ignore);

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
        });

        yield* runAgent.pipe(Effect.catch((error) => finalizeWithStatus("failed", error.detail)));
      }),
    );

  const runBatchAgents: BackgroundAgentServiceShape["runBatchAgents"] = (inputs, maxConcurrent) =>
    Stream.callback<BackgroundAgentResponseEvent, ChangeRequestRunBackgroundAgentError>(
      (outputQueue) =>
        Effect.gen(function* () {
          const concurrency = maxConcurrent ?? DEFAULT_MAX_CONCURRENT_AGENTS;

          if (inputs.length === 0) {
            yield* Queue.end(outputQueue);
            return;
          }

          yield* Effect.forEach(
            inputs,
            (input) =>
              runBackgroundAgent(input).pipe(
                Stream.runForEach((event) => Queue.offer(outputQueue, event)),
                Effect.catch((error) =>
                  Queue.offer(outputQueue, {
                    type: "error" as const,
                    commentId: input.commentId,
                    message: error.detail,
                  }),
                ),
              ),
            { concurrency },
          );

          yield* Queue.end(outputQueue);
        }),
    );

  return {
    runBackgroundAgent,
    runBatchAgents,
  } satisfies BackgroundAgentServiceShape;
});

export class BackgroundAgentService extends Context.Service<
  BackgroundAgentService,
  BackgroundAgentServiceShape
>()("t3/review/BackgroundAgentService", { make: make() }) {}

export const layer = Layer.effect(BackgroundAgentService, BackgroundAgentService.make);
