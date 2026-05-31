import type {
  SeededWorkItemId,
  SeededWorkItemWritebackKind,
  SeededWorkSourceKind,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export class SeededWorkItemWritebackError extends Schema.TaggedErrorClass<SeededWorkItemWritebackError>()(
  "SeededWorkItemWritebackError",
  {
    detail: Schema.String,
  },
) {}

export interface SeededWorkItemWritebackShape {
  readonly append: (input: {
    readonly sourceKind: SeededWorkSourceKind;
    readonly sourceLabel: string;
    readonly itemId: SeededWorkItemId;
    readonly title: string;
    readonly writebackKind: SeededWorkItemWritebackKind;
    readonly body: string;
  }) => Effect.Effect<
    {
      readonly externalReference?: string;
    },
    SeededWorkItemWritebackError
  >;
}

export class SeededWorkItemWriteback extends Context.Service<
  SeededWorkItemWriteback,
  SeededWorkItemWritebackShape
>()("t3/orchestration/Services/SeededWorkItemWriteback") {}
