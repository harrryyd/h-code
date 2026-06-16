import { describe, it, expect, vi } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import type { ReviewComment, ReviewDraft } from "@t3tools/contracts";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as ReviewService from "./ReviewService.ts";
import * as ReviewDraftStore from "./ReviewDraftStore.ts";
import * as GitHubCli from "../sourceControl/GitHubCli.ts";
import { ServerConfig } from "../config.ts";

function makeLayer() {
  return ReviewService.layer.pipe(
    Layer.provide(ServerConfig.layerTest("test-cwd", { prefix: "t3-review-draft-service-" })),
    Layer.provideMerge(NodeServices.layer),
  );
}

const testComment: ReviewComment = {
  id: "comment-1",
  file: "src/app.ts",
  line: 42,
  commitSHA: "abc123",
  body: "Consider renaming this variable.",
  author: { login: "codex-bot" },
  createdAt: "2025-06-01T12:00:00Z",
};

const testComment2: ReviewComment = {
  id: "comment-2",
  file: "src/utils.ts",
  commitSHA: "abc123",
  body: "Extract this into a helper function.",
  agentStatus: "running",
  author: { login: "codex-bot" },
  createdAt: "2025-06-01T12:05:00Z",
};

describe("ReviewService review drafts", () => {
  it("getReviewDraft returns null for unknown draft", () =>
    Effect.gen(function* () {
      const review = yield* ReviewService.ReviewService;
      const result = yield* review.getReviewDraft({ threadId: "unknown", prNumber: 1 });
      expect(result).toBeNull();
    }).pipe(Effect.provide(makeLayer())));

  it("round-trip: upsert → getReviewDraft → delete → getReviewDraft", () =>
    Effect.gen(function* () {
      const review = yield* ReviewService.ReviewService;

      const upserted = yield* review.upsertReviewComment({
        threadId: "thread-1",
        prNumber: 42,
        prHeadSHA: "abc123",
        comment: testComment,
      });

      expect(upserted.threadId).toBe("thread-1");
      expect(upserted.comments).toHaveLength(1);
      expect(upserted.comments[0]?.id).toBe("comment-1");

      const draft = yield* review.getReviewDraft({ threadId: "thread-1", prNumber: 42 });
      expect(draft).not.toBeNull();
      expect(draft?.comments).toHaveLength(1);

      const afterDelete = yield* review.deleteReviewComment({
        threadId: "thread-1",
        prNumber: 42,
        commentId: "comment-1",
      });
      expect(afterDelete).toBeNull();

      const emptyDraft = yield* review.getReviewDraft({ threadId: "thread-1", prNumber: 42 });
      expect(emptyDraft).toBeNull();
    }).pipe(Effect.provide(makeLayer())));

  it("upsertReviewComment adds new comment to existing draft", () =>
    Effect.gen(function* () {
      const review = yield* ReviewService.ReviewService;

      yield* review.upsertReviewComment({
        threadId: "thread-2",
        prNumber: 99,
        prHeadSHA: "sha1",
        comment: testComment,
      });

      const upserted = yield* review.upsertReviewComment({
        threadId: "thread-2",
        prNumber: 99,
        prHeadSHA: "sha1",
        comment: testComment2,
      });

      expect(upserted.comments).toHaveLength(2);
      expect(upserted.comments[1]?.id).toBe("comment-2");
    }).pipe(Effect.provide(makeLayer())));

  it("upsertReviewComment replaces existing comment with same id", () =>
    Effect.gen(function* () {
      const review = yield* ReviewService.ReviewService;

      yield* review.upsertReviewComment({
        threadId: "thread-3",
        prNumber: 7,
        prHeadSHA: "sha1",
        comment: testComment,
      });

      const updatedComment: ReviewComment = {
        ...testComment,
        body: "Updated body text.",
        agentStatus: "completed",
      };

      const upserted = yield* review.upsertReviewComment({
        threadId: "thread-3",
        prNumber: 7,
        prHeadSHA: "sha2",
        comment: updatedComment,
      });

      expect(upserted.comments).toHaveLength(1);
      expect(upserted.comments[0]?.body).toBe("Updated body text.");
      expect(upserted.comments[0]?.agentStatus).toBe("completed");
      expect(upserted.prHeadSHA).toBe("sha2");
    }).pipe(Effect.provide(makeLayer())));

  it("deleteReviewComment returns null for unknown draft", () =>
    Effect.gen(function* () {
      const review = yield* ReviewService.ReviewService;

      const result = yield* review.deleteReviewComment({
        threadId: "unknown",
        prNumber: 1,
        commentId: "no-such-comment",
      });

      expect(result).toBeNull();
    }).pipe(Effect.provide(makeLayer())));
});

const testGhComment: GitHubCli.GitHubPullRequestReviewComment = {
  id: "123",
  path: "src/app.ts",
  line: 42,
  commitSHA: "abc123",
  body: "Consider renaming this variable.",
  author: { login: "codex-bot" },
  createdAt: "2025-06-01T12:00:00Z",
};

const testGhComment2: GitHubCli.GitHubPullRequestReviewComment = {
  id: "124",
  path: "src/utils.ts",
  commitSHA: "abc123",
  body: "Extract this into a helper function.",
  author: { login: "codex-bot" },
  createdAt: "2025-06-01T12:05:00Z",
};

const testGhComment3: GitHubCli.GitHubPullRequestReviewComment = {
  id: "125",
  path: "src/index.ts",
  line: 10,
  commitSHA: "abc123",
  body: "Use a named export here.",
  author: { login: "codex-bot" },
  createdAt: "2025-06-01T12:10:00Z",
};

function makeSubmitReviewLayer(input: {
  readonly cwd: string;
  readonly baseDir: string;
  readonly ghCreateReview: (opts: {
    readonly bodyFile: string;
  }) => Effect.Effect<void, GitHubCli.GitHubCliError>;
  readonly ghCreateReviewWithComments?: (opts: {
    readonly cwd: string;
    readonly reference: string;
    readonly commentsJsonFile: string;
  }) => Effect.Effect<void, GitHubCli.GitHubCliError>;
  readonly ghGetReviews: () => Effect.Effect<
    GitHubCli.GitHubPullRequestReview,
    GitHubCli.GitHubCliError
  >;
}) {
  return ReviewService.layer.pipe(
    Layer.provide(ServerConfig.layerTest(input.cwd, input.baseDir)),
    Layer.provide(
      Layer.effect(
        GitHubCli.GitHubCli,
        Effect.succeed(
          GitHubCli.GitHubCli.of({
            execute: () => Effect.die("unexpected GitHubCli.execute call"),
            listOpenPullRequests: () => Effect.die("unexpected"),
            getPullRequest: () => Effect.die("unexpected"),
            getRepositoryCloneUrls: () => Effect.die("unexpected"),
            createRepository: () => Effect.die("unexpected"),
            createPullRequest: () => Effect.die("unexpected"),
            getDefaultBranch: () => Effect.die("unexpected"),
            checkoutPullRequest: () => Effect.die("unexpected"),
            getPullRequestReviews: ({ cwd: _, reference: __ }) => input.ghGetReviews(),
            createPullRequestReview: ({ cwd: _, reference: __, bodyFile }) =>
              input.ghCreateReview({ bodyFile }),
            createPullRequestReviewWithComments: ({ cwd: _, reference: __, commentsJsonFile }) =>
              input.ghCreateReviewWithComments
                ? input.ghCreateReviewWithComments({ cwd: __, reference: __, commentsJsonFile })
                : input.ghCreateReview({ bodyFile: commentsJsonFile }),
          }),
        ),
      ),
    ),
    Layer.provideMerge(NodeServices.layer),
  );
}

const testLocalComment: ReviewComment = {
  id: "local-1",
  file: "src/app.ts",
  line: 42,
  commitSHA: "abc123",
  body: "Consider renaming this variable.",
  author: { login: "local" },
  createdAt: "2025-06-01T12:00:00Z",
};

const testLocalComment2: ReviewComment = {
  id: "local-2",
  file: "src/utils.ts",
  commitSHA: "abc123",
  body: "Extract this into a helper function.",
  author: { login: "local" },
  createdAt: "2025-06-01T12:05:00Z",
};

const testLocalComment3: ReviewComment = {
  id: "local-3",
  file: "src/index.ts",
  line: 10,
  commitSHA: "abc123",
  body: "Use a named export here.",
  author: { login: "local" },
  createdAt: "2025-06-01T12:10:00Z",
};

describe("ReviewService submitReview", () => {
  it("submitReview fails with no-draft when no draft comments exist", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "t3-submit-review-" });
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-submit-review-base-" });

      const error = yield* Effect.gen(function* () {
        const review = yield* ReviewService.ReviewService;
        return yield* review
          .submitReview({
            threadId: "thread-no-draft",
            prNumber: 1,
            cwd,
          })
          .pipe(Effect.flip);
      }).pipe(
        Effect.provide(
          makeSubmitReviewLayer({
            cwd,
            baseDir,
            ghCreateReview: () => Effect.die("should not be called"),
            ghGetReviews: () => Effect.die("should not be called"),
          }),
        ),
      );

      expect(error._tag).toBe("ChangeRequestSubmitReviewError");
      expect(error.kind).toBe("no-draft");
    }).pipe(Effect.provide(NodeServices.layer)));

  it("submitReview posts local comments and marks them as published", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "t3-submit-review-" });
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-submit-review-base-" });

      const createReviewCalls: Array<{ readonly commentsJsonFile: string }> = [];
      let payloadContent = "";

      const outcome = yield* Effect.gen(function* () {
        const review = yield* ReviewService.ReviewService;

        // Upsert 3 draft comments (2 with line, 1 file-level)
        yield* review.upsertReviewComment({
          threadId: "thread-submit",
          prNumber: 99,
          prHeadSHA: "sha1",
          comment: testLocalComment,
        });
        yield* review.upsertReviewComment({
          threadId: "thread-submit",
          prNumber: 99,
          prHeadSHA: "sha1",
          comment: testLocalComment2,
        });
        yield* review.upsertReviewComment({
          threadId: "thread-submit",
          prNumber: 99,
          prHeadSHA: "sha1",
          comment: testLocalComment3,
        });

        const result = yield* review.submitReview({
          threadId: "thread-submit",
          prNumber: 99,
          cwd,
        });

        return result;
      }).pipe(
        Effect.provide(
          makeSubmitReviewLayer({
            cwd,
            baseDir,
            ghCreateReview: () => Effect.die("should not be called for line comments"),
            ghCreateReviewWithComments: ({ commentsJsonFile }) =>
              Effect.gen(function* () {
                createReviewCalls.push({ commentsJsonFile });
                payloadContent = yield* fs
                  .readFileString(commentsJsonFile)
                  .pipe(Effect.orElseSucceed(() => "file-read-error"));
              }),
            ghGetReviews: () => Effect.succeed({ comments: [] }),
          }),
        ),
      );

      // Verify gh api was called
      expect(createReviewCalls).toHaveLength(1);

      // Parse JSON payload
      const payload = JSON.parse(payloadContent);
      expect(payload.event).toBe("COMMENT");
      expect(payload.commit_id).toBe("sha1");

      // Body contains file-level comment (testLocalComment2 has no line)
      expect(payload.body).toContain("src/utils.ts");
      expect(payload.body).toContain("Extract this into a helper function.");

      // Comments array contains line-specific comments
      expect(payload.comments).toHaveLength(2);
      expect(payload.comments[0].path).toBe("src/app.ts");
      expect(payload.comments[0].line).toBe(42);
      expect(payload.comments[0].side).toBe("RIGHT");
      expect(payload.comments[0].body).toBe("Consider renaming this variable.");
      expect(payload.comments[1].path).toBe("src/index.ts");
      expect(payload.comments[1].line).toBe(10);
      expect(payload.comments[1].body).toBe("Use a named export here.");

      // Verify returned draft stays in "draft" state so future submissions are possible
      expect(outcome.state).toBe("draft");
      expect(outcome.comments).toHaveLength(3);
      expect(outcome.comments[0]?.id).toBe("local-1");
      // Published comments are no longer marked as "local" author
      expect(outcome.comments[0]?.author.login).toBe("local-published");

      // Verify getReviewDraft returns the draft (not published) with authored comments
      const freshDraft = yield* Effect.gen(function* () {
        const review = yield* ReviewService.ReviewService;
        return yield* review.getReviewDraft({
          threadId: "thread-submit",
          prNumber: 99,
          cwd,
        });
      }).pipe(
        Effect.provide(
          makeSubmitReviewLayer({
            cwd,
            baseDir,
            ghCreateReview: () => Effect.die("should not be called"),
            ghGetReviews: () => Effect.succeed({ comments: [] }),
          }),
        ),
      );

      expect(freshDraft?.state).toBe("draft");
      expect(freshDraft?.comments).toHaveLength(3);
      expect(freshDraft?.comments[0]?.id).toBe("local-1");
    }).pipe(Effect.provide(NodeServices.layer)));

  it("submitReview preserves draft on gh pr review failure", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "t3-submit-review-" });
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-submit-review-base-" });

      const result = yield* Effect.gen(function* () {
        const review = yield* ReviewService.ReviewService;

        // Upsert a draft comment
        yield* review.upsertReviewComment({
          threadId: "thread-fail",
          prNumber: 7,
          prHeadSHA: "sha1",
          comment: testLocalComment,
        });

        // Attempt to submit (will fail because gh api fails)
        return yield* review
          .submitReview({
            threadId: "thread-fail",
            prNumber: 7,
            cwd,
          })
          .pipe(Effect.flip);
      }).pipe(
        Effect.provide(
          makeSubmitReviewLayer({
            cwd,
            baseDir,
            ghCreateReview: () => Effect.die("should not be called"),
            ghCreateReviewWithComments: () =>
              Effect.fail(
                new GitHubCli.GitHubCliError({
                  operation: "createPullRequestReviewWithComments",
                  detail: "gh api review failed: status 403",
                }),
              ),
            ghGetReviews: () => Effect.die("should not be called"),
          }),
        ),
      );

      expect(result._tag).toBe("ChangeRequestSubmitReviewError");
      expect(result.kind).toBe("review-failed");
      expect(result.detail).toContain("gh api review failed");

      // Verify local draft still exists
      const existingDraft = yield* Effect.gen(function* () {
        const review = yield* ReviewService.ReviewService;
        return yield* review.getReviewDraft({
          threadId: "thread-fail",
          prNumber: 7,
          cwd,
        });
      }).pipe(
        Effect.provide(
          makeSubmitReviewLayer({
            cwd,
            baseDir,
            ghCreateReview: () => Effect.die("should not be called"),
            ghGetReviews: () => Effect.succeed({ comments: [] }),
          }),
        ),
      );

      expect(existingDraft).not.toBeNull();
      expect(existingDraft?.state).toBe("draft");
      expect(existingDraft?.comments).toHaveLength(1);
    }).pipe(Effect.provide(NodeServices.layer)));

  it("submitReview only posts new local comments on resubmission", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "t3-submit-review-" });
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-submit-review-base-" });

      const createReviewCalls: Array<string> = [];
      let secondPayload: Record<string, unknown> | null = null;

      yield* Effect.gen(function* () {
        const review = yield* ReviewService.ReviewService;

        // First submission: post comment-1 (has line)
        yield* review.upsertReviewComment({
          threadId: "thread-incremental",
          prNumber: 42,
          prHeadSHA: "sha1",
          comment: testLocalComment,
        });
        yield* review.submitReview({
          threadId: "thread-incremental",
          prNumber: 42,
          cwd,
        });

        // Add a second comment (no line = file-level)
        yield* review.upsertReviewComment({
          threadId: "thread-incremental",
          prNumber: 42,
          prHeadSHA: "sha1",
          comment: testLocalComment2,
        });

        // Second submission should only include the new comment
        yield* review.submitReview({
          threadId: "thread-incremental",
          prNumber: 42,
          cwd,
        });
      }).pipe(
        Effect.provide(
          makeSubmitReviewLayer({
            cwd,
            baseDir,
            ghCreateReview: ({ bodyFile }) =>
              Effect.gen(function* () {
                createReviewCalls.push("body:" + bodyFile);
                const raw = yield* fs
                  .readFileString(bodyFile)
                  .pipe(Effect.orElseSucceed(() => "{}"));
                secondPayload = JSON.parse(raw);
              }),
            ghCreateReviewWithComments: ({ commentsJsonFile }) =>
              Effect.gen(function* () {
                createReviewCalls.push("inline:" + commentsJsonFile);
              }),
            ghGetReviews: () => Effect.succeed({ comments: [] }),
          }),
        ),
      );

      expect(createReviewCalls).toHaveLength(2);
      // Second submission uses body path (file-level only), should not contain first comment
      const sp = secondPayload as Record<string, unknown> | null;
      const bodyText = typeof sp?.body === "string" ? sp.body : "";
      expect(bodyText).not.toContain("Consider renaming this variable.");
      expect(bodyText).toContain("Extract this into a helper function.");
      // No comments array since the new comment has no line
      expect(sp?.comments).toBeUndefined();
    }).pipe(Effect.provide(NodeServices.layer)));

  it("submitReview returns no-draft when all local comments are already published", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "t3-submit-review-" });
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-submit-review-base-" });

      const createReviewCalls: Array<{ readonly commentsJsonFile: string }> = [];

      const error = yield* Effect.gen(function* () {
        const review = yield* ReviewService.ReviewService;

        yield* review.upsertReviewComment({
          threadId: "thread-all-published",
          prNumber: 1,
          prHeadSHA: "sha1",
          comment: testLocalComment,
        });

        // First submission publishes the comment
        yield* review.submitReview({
          threadId: "thread-all-published",
          prNumber: 1,
          cwd,
        });

        // Second submission with no new local comments
        return yield* review
          .submitReview({
            threadId: "thread-all-published",
            prNumber: 1,
            cwd,
          })
          .pipe(Effect.flip);
      }).pipe(
        Effect.provide(
          makeSubmitReviewLayer({
            cwd,
            baseDir,
            ghCreateReview: () => Effect.die("should not be called"),
            ghCreateReviewWithComments: ({ commentsJsonFile }) =>
              Effect.gen(function* () {
                createReviewCalls.push({ commentsJsonFile });
              }),
            ghGetReviews: () => Effect.succeed({ comments: [] }),
          }),
        ),
      );

      expect(createReviewCalls).toHaveLength(1);
      expect(error._tag).toBe("ChangeRequestSubmitReviewError");
      expect(error.kind).toBe("no-draft");
      expect(error.detail).toBe("No local draft review comments to submit.");
    }).pipe(Effect.provide(NodeServices.layer)));
});
