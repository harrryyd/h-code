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
    }).pipe(Effect.provide(makeLayer())),
  );

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
    }).pipe(Effect.provide(makeLayer())),
  );

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
    }).pipe(Effect.provide(makeLayer())),
  );

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
    }).pipe(Effect.provide(makeLayer())),
  );

  it("deleteReviewComment returns null for unknown draft", () =>
    Effect.gen(function* () {
      const review = yield* ReviewService.ReviewService;

      const result = yield* review.deleteReviewComment({
        threadId: "unknown",
        prNumber: 1,
        commentId: "no-such-comment",
      });

      expect(result).toBeNull();
    }).pipe(Effect.provide(makeLayer())),
  );
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
  readonly ghCreateReview: (opts: { readonly bodyFile: string }) => Effect.Effect<void, GitHubCli.GitHubCliError>;
  readonly ghGetReviews: () => Effect.Effect<GitHubCli.GitHubPullRequestReview, GitHubCli.GitHubCliError>;
}) {
  return ReviewService.layer.pipe(
    Layer.provide(ServerConfig.layerTest(input.cwd, input.baseDir)),
    Layer.provide(
      Layer.effect(GitHubCli.GitHubCli, Effect.succeed(GitHubCli.GitHubCli.of({
        execute: () => Effect.die("unexpected GitHubCli.execute call"),
        listOpenPullRequests: () => Effect.die("unexpected"),
        getPullRequest: () => Effect.die("unexpected"),
        getRepositoryCloneUrls: () => Effect.die("unexpected"),
        createRepository: () => Effect.die("unexpected"),
        createPullRequest: () => Effect.die("unexpected"),
        getDefaultBranch: () => Effect.die("unexpected"),
        checkoutPullRequest: () => Effect.die("unexpected"),
        getPullRequestReviews: ({ cwd: _, reference: __ }) => input.ghGetReviews(),
        createPullRequestReview: ({ cwd: _, reference: __, bodyFile }) => input.ghCreateReview({ bodyFile }),
      }))),
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
        return yield* review.submitReview({
          threadId: "thread-no-draft",
          prNumber: 1,
          cwd,
        }).pipe(Effect.flip);
      }).pipe(Effect.provide(makeSubmitReviewLayer({
        cwd,
        baseDir,
        ghCreateReview: () => Effect.die("should not be called"),
        ghGetReviews: () => Effect.die("should not be called"),
      })));

      expect(error._tag).toBe("ChangeRequestSubmitReviewError");
      expect(error.kind).toBe("no-draft");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it("submitReview posts local comments and marks them as published", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "t3-submit-review-" });
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-submit-review-base-" });

      const createReviewCalls: Array<{ readonly bodyFile: string }> = [];
      let bodyFileContent = "";

      const outcome = yield* Effect.gen(function* () {
        const review = yield* ReviewService.ReviewService;

        // Upsert 3 draft comments
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
      }).pipe(Effect.provide(makeSubmitReviewLayer({
        cwd,
        baseDir,
        ghCreateReview: ({ bodyFile }) =>
          Effect.gen(function* () {
            createReviewCalls.push({ bodyFile });
            bodyFileContent = yield* fs.readFileString(bodyFile).pipe(
              Effect.orElseSucceed(() => "file-read-error"),
            );
          }),
        ghGetReviews: () => Effect.succeed({ comments: [] }),
      })));

      // Verify gh pr review was called
      expect(createReviewCalls).toHaveLength(1);

      // Verify body file contains all 3 comments
      expect(bodyFileContent).toContain("src/app.ts:42");
      expect(bodyFileContent).toContain("Consider renaming this variable.");
      expect(bodyFileContent).toContain("src/utils.ts");
      expect(bodyFileContent).toContain("Extract this into a helper function.");
      expect(bodyFileContent).toContain("src/index.ts:10");
      expect(bodyFileContent).toContain("Use a named export here.");

      // Verify returned draft has local comments marked as published
      expect(outcome.state).toBe("published");
      expect(outcome.comments).toHaveLength(3);
      expect(outcome.comments[0]?.id).toBe("local-1");
      expect(outcome.comments[1]?.id).toBe("local-2");
      expect(outcome.comments[2]?.id).toBe("local-3");

      // Verify getReviewDraft returns the published draft
      const freshDraft = yield* Effect.gen(function* () {
        const review = yield* ReviewService.ReviewService;
        return yield* review.getReviewDraft({
          threadId: "thread-submit",
          prNumber: 99,
          cwd,
        });
      }).pipe(Effect.provide(makeSubmitReviewLayer({
        cwd,
        baseDir,
        ghCreateReview: () => Effect.die("should not be called again"),
        ghGetReviews: () => Effect.succeed({ comments: [] }),
      })));

      expect(freshDraft?.state).toBe("published");
      expect(freshDraft?.comments).toHaveLength(3);
      expect(freshDraft?.comments[0]?.id).toBe("local-1");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

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

        // Attempt to submit (will fail because gh pr review fails)
        return yield* review.submitReview({
          threadId: "thread-fail",
          prNumber: 7,
          cwd,
        }).pipe(Effect.flip);
      }).pipe(Effect.provide(makeSubmitReviewLayer({
        cwd,
        baseDir,
        ghCreateReview: () =>
          Effect.fail(new GitHubCli.GitHubCliError({
            operation: "createPullRequestReview",
            detail: "gh pr review failed: status 403",
          })),
        ghGetReviews: () => Effect.die("should not be called"),
      })));

      expect(result._tag).toBe("ChangeRequestSubmitReviewError");
      expect(result.kind).toBe("review-failed");
      expect(result.detail).toContain("gh pr review failed");

      // Verify local draft still exists
      const existingDraft = yield* Effect.gen(function* () {
        const review = yield* ReviewService.ReviewService;
        return yield* review.getReviewDraft({
          threadId: "thread-fail",
          prNumber: 7,
          cwd,
        });
      }).pipe(Effect.provide(makeSubmitReviewLayer({
        cwd,
        baseDir,
        ghCreateReview: () => Effect.die("should not be called"),
        ghGetReviews: () => Effect.succeed({ comments: [] }),
      })));

      expect(existingDraft).not.toBeNull();
      expect(existingDraft?.state).toBe("draft");
      expect(existingDraft?.comments).toHaveLength(1);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
