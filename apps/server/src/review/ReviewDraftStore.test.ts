import { describe, it, expect } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type { ReviewComment, ReviewDraft } from "@t3tools/contracts";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as ReviewDraftStore from "./ReviewDraftStore.ts";
import { ServerConfig } from "../config.ts";

function makeLayer() {
  return ReviewDraftStore.layer.pipe(
    Layer.provide(ServerConfig.layerTest("test-cwd", { prefix: "t3-review-draft-store-" })),
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

const testDraft: ReviewDraft = {
  threadId: "thread-1",
  prNumber: 42,
  prHeadSHA: "abc123",
  comments: [testComment],
  state: "draft",
};

describe("ReviewDraftStore", () => {
  it("get returns none for unknown draft", () =>
    Effect.gen(function* () {
      const store = yield* ReviewDraftStore.ReviewDraftStore;
      const result = yield* store.get("unknown", 1);
      expect(Option.isNone(result)).toBe(true);
    }).pipe(Effect.provide(makeLayer())),
  );

  it("round-trip: upsert then get", () =>
    Effect.gen(function* () {
      const store = yield* ReviewDraftStore.ReviewDraftStore;
      yield* store.upsert(testDraft);

      const result = yield* store.get("thread-1", 42);
      expect(Option.getOrNull(result)).toEqual(testDraft);
    }).pipe(Effect.provide(makeLayer())),
  );

  it("delete removes a draft", () =>
    Effect.gen(function* () {
      const store = yield* ReviewDraftStore.ReviewDraftStore;
      yield* store.upsert(testDraft);
      yield* store.delete("thread-1", 42);

      const result = yield* store.get("thread-1", 42);
      expect(Option.isNone(result)).toBe(true);
    }).pipe(Effect.provide(makeLayer())),
  );

  it("upsert overwrites existing draft", () =>
    Effect.gen(function* () {
      const store = yield* ReviewDraftStore.ReviewDraftStore;

      yield* store.upsert(testDraft);

      const updatedDraft: ReviewDraft = {
        threadId: "thread-1",
        prNumber: 42,
        prHeadSHA: "def456",
        comments: [
          {
            id: "comment-2",
            file: "src/app.ts",
            commitSHA: "def456",
            body: "Also fix this typo.",
            author: { login: "codex-bot" },
            createdAt: "2025-06-02T12:00:00Z",
          },
        ],
        state: "draft",
      };
      yield* store.upsert(updatedDraft);

      const result = yield* store.get("thread-1", 42);
      const value = Option.getOrNull(result);
      expect(value?.prHeadSHA).toBe("def456");
      expect(value?.comments).toHaveLength(1);
      expect(value?.comments[0]?.id).toBe("comment-2");
    }).pipe(Effect.provide(makeLayer())),
  );
});
