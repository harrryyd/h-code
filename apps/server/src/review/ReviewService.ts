import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import {
  VcsRepositoryDetectionError,
  VcsUnsupportedOperationError,
  type ReviewComment,
  type ReviewDraft,
  type ReviewDiffPreviewError,
  type ReviewDiffPreviewInput,
  type ReviewDiffPreviewResult,
} from "@t3tools/contracts";

import { ServerConfig } from "../config.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as ReviewDraftStore from "./ReviewDraftStore.ts";

export interface ReviewServiceShape {
  readonly getDiffPreview: (
    input: ReviewDiffPreviewInput,
  ) => Effect.Effect<ReviewDiffPreviewResult, ReviewDiffPreviewError>;
  readonly getReviewDraft: (input: {
    readonly threadId: string;
    readonly prNumber: number;
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
}

export class ReviewService extends Context.Service<ReviewService, ReviewServiceShape>()(
  "t3/review/ReviewService",
) {}

export const make = Effect.fn("makeReviewService")(function* () {
  const config = yield* ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const vcsRegistry = yield* VcsDriverRegistry.VcsDriverRegistry;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const draftStore = yield* ReviewDraftStore.ReviewDraftStore;

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

  const getReviewDraft: ReviewServiceShape["getReviewDraft"] = (input) =>
    draftStore.get(input.threadId, input.prNumber).pipe(Effect.map(Option.getOrNull));

  const upsertReviewComment: ReviewServiceShape["upsertReviewComment"] = (input) =>
    draftStore.get(input.threadId, input.prNumber).pipe(
      Effect.map(Option.getOrNull as (o: Option.Option<ReviewDraft>) => ReviewDraft | null),
      Effect.flatMap((existingDraft) => {
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
    );

  const deleteReviewComment: ReviewServiceShape["deleteReviewComment"] = (input) =>
    draftStore.get(input.threadId, input.prNumber).pipe(
      Effect.map(Option.getOrNull as (o: Option.Option<ReviewDraft>) => ReviewDraft | null),
      Effect.flatMap((existingDraft) => {
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
    );

  return ReviewService.of({
    getDiffPreview,
    getReviewDraft,
    upsertReviewComment,
    deleteReviewComment,
  });
});

export const layer = Layer.effect(ReviewService, make()).pipe(
  Layer.provideMerge(ReviewDraftStore.layer),
);
