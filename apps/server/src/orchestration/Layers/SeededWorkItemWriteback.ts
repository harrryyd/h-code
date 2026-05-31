import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  SeededWorkItemWriteback,
  SeededWorkItemWritebackError,
  type SeededWorkItemWritebackShape,
} from "../Services/SeededWorkItemWriteback.ts";

const make = Effect.succeed({
  append: (input) =>
    Effect.fail(
      new SeededWorkItemWritebackError({
        detail: `Append-only write-back is not configured for source '${input.sourceKind}' (${input.sourceLabel}).`,
      }),
    ),
} satisfies SeededWorkItemWritebackShape);

export const SeededWorkItemWritebackLive = Layer.effect(SeededWorkItemWriteback, make);
