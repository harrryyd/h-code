import { describe, it, expect } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { ReviewComment } from "@t3tools/contracts";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as ReviewService from "./ReviewService.ts";
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
  agentStatus: "suggestion",
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
        agentStatus: "resolved",
      };

      const upserted = yield* review.upsertReviewComment({
        threadId: "thread-3",
        prNumber: 7,
        prHeadSHA: "sha2",
        comment: updatedComment,
      });

      expect(upserted.comments).toHaveLength(1);
      expect(upserted.comments[0]?.body).toBe("Updated body text.");
      expect(upserted.comments[0]?.agentStatus).toBe("resolved");
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
