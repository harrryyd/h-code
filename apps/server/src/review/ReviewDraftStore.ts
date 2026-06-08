import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type { ReviewDraft } from "@t3tools/contracts";

export interface ReviewDraftStoreShape {
  readonly get: (
    threadId: string,
    prNumber: number,
  ) => Effect.Effect<Option.Option<ReviewDraft>, never>;
  readonly upsert: (draft: ReviewDraft) => Effect.Effect<void, never>;
  readonly delete: (
    threadId: string,
    prNumber: number,
  ) => Effect.Effect<void, never>;
}

export class ReviewDraftStore extends Context.Service<ReviewDraftStore, ReviewDraftStoreShape>()(
  "t3/review/ReviewDraftStore",
) {}

export const make = Effect.fn("makeReviewDraftStore")(function* () {
  const drafts = new Map<string, ReviewDraft>();

  const key = (threadId: string, prNumber: number) => `${threadId}:${prNumber}`;

  return ReviewDraftStore.of({
    get: (threadId, prNumber) =>
      Effect.sync(() => Option.fromNullable(drafts.get(key(threadId, prNumber)) ?? null)),
    upsert: (draft) =>
      Effect.sync(() => {
        drafts.set(key(draft.threadId, draft.prNumber), draft);
      }),
    delete: (threadId, prNumber) =>
      Effect.sync(() => {
        drafts.delete(key(threadId, prNumber));
      }),
  });
});

export const layer = Layer.effect(ReviewDraftStore, make());
