import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import type { ReviewDraft } from "@t3tools/contracts";

import { writeFileStringAtomically } from "../atomicWrite.ts";
import { ServerConfig } from "../config.ts";

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
  const config = yield* ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const persistPath = path.join(config.stateDir, "review-drafts.json");
  const drafts = new Map<string, ReviewDraft>();

  yield* fs.makeDirectory(config.stateDir, { recursive: true }).pipe(
    Effect.orElseSucceed(() => undefined),
  );

  const exists = yield* fs.exists(persistPath).pipe(Effect.orElseSucceed(() => false));
  if (exists) {
    const raw = yield* fs.readFileString(persistPath).pipe(Effect.orElseSucceed(() => "{}"));
    // @effect-diagnostics-next-line tryCatchInEffectGen:off
    try {
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      const parsed = JSON.parse(raw) as Record<string, ReviewDraft>;
      for (const [k, v] of Object.entries(parsed)) {
        drafts.set(k, v);
      }
    } catch {
      drafts.clear();
    }
  }

  const persist = () =>
    Effect.gen(function* () {
      const obj: Record<string, ReviewDraft> = {};
      for (const [k, v] of drafts) {
        obj[k] = v;
      }
      // @effect-diagnostics-next-line tryCatchInEffectGen:off
      try {
        // @effect-diagnostics-next-line preferSchemaOverJson:off
        const contents = JSON.stringify(obj);
        yield* writeFileStringAtomically({ filePath: persistPath, contents });
      } catch {
        // Best-effort persistence
      }
    }).pipe(
      Effect.catch(() => Effect.void),
    );

  const key = (threadId: string, prNumber: number) => `${threadId}:${prNumber}`;

  return ReviewDraftStore.of({
    get: (threadId, prNumber) =>
      Effect.sync(() => Option.fromNullishOr(drafts.get(key(threadId, prNumber)))),
    upsert: (draft) =>
      Effect.sync(() => {
        drafts.set(key(draft.threadId, draft.prNumber), draft);
      }).pipe(
        Effect.tap(() =>
          persist().pipe(
            Effect.provideService(FileSystem.FileSystem, fs),
            Effect.provideService(Path.Path, path),
          ),
        ),
      ),
    delete: (threadId, prNumber) =>
      Effect.sync(() => {
        drafts.delete(key(threadId, prNumber));
      }).pipe(
        Effect.tap(() =>
          persist().pipe(
            Effect.provideService(FileSystem.FileSystem, fs),
            Effect.provideService(Path.Path, path),
          ),
        ),
      ),
  });
});

export const layer = Layer.effect(ReviewDraftStore, make());
