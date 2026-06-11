import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import {
  ChangeRequestSubmitReviewError,
  VcsRepositoryDetectionError,
  VcsUnsupportedOperationError,
  type ReviewComment,
  type ReviewCommentAgentStatus,
  type ReviewDraft,
  type ReviewDiffPreviewError,
  type ReviewDiffPreviewInput,
  type ReviewDiffPreviewResult,
} from "@t3tools/contracts";

import { ServerConfig } from "../config.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as ReviewDraftStore from "./ReviewDraftStore.ts";
import * as GitHubCli from "../sourceControl/GitHubCli.ts";

export interface ReviewServiceShape {
  readonly getDiffPreview: (
    input: ReviewDiffPreviewInput,
  ) => Effect.Effect<ReviewDiffPreviewResult, ReviewDiffPreviewError>;
  readonly getReviewDraft: (input: {
    readonly threadId: string;
    readonly prNumber: number;
    readonly cwd?: string | undefined;
  }) => Effect.Effect<ReviewDraft | null, never>;
  readonly upsertReviewComment: (input: {
    readonly threadId: string;
    readonly prNumber: number;
    readonly prHeadSHA: string;
    readonly comment: ReviewComment;
  }) => Effect.Effect<ReviewDraft, never>;
  readonly deleteReviewComment: (input: {
    readonly threadId: string;
    readonly prNumber: number;
    readonly commentId: string;
  }) => Effect.Effect<ReviewDraft | null, never>;
  readonly submitReview: (input: {
    readonly threadId: string;
    readonly prNumber: number;
    readonly cwd?: string | undefined;
  }) => Effect.Effect<ReviewDraft, ChangeRequestSubmitReviewError>;
  readonly updateCommentAgentStatus: (input: {
    readonly threadId: string;
    readonly prNumber: number;
    readonly commentId: string;
    readonly agentStatus: ReviewCommentAgentStatus;
  }) => Effect.Effect<ReviewDraft | null, never>;
}

export class ReviewService extends Context.Service<ReviewService, ReviewServiceShape>()(
  "t3/review/ReviewService",
) {}

export const make = Effect.fn("makeReviewService")(function* () {
  yield* Effect.logDebug("reviewService.make start");
  const config = yield* ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const vcsRegistry = yield* VcsDriverRegistry.VcsDriverRegistry;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const draftStore = yield* ReviewDraftStore.ReviewDraftStore;
  const githubCliOption = yield* Effect.serviceOption(GitHubCli.GitHubCli);
  yield* Effect.logDebug("reviewService.make dependencies ready");

  function mapGitHubCommentToReviewComment(
    comment: GitHubCli.GitHubPullRequestReviewComment,
  ): ReviewComment {
    return {
      id: `gh-${comment.id}`,
      file: comment.path,
      line: comment.line,
      commitSHA: comment.commitSHA,
      body: comment.body,
      author: comment.author,
      createdAt: comment.createdAt,
      replies: comment.replies?.map(mapGitHubCommentToReviewComment),
    };
  }

  const canonicalizePath = (value: string) =>
    fileSystem.realPath(path.resolve(value)).pipe(Effect.orElseSucceed(() => path.resolve(value)));

  const isWithinRoot = (candidate: string, root: string) => {
    const relative = path.relative(root, candidate);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  };

  const assertWorkspaceBoundCwd = Effect.fn("ReviewService.assertWorkspaceBoundCwd")(function* (
    cwd: string,
  ) {
    const [candidate, workspaceRoot, worktreesRoot] = yield* Effect.all([
      canonicalizePath(cwd),
      canonicalizePath(config.cwd),
      canonicalizePath(config.worktreesDir),
    ]);

    if (isWithinRoot(candidate, workspaceRoot) || isWithinRoot(candidate, worktreesRoot)) {
      return;
    }

    return yield* new VcsRepositoryDetectionError({
      operation: "ReviewService.getDiffPreview",
      cwd,
      detail: "Review diff preview cwd must stay within the configured workspace root.",
    });
  });

  const getDiffPreview: ReviewServiceShape["getDiffPreview"] = Effect.fn(
    "ReviewService.getDiffPreview",
  )(function* (input) {
    yield* assertWorkspaceBoundCwd(input.cwd);

    const handle = yield* vcsRegistry.detect({ cwd: input.cwd, requestedKind: "auto" });
    if (!handle) {
      return {
        cwd: input.cwd,
        generatedAt: yield* DateTime.now,
        sources: [],
      };
    }

    const getDriverDiffPreview = handle.driver.getDiffPreview;
    if (!getDriverDiffPreview) {
      if (handle.kind === "git") {
        return yield* git.getReviewDiffPreview(input);
      }
      return yield* new VcsUnsupportedOperationError({
        operation: "ReviewService.getDiffPreview",
        kind: handle.kind,
        detail: `The ${handle.kind} VCS driver does not support review diff previews.`,
      });
    }

    return yield* getDriverDiffPreview(input);
  });

  const getReviewDraft: ReviewServiceShape["getReviewDraft"] = Effect.fn(
    "ReviewService.getReviewDraft",
  )((input) =>
    Effect.gen(function* () {
      const localDraftOption = yield* draftStore.get(input.threadId, input.prNumber);

      let githubComments: ReviewComment[] = [];
      if (input.cwd && Option.isSome(githubCliOption)) {
        const cli = githubCliOption.value;
        const reviews = yield* cli.getPullRequestReviews({
          cwd: input.cwd,
          reference: String(input.prNumber),
        }).pipe(Effect.orElseSucceed(() => ({ comments: [] })));
        githubComments = reviews.comments.map(mapGitHubCommentToReviewComment);
      }

      const existingDraft = Option.getOrNull(localDraftOption);

      if (!existingDraft && githubComments.length === 0) return null;

      const localCommentIds = new Set(existingDraft?.comments.map((c) => c.id) ?? []);
      const mergedComments = [
        ...githubComments.filter((c) => !localCommentIds.has(c.id)),
        ...(existingDraft?.comments ?? []),
      ];

      return {
        threadId: input.threadId,
        prNumber: input.prNumber,
        prHeadSHA: existingDraft?.prHeadSHA ?? "",
        comments: mergedComments,
        state: existingDraft?.state ?? ("draft" as const),
      } satisfies ReviewDraft;
    }),
  );

  const upsertReviewComment: ReviewServiceShape["upsertReviewComment"] = Effect.fn(
    "ReviewService.upsertReviewComment",
  )((input) =>
    draftStore.get(input.threadId, input.prNumber).pipe(
      Effect.flatMap((option) => {
        const existingDraft = Option.getOrNull(option);
        const draft: ReviewDraft = existingDraft
          ? {
              ...existingDraft,
              prHeadSHA: input.prHeadSHA,
              comments: [
                ...existingDraft.comments.filter((c) => c.id !== input.comment.id),
                input.comment,
              ],
            }
          : {
              threadId: input.threadId,
              prNumber: input.prNumber,
              prHeadSHA: input.prHeadSHA,
              comments: [input.comment],
              state: "draft" as const,
            };

        return draftStore.upsert(draft).pipe(Effect.as(draft));
      }),
    ),
  );

  const deleteReviewComment: ReviewServiceShape["deleteReviewComment"] = Effect.fn(
    "ReviewService.deleteReviewComment",
  )((input) =>
    draftStore.get(input.threadId, input.prNumber).pipe(
      Effect.flatMap((option) => {
        const existingDraft = Option.getOrNull(option);
        if (!existingDraft) {
          return Effect.succeed<ReviewDraft | null>(null);
        }

        const updatedComments = existingDraft.comments.filter(
          (c) => c.id !== input.commentId,
        );

        if (updatedComments.length === 0) {
          return draftStore.delete(input.threadId, input.prNumber).pipe(
            Effect.as<ReviewDraft | null>(null),
          );
        }

        const draft: ReviewDraft = {
          ...existingDraft,
          comments: updatedComments,
        };

        return draftStore.upsert(draft).pipe(Effect.as<ReviewDraft | null>(draft));
      }),
    ),
  );

  const submitReview: ReviewServiceShape["submitReview"] = Effect.fn(
    "ReviewService.submitReview",
  )((input) =>
    Effect.gen(function* () {
      const localDraftOption = yield* draftStore.get(input.threadId, input.prNumber);
      if (Option.isNone(localDraftOption)) {
        return yield* new ChangeRequestSubmitReviewError({
          kind: "no-draft",
          detail: "No draft review comments to submit.",
        });
      }

      const draft = localDraftOption.value;
      if (draft.state === "published") {
        return yield* new ChangeRequestSubmitReviewError({
          kind: "no-draft",
          detail: "Review has already been submitted.",
        });
      }
      if (draft.comments.length === 0) {
        return yield* new ChangeRequestSubmitReviewError({
          kind: "no-draft",
          detail: "No draft review comments to submit.",
        });
      }

      if (Option.isNone(githubCliOption) || !input.cwd) {
        return yield* new ChangeRequestSubmitReviewError({
          kind: "not-a-repo",
          detail: "Cannot submit review: missing GitHub CLI or worktree path.",
        });
      }

      const cli = githubCliOption.value;

      const localComments = draft.comments.filter(
        (c) => c.author.login === "local",
      );

      if (localComments.length === 0) {
        return yield* new ChangeRequestSubmitReviewError({
          kind: "no-draft",
          detail: "No local draft review comments to submit.",
        });
      }

      // Format comments into markdown body
      const body = localComments
        .map((c) => {
          const fileLine = typeof c.line === "number" ? `:${c.line}` : "";
          return `**${c.file}${fileLine}**\n\n${c.body}`;
        })
        .join("\n\n---\n\n");

      // Write body to a temporary file
      yield* fileSystem.makeDirectory(path.join(config.stateDir, "tmp"), {
        recursive: true,
      }).pipe(Effect.orElseSucceed(() => undefined));
      const bodyFile = path.join(config.stateDir, "tmp", `review-body-${input.threadId}-${input.prNumber}.md`);
      yield* fileSystem.writeFileString(bodyFile, body).pipe(Effect.orElseSucceed(() => undefined));

      // Submit the review and clean up temp file
      yield* cli.createPullRequestReview({
        cwd: input.cwd,
        reference: String(input.prNumber),
        bodyFile,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ChangeRequestSubmitReviewError({
              kind: "review-failed",
              detail: cause.message,
              cause,
            }),
        ),
        Effect.ensuring(
          fileSystem.remove(bodyFile).pipe(Effect.catch(() => Effect.void)),
        ),
      );

      // Fetch fresh GitHub comments to merge with published local comments
      const reviews = yield* cli.getPullRequestReviews({
        cwd: input.cwd,
        reference: String(input.prNumber),
      }).pipe(Effect.orElseSucceed(() => ({ comments: [] })));
      const githubComments = reviews.comments.map(mapGitHubCommentToReviewComment);

      // Merge: local comments take precedence, GitHub comments fill in any extras
      const localIds = new Set(localComments.map((c) => c.id));
      const mergedComments = [
        ...localComments.map((c) => ({ ...c, state: "published" as const })),
        ...githubComments.filter((c) => !localIds.has(c.id)),
      ];

      const publishedDraft: ReviewDraft = {
        threadId: input.threadId,
        prNumber: input.prNumber,
        prHeadSHA: draft.prHeadSHA,
        comments: mergedComments,
        state: "published",
      };

      // Replace local draft
      yield* draftStore.upsert(publishedDraft).pipe(Effect.orElseSucceed(() => undefined));

      return publishedDraft;
    }),
  );

  const updateCommentAgentStatus: ReviewServiceShape["updateCommentAgentStatus"] = Effect.fn(
    "ReviewService.updateCommentAgentStatus",
  )((input) =>
    draftStore.get(input.threadId, input.prNumber).pipe(
      Effect.flatMap((option) => {
        const existingDraft = Option.getOrNull(option);
        if (!existingDraft) {
          return Effect.succeed<ReviewDraft | null>(null);
        }

        const updatedComments = existingDraft.comments.map((c) =>
          c.id === input.commentId ? { ...c, agentStatus: input.agentStatus } : c,
        );

        const draft: ReviewDraft = {
          ...existingDraft,
          comments: updatedComments,
        };

        return draftStore.upsert(draft).pipe(Effect.as<ReviewDraft | null>(draft));
      }),
    ),
  );

  return ReviewService.of({
    getDiffPreview,
    getReviewDraft,
    upsertReviewComment,
    deleteReviewComment,
    submitReview,
    updateCommentAgentStatus,
  });
});

export const layer = Layer.effect(ReviewService, make()).pipe(
  Layer.provideMerge(ReviewDraftStore.layer),
);
