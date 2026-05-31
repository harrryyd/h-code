import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

export interface SeededWorkItemWritebackReactorShape {
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  readonly drain: Effect.Effect<void>;
}

export class SeededWorkItemWritebackReactor extends Context.Service<
  SeededWorkItemWritebackReactor,
  SeededWorkItemWritebackReactorShape
>()("t3/orchestration/Services/SeededWorkItemWritebackReactor") {}
